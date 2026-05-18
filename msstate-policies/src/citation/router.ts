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

const COURSE_CODE_RE = /\b[A-Z]{2,4}\s\d{4}\b/;
const POLICY_OP_RE = /\b(OP|operating policy)\s*\d{2}\.\d{2,3}\b/i;
const DOLLAR_RE = /\$\s?\d/;
const MONTH_DAY_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i;

const EMERGENCY_TERMS = new Set([
  "tornado", "fire", "shooter", "active shooter", "lockdown", "evacuation",
  "refuge", "weather warning", "emergency", "msu pd", "911",
]);

const TUITION_TERMS = new Set([
  "tuition", "fee", "fees", "credit hour", "per credit", "in-state", "out-of-state",
  "resident", "non-resident", "scholarship", "billing",
]);

const ONLINE_TERMS = new Set([
  "online program", "online mba", "online bachelor", "online master",
  "online certificate", "online doctoral", "online application", "online deadline",
  "msu online",
]);

const DINING_TERMS = new Set([
  "dining", "cafeteria", "restaurant", "perry", "chick-fil-a", "starbucks",
  "open", "closes", "hours", "lunch", "breakfast", "dinner", "meal plan",
]);

const CALENDAR_TERMS = new Set([
  "registration", "drop deadline", "add deadline", "spring break", "fall break",
  "thanksgiving", "winter break", "commencement", "finals", "exam schedule",
  "holiday", "first day of class", "last day of class",
]);

function lowerWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1),
  );
}

function anyTermMatch(claim: string, terms: Set<string>): boolean {
  const lower = claim.toLowerCase();
  for (const t of terms) {
    if (t.includes(" ") ? lower.includes(t) : lowerWords(claim).has(t)) return true;
  }
  return false;
}

export function routeClaim(claim: string, hints: readonly CitationDomain[] | undefined): CitationDomain | null {
  if (hints && hints.length > 0) {
    const valid = hints.filter((h) => ALL_DOMAINS.includes(h));
    if (valid.length > 0) return valid[0];
  }
  if (POLICY_OP_RE.test(claim)) return "policies";
  if (COURSE_CODE_RE.test(claim)) return "courses";
  if (anyTermMatch(claim, EMERGENCY_TERMS)) return "emergency";
  if (anyTermMatch(claim, ONLINE_TERMS)) return "online";
  if (DOLLAR_RE.test(claim) && anyTermMatch(claim, TUITION_TERMS)) return "tuition";
  if (MONTH_DAY_RE.test(claim) || anyTermMatch(claim, CALENDAR_TERMS)) return "calendar";
  if (anyTermMatch(claim, DINING_TERMS)) return "dining";
  if (anyTermMatch(claim, TUITION_TERMS)) return "tuition";
  return null;
}
