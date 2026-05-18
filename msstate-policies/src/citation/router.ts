/**
 * Claim router for citation_card.
 *
 * - splitClaims: text → sentence-level claim strings. (Pure.)
 * - routeClaim: claim + optional hints → CitationDomain | null. (Pure.)
 * - searchInDomain: claim + domain → CitationCard (per-corpus delegation).
 *   Mostly reads from already-loaded corpora; the `policies` branch may do
 *   live HTTP + PDF parse via getPolicy(...) on a cache miss.
 */
import {
  type CitationDomain,
  type CitationCard,
  ALL_DOMAINS,
  MAX_CLAIM_CHARS,
  MAX_CLAIMS,
} from "./types.js";
import { bm25SearchInfo } from "../online/search.js";
import { getOnlineCorpus } from "../online/corpus.js";
import { getCourse, getCourseCorpus } from "../courses/corpus.js";
import { getEmergencyCorpus } from "../emergency/corpus.js";
import { getTuitionCorpus } from "../tuition/corpus.js";
import { getDiningCorpus } from "../dining/corpus.js";
import { bm25Search } from "../search.js";
import { getPolicy } from "../corpus.js";
import { searchCalendarRows } from "../calendars/search.js";

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

// 3-letter minimum prefix: excludes admin codes like "HR 2024" / "IT 9001"
// while still covering all 3-4 letter MSU department codes (CSE, MA(TH), PHYS).
// Two-letter MSU dept codes (EC, FO) are rare; if needed, callers can pass
// domain_hints=["courses"] to bypass the heuristic.
const COURSE_CODE_RE = /\b[A-Z]{3,4}\s\d{4}\b/;
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
  "dining", "cafeteria", "restaurant", "perry cafeteria", "chick-fil-a", "starbucks",
  "lunch", "breakfast", "dinner", "meal plan",
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
  // Two-pass tuition: high-precision (dollar + term) ran first above;
  // fall back to term-alone here so "scholarship covers fees" still routes
  // to tuition without competing with calendar/dining keyword matches.
  if (anyTermMatch(claim, TUITION_TERMS)) return "tuition";
  return null;
}

// ---------------------------------------------------------------------------
// Per-domain search helpers
// ---------------------------------------------------------------------------

const SNIPPET_MAX = 240;

function snippet(text: string): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > SNIPPET_MAX ? cleaned.slice(0, SNIPPET_MAX) + "…" : cleaned;
}

function none(claim: string, domain: CitationDomain | null, reason: string): CitationCard {
  return {
    claim, domain, source_url: null, source_title: null, last_updated: null,
    snippet: null, confidence: "none", reason,
  };
}

async function searchOnline(claim: string): Promise<CitationCard> {
  const corpus = getOnlineCorpus();
  if (!corpus) return none(claim, "online", "online corpus not loaded");
  const hits = bm25SearchInfo(claim, 1, "all");
  if (hits.length === 0) return none(claim, "online", "no BM25 hit in info pages");
  const top = hits[0];
  const conf = top.score > 5 ? "high" : top.score > 2 ? "medium" : "low";
  return {
    claim, domain: "online",
    source_url: top.row.url, source_title: top.row.title,
    last_updated: corpus.builtAt, snippet: snippet(top.row.body_markdown),
    confidence: conf, reason: `BM25 match in info_pages (score=${top.score.toFixed(2)})`,
  };
}

async function searchPoliciesDomain(claim: string): Promise<CitationCard> {
  const opMatch = claim.match(/\b(?:OP|operating policy)\s*(\d{2}\.\d{2,3})\b/i);
  if (opMatch) {
    try {
      const doc = await getPolicy(opMatch[1]);
      return {
        claim, domain: "policies", source_url: doc.landingUrl,
        source_title: doc.title, last_updated: doc.effectiveDate ?? doc.retrievedAt ?? null,
        snippet: snippet(doc.text), confidence: "high",
        reason: `direct OP reference to ${opMatch[1]}`,
      };
    } catch (err) {
      return none(claim, "policies", `direct OP ${opMatch[1]} lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const hits = bm25Search(claim, 1);
  if (hits.length === 0) return none(claim, "policies", "no policy index hit");
  try {
    const doc = await getPolicy(hits[0].slug);
    return {
      claim, domain: "policies", source_url: doc.landingUrl,
      source_title: doc.title, last_updated: doc.effectiveDate ?? doc.retrievedAt ?? null,
      snippet: snippet(doc.text), confidence: "medium",
      reason: `policy index BM25 match (score=${hits[0].score.toFixed(2)})`,
    };
  } catch (err) {
    return none(claim, "policies", `BM25 top hit ${hits[0].slug} lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function searchCalendarDomain(claim: string): Promise<CitationCard> {
  const hits = searchCalendarRows(claim, 1);
  if (!hits || hits.length === 0) return none(claim, "calendar", "no calendar row matched");
  const row = hits[0].row;
  const dateText = row.end && row.end !== row.start ? `${row.start} → ${row.end}` : row.start;
  return {
    claim, domain: "calendar", source_url: row.source_url ?? null,
    source_title: row.event ?? row.source,
    last_updated: row.retrieved_at ?? null,
    snippet: snippet(`${row.event} (${dateText})${row.description ? ": " + row.description : ""}`),
    confidence: "high", reason: `calendar match (source=${row.source}, score=${hits[0].score.toFixed(2)})`,
  };
}

async function searchCoursesDomain(claim: string): Promise<CitationCard> {
  const m = claim.match(/\b([A-Z]{3,4})\s(\d{4})\b/);
  if (!m) return none(claim, "courses", "no course-code regex match in claim");
  const code = `${m[1]} ${m[2]}`;
  const course = getCourse(code);
  if (!course) return none(claim, "courses", `course ${code} not in catalog corpus`);
  const corpus = getCourseCorpus();
  return {
    claim, domain: "courses", source_url: course.source_url,
    source_title: `${course.code}: ${course.title}`,
    last_updated: corpus?.scraped_at ?? null,
    snippet: snippet(course.description),
    confidence: "high", reason: `exact course-code match on ${code}`,
  };
}

async function searchEmergencyDomain(claim: string): Promise<CitationCard> {
  const c = getEmergencyCorpus();
  if (!c) return none(claim, "emergency", "emergency corpus not loaded");
  const claimLower = claim.toLowerCase();
  const guideline = c.guidelines.find((g) => claimLower.includes(g.slug.replace(/-/g, " ")));
  if (guideline) {
    return {
      claim, domain: "emergency", source_url: guideline.url, source_title: guideline.title,
      last_updated: c.builtAt ?? null,
      snippet: snippet(guideline.body_markdown), confidence: "high",
      reason: `slug match in emergency guideline (${guideline.slug})`,
    };
  }
  return none(claim, "emergency", "no slug match in emergency guidelines");
}

async function searchTuitionDomain(claim: string): Promise<CitationCard> {
  const c = getTuitionCorpus();
  if (!c) return none(claim, "tuition", "tuition corpus not loaded");
  const tokens = claim.toLowerCase().split(/\W+/).filter((t) => t.length > 4);
  const faq = c.faq_rows.find((r) =>
    tokens.some((t) => r.question.toLowerCase().includes(t)),
  );
  if (faq) {
    return {
      claim, domain: "tuition", source_url: faq.source_url ?? null, source_title: faq.question,
      last_updated: c.builtAt ?? null,
      snippet: snippet(faq.answer), confidence: "medium",
      reason: "tuition FAQ token-overlap match",
    };
  }
  return none(claim, "tuition", "no tuition FAQ token match");
}

async function searchDiningDomain(claim: string): Promise<CitationCard> {
  const c = getDiningCorpus();
  if (!c) return none(claim, "dining", "dining corpus not loaded");
  const claimLower = claim.toLowerCase();
  const loc = c.locations.find((l) => claimLower.includes(l.name.toLowerCase()));
  if (!loc) return none(claim, "dining", "no dining-location name found in claim");
  return {
    claim, domain: "dining", source_url: loc.url ?? null, source_title: loc.name,
    last_updated: c.builtAt ?? null,
    snippet: snippet(loc.hours_raw_text ?? ""), confidence: "high",
    reason: `dining-location name match (${loc.slug})`,
  };
}

export async function searchInDomain(claim: string, domain: CitationDomain): Promise<CitationCard> {
  switch (domain) {
    case "online":    return searchOnline(claim);
    case "policies":  return searchPoliciesDomain(claim);
    case "calendar":  return searchCalendarDomain(claim);
    case "courses":   return searchCoursesDomain(claim);
    case "emergency": return searchEmergencyDomain(claim);
    case "tuition":   return searchTuitionDomain(claim);
    case "dining":    return searchDiningDomain(claim);
  }
}
