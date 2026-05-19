import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { splitClaims, routeClaim, searchInDomain } from "../citation/router.js";
import {
  CITATION_DISCLAIMER,
  MAX_INPUT_CHARS,
  MAX_CLAIMS,
  type CitationCard,
  type CitationDomain,
  type CitationResult,
} from "../citation/types.js";

const Input = z
  .object({
    text: z.string().min(1).max(MAX_INPUT_CHARS),
    domain_hints: z
      .array(z.enum(["policies", "calendar", "courses", "emergency", "tuition", "online", "dining"]))
      .optional(),
  })
  .strict();

export const citation_card = {
  name: "citation_card",
  description:
    "Trust-surface meta-tool. Given an answer `text`, splits it into sentence-level claims and returns one citation card per claim — {claim, domain, source_url, source_title, last_updated, snippet, confidence}. " +
    "When the model produces an answer about MSU, call this tool with the answer text to attach receipts. Each card cites the canonical MSU page the claim came from, the last-updated timestamp from the corpus snapshot, and a confidence level. " +
    "`domain_hints` (optional) is an ordered list of domain preferences ('policies', 'calendar', 'courses', 'emergency', 'tuition', 'online', 'dining') applied to all claims, taking priority over the keyword router. " +
    "Cards with confidence='none' mean we could not trace the claim to an MSU source — present those claims as unverified to the user. NEVER fabricate a citation for a 'none' card. " +
    "Caps: input up to 8000 chars, up to 40 claims processed per call (the rest is truncated and flagged via claims_truncated).",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const input = Input.parse(rawInput);
    const split = splitClaims(input.text);
    const rawClaims = split.claims;
    const truncated = split.totalBeforeCap > MAX_CLAIMS;
    const cards: CitationCard[] = [];
    const counts: Record<CitationDomain | "none", number> = {
      policies: 0, calendar: 0, courses: 0, emergency: 0,
      tuition: 0, online: 0, dining: 0, none: 0,
    };
    for (const claim of rawClaims) {
      const domain = routeClaim(claim, input.domain_hints);
      const card: CitationCard = domain
        ? await searchInDomain(claim, domain)
        : {
            claim, domain: null, source_url: null, source_title: null,
            last_updated: null, snippet: null, confidence: "none",
            reason: "router could not assign a domain",
          };
      cards.push(card);
      counts[card.domain ?? "none"]++;
    }
    const result: CitationResult = {
      disclaimer: CITATION_DISCLAIMER,
      cards,
      claims_processed: cards.length,
      claims_truncated: truncated,
      by_domain_counts: counts,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
