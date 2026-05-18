/**
 * Claim router for citation_card.
 *
 * - splitClaims: text → sentence-level claim strings.
 * - routeClaim: claim + optional hints → CitationDomain | null.
 * - searchInDomain: claim + domain → CitationCard (per-corpus delegation).
 *
 * No I/O — relies on already-loaded corpora via existing per-corpus accessors.
 */
import {
  type CitationDomain,
  ALL_DOMAINS,
  MAX_CLAIM_CHARS,
  MAX_CLAIMS,
} from "./types.js";

// Splits on `.!?` boundaries that are followed by whitespace + capital letter
// or end-of-string. Lenient — over-splits are preferable to under-splits
// (each becomes its own claim). Truncates each to MAX_CLAIM_CHARS and caps
// the count at MAX_CLAIMS.
export function splitClaims(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [];
  const parts = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$])/)
    .map((s) => s.replace(/[.!?]+$/, "").trim())
    .filter((s) => s.length > 0);
  const truncated = parts.map((s) => (s.length > MAX_CLAIM_CHARS ? s.slice(0, MAX_CLAIM_CHARS) : s));
  return truncated.slice(0, MAX_CLAIMS);
}
