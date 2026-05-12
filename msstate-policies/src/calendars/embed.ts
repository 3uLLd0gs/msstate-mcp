/**
 * Voyage embeddings REST client with graceful-null degradation.
 *
 * - Reads VOYAGE_API_KEY from process.env. The value is captured at module
 *   load AND refreshed when it changes between calls — refreshing also clears
 *   the per-call LRU + circuit breaker so a key rotation (or a test mutating
 *   env across calls) cannot return stale vectors signed with the old key.
 * - 2s timeout per call.
 * - LRU cache (size 256, keyed by raw text).
 * - Returns Float32Array(512) on success, null on any failure path.
 * - Never throws to callers — caller falls back to BM25.
 * - Logs structured errors to stderr (never echoes err.message to clients).
 */
import { log } from "../log.js";
import { EMBED_DIM } from "./types.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings" as const;
const VOYAGE_MODEL = "voyage-3-lite" as const;
const TIMEOUT_MS = 2000;
const LRU_SIZE = 256;

function readKey(): string {
  const k = process.env.VOYAGE_API_KEY;
  return typeof k === "string" ? k : "";
}

// Captured at module load. Mutates only when refreshIfEnvChanged() detects a
// key change. Exported as `let` so the binding stays live for callers that
// hold the namespace reference.
let lastSeenKey = readKey();
export let isEmbeddingAvailable = lastSeenKey.length > 0;

if (!isEmbeddingAvailable) {
  log("warn", "VOYAGE_API_KEY unset; calendar tool will fall back to BM25-only retrieval");
}

// Circuit breaker: 5 failures in 30s → trip for 60s.
let recentFailures: number[] = [];
let trippedUntil = 0;
const TRIP_THRESHOLD = 5;
const TRIP_WINDOW_MS = 30_000;
const TRIP_DURATION_MS = 60_000;

function noteFailure(): void {
  const now = Date.now();
  recentFailures = recentFailures.filter((t) => now - t < TRIP_WINDOW_MS);
  recentFailures.push(now);
  if (recentFailures.length >= TRIP_THRESHOLD) {
    trippedUntil = now + TRIP_DURATION_MS;
    recentFailures = [];
    log("warn", "embedding circuit breaker tripped", { until: new Date(trippedUntil).toISOString() });
  }
}

function isTripped(): boolean {
  return Date.now() < trippedUntil;
}

// Simple LRU: Map preserves insertion order, evict from front on overflow.
const lru = new Map<string, Float32Array>();

function lruGet(key: string): Float32Array | undefined {
  const v = lru.get(key);
  if (v !== undefined) {
    lru.delete(key);
    lru.set(key, v);
  }
  return v;
}

function lruSet(key: string, v: Float32Array): void {
  if (lru.has(key)) lru.delete(key);
  lru.set(key, v);
  if (lru.size > LRU_SIZE) {
    const first = lru.keys().next().value as string;
    lru.delete(first);
  }
}

/** Detect key rotation and clear per-key state so stale vectors signed with
 *  a different key are never returned. Called at the top of every embedQuery
 *  call and embedBatch call. */
function refreshIfEnvChanged(): void {
  const current = readKey();
  if (current !== lastSeenKey) {
    lastSeenKey = current;
    isEmbeddingAvailable = current.length > 0;
    lru.clear();
    recentFailures = [];
    trippedUntil = 0;
  }
}

/**
 * Embed a single query string. Returns null when:
 *   - VOYAGE_API_KEY is unset
 *   - circuit breaker is tripped
 *   - the network call fails (timeout, non-200, malformed response)
 * Never throws. Callers must handle null by falling back to BM25.
 */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  refreshIfEnvChanged();
  if (!isEmbeddingAvailable) return null;
  if (isTripped()) return null;
  const cached = lruGet(text);
  if (cached) return cached;

  const start = Date.now();
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lastSeenKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [text],
        input_type: "query",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      log("warn", "voyage non-200", { status: res.status, duration_ms: Date.now() - start });
      noteFailure();
      return null;
    }

    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const arr = json.data?.[0]?.embedding;
    if (!Array.isArray(arr) || arr.length !== EMBED_DIM) {
      log("warn", "voyage malformed response", { len: arr?.length, duration_ms: Date.now() - start });
      noteFailure();
      return null;
    }

    const vec = new Float32Array(arr);
    lruSet(text, vec);
    return vec;
  } catch (err) {
    log("warn", "voyage call failed", {
      err_class: err instanceof Error ? err.constructor.name : "unknown",
      duration_ms: Date.now() - start,
    });
    noteFailure();
    return null;
  }
}

/**
 * Batch-embed multiple texts. Used by the build script, NOT at query time.
 * Throws on failure so the build can abort and refuse to ship a poisoned corpus.
 */
export async function embedBatch(
  texts: string[],
  inputType: "document" | "query" = "document",
): Promise<Float32Array[]> {
  refreshIfEnvChanged();
  if (!isEmbeddingAvailable) {
    throw new Error("VOYAGE_API_KEY unset; cannot embed at build time");
  }
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${lastSeenKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: inputType }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`voyage batch failed: status=${res.status}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => new Float32Array(d.embedding));
}
