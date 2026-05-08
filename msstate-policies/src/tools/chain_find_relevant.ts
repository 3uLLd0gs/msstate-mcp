import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { fetchIndex } from "../scraper.js";
import {
  hybridSearch,
  indexEntries,
  gateRetrieval,
  attachBodiesFromEmbeddings,
  extractMatchedPassages,
  tokenize,
  MatchedPassage,
} from "../search.js";
import { getPolicies } from "../corpus.js";
import { PolicyDocument } from "../types.js";

const ChainInput = z.object({
  question: z.string().min(1).describe("Natural-language MSU policy question."),
  k: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(2)
    .describe(
      "How many top policies to fetch in full. Default 2 keeps response under ~16k tokens.",
    ),
});

// ---- F4 evidence assembly (codex_review.md) ---------------------------------
//
// Pure mapper: PolicyDocument[] -> the MCP tool's results envelope, with a
// per-result primaryEvidence array of short matched-passage windows. Lets the
// model anchor its quotation in the relevant snippet rather than scanning a
// 5-page distractor body.

export interface EvidenceResultItem {
  number: string;
  title: string;
  url: string;
  pdfUrl: string;
  effectiveDate: string | null;
  lastRevisedDate: string | null;
  responsibleOffice: string | null;
  fallbackToLanding: boolean;
  retrievedAt: string;
  text: string;
  primaryEvidence: MatchedPassage[];
}

export interface EvidenceResult {
  question: string;
  k: number;
  results: EvidenceResultItem[];
}

export function buildEvidenceResult(
  question: string,
  k: number,
  docs: PolicyDocument[],
): EvidenceResult {
  const queryTokens = tokenize(question);
  return {
    question,
    k,
    results: docs.map((d) => ({
      number: d.number,
      title: d.title,
      url: d.landingUrl,
      pdfUrl: d.pdfUrl,
      effectiveDate: d.effectiveDate,
      lastRevisedDate: d.lastRevisedDate,
      responsibleOffice: d.responsibleOffice,
      fallbackToLanding: d.fallbackToLanding,
      retrievedAt: d.retrievedAt,
      text: d.text,
      primaryEvidence: extractMatchedPassages(d.text, queryTokens),
    })),
  };
}

export const chain_find_relevant_policies = {
  name: "chain_find_relevant_policies",
  description:
    "One-call workflow for natural-language MSU policy questions ('what are the rules on amnesty?', 'what's the policy on withdrawal?'). Returns the full text of the top-k most relevant MSU Operating Policies. RULES for answering: (1) Use ONLY the returned text — do not draw on outside knowledge. (2) For any normative claim ('the policy says X', 'you must Y', deadlines, eligibility criteria, dollar amounts, exceptions), QUOTE VERBATIM from the policy text in quotation marks and cite the OP number + URL. Do not paraphrase load-bearing language. (3) If the returned policies don't clearly answer the question, say so plainly and recommend contacting the responsible office; do NOT extrapolate. (4) Always include the `retrievedAt` timestamp and the canonical landing URL so the user can verify.",
  inputSchema: zodToJsonSchema(ChainInput, { target: "openApi3" }),
  zodSchema: ChainInput,
  async handler(rawInput: unknown) {
    const input = ChainInput.parse(rawInput);
    const idx = await fetchIndex();
    indexEntries(idx.rows);
    // F1 (codex_review.md): seed BM25 body tokens from the shipped embeddings
    // chunks BEFORE hybridSearch. Without this, body-only queries (e.g.
    // "tornado warning") miss policies whose titles don't contain the term.
    // No-op when embeddings.json is absent; fail-degraded, not silently wrong.
    attachBodiesFromEmbeddings();

    const fused = await hybridSearch(input.question, { topK: input.k });

    // F2 (codex_review.md): gate on confidence at the MCP layer instead of
    // pushing every refusal decision to the LLM. Permissive defaults keep the
    // existing eval set passing; tighter thresholds can be calibrated later.
    const gate = gateRetrieval(fused);
    if (gate.rejected) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                question: input.question,
                results: [],
                note: `No policies met the confidence threshold. Recommend asking the responsible office directly. (gate: ${gate.reason})`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const docs = await getPolicies(gate.accept.map((h) => h.slug));
    // F4 (codex_review.md): build the result envelope through the pure
    // buildEvidenceResult helper so each result carries primaryEvidence —
    // short matched-passage windows the model can anchor its quotation in,
    // instead of scanning the entire policy body for the relevant section.
    const payload = buildEvidenceResult(input.question, input.k, docs);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  },
};
