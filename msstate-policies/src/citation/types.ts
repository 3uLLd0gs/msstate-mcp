/**
 * Citation card — trust-surface meta-tool over all seven MSU corpora.
 *
 * Corpus rule (CLAUDE.md): every citation MUST originate from a baked
 * corpus entry. NEVER fabricate a URL or paraphrase that wasn't already
 * in the corpus snippet returned by the per-domain search helper.
 */

export type CitationDomain =
  | "policies"
  | "calendar"
  | "courses"
  | "emergency"
  | "tuition"
  | "online"
  | "dining";

export const ALL_DOMAINS: readonly CitationDomain[] = Object.freeze([
  "policies", "calendar", "courses", "emergency", "tuition", "online", "dining",
]);

/**
 * MAX_CLAIM_CHARS limits each split claim to keep tokenize() bounded.
 * MAX_INPUT_CHARS limits the total citation_card input.
 * MAX_CLAIMS caps how many claims we process per call.
 */
export const MAX_CLAIM_CHARS = 800;
export const MAX_INPUT_CHARS = 8000;
export const MAX_CLAIMS = 40;

export const CITATION_DISCLAIMER =
  "Citations are matched against MSU's published corpora. A 'no_citation_found' result means we couldn't trace the claim to an MSU source — treat that claim as unverified.";

export interface CitationCard {
  claim: string;
  domain: CitationDomain | null;        // null when no domain matched
  source_url: string | null;
  source_title: string | null;
  last_updated: string | null;          // ISO timestamp from corpus.builtAt / scraped_at
  snippet: string | null;               // up to 240 chars from the matched corpus entry
  confidence: "high" | "medium" | "low" | "none";
  reason: string;                        // why this result was returned (or why nothing matched)
}

export interface CitationResult {
  disclaimer: string;
  cards: CitationCard[];
  claims_processed: number;
  claims_truncated: boolean;             // true when MAX_CLAIMS exceeded
  by_domain_counts: Record<CitationDomain | "none", number>;
}
