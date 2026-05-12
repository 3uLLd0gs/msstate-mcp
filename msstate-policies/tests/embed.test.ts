import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.VOYAGE_API_KEY;

beforeEach(() => {
  process.env.VOYAGE_API_KEY = "vo-test-mock-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.VOYAGE_API_KEY;
  else process.env.VOYAGE_API_KEY = ORIGINAL_KEY;
});

test("embedQuery: returns Float32Array(512) on successful response", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [{ embedding: new Array(512).fill(0).map((_, i) => i / 512) }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const { embedQuery } = await import("../src/calendars/embed.js?fresh-1");
  const v = await embedQuery("test query");
  assert.ok(v instanceof Float32Array);
  assert.equal(v!.length, 512);
});

test("embedQuery: returns null when VOYAGE_API_KEY is unset", async () => {
  delete process.env.VOYAGE_API_KEY;
  const { embedQuery } = await import("../src/calendars/embed.js?fresh-2");
  const v = await embedQuery("test query");
  assert.equal(v, null);
});

test("embedQuery: returns null on fetch failure (network error)", async () => {
  globalThis.fetch = (async () => {
    throw new Error("simulated network failure");
  }) as typeof fetch;
  const { embedQuery } = await import("../src/calendars/embed.js?fresh-3");
  const v = await embedQuery("test query");
  assert.equal(v, null);
});

test("embedQuery: returns null on non-200 response", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "rate limit" }), { status: 429 })) as typeof fetch;
  const { embedQuery } = await import("../src/calendars/embed.js?fresh-4");
  const v = await embedQuery("test query");
  assert.equal(v, null);
});

test("embedQuery: never throws even on malformed response", async () => {
  globalThis.fetch = (async () =>
    new Response("not json", { status: 200 })) as typeof fetch;
  const { embedQuery } = await import("../src/calendars/embed.js?fresh-5");
  const v = await embedQuery("test query");
  assert.equal(v, null);
});

test("embedQuery: caches identical queries via LRU", async () => {
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount++;
    return new Response(
      JSON.stringify({ data: [{ embedding: new Array(512).fill(0.5) }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const { embedQuery } = await import("../src/calendars/embed.js?fresh-6");
  await embedQuery("repeat me");
  await embedQuery("repeat me");
  await embedQuery("repeat me");
  assert.equal(callCount, 1, "expected LRU to dedupe to one fetch");
});

test("isEmbeddingAvailable: false when no key", async () => {
  delete process.env.VOYAGE_API_KEY;
  const { isEmbeddingAvailable } = await import("../src/calendars/embed.js?fresh-7");
  assert.equal(isEmbeddingAvailable, false);
});

test("isEmbeddingAvailable: true when key set", async () => {
  process.env.VOYAGE_API_KEY = "vo-anything";
  const { isEmbeddingAvailable } = await import("../src/calendars/embed.js?fresh-8");
  assert.equal(isEmbeddingAvailable, true);
});
