import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getProgramBySlug, getOnlineCorpus } from "../online/corpus.js";
import { estimateCost } from "../online/matcher.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    slug: z.string().min(1).max(MAX_QUERY_CHARS),
    credits: z.number().int().min(0).max(500).optional(),
    include_application_fee: z.boolean().optional(),
  })
  .strict();

export const estimate_program_cost = {
  name: "estimate_program_cost",
  description:
    "Estimate the total cost of an MSU Online program: per_credit × credits + per-credit instructional fee, optionally + application fee. " +
    "Provide `slug` (exact, from list_online_programs); `credits` (int 0–500) is OPTIONAL — when omitted, defaults to 30 (master/cert/specialist), 120 (bachelor), or 60 (doctoral). " +
    "MSU Online does NOT publish total required credits in a structured field for every program; for an exact number, consult the program page (raw_prose is included in the response). " +
    "`include_application_fee` defaults to false. " +
    "Response carries the online disclaimer, source_url, and any explanatory notes when fields are missing. " +
    "Out-of-state? MSU Online tuition is largely flat-rate; the published per_credit_usd is what applies to most residency cases.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const program = getProgramBySlug(input.slug);
    const corpus = getOnlineCorpus();
    if (!program) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: ONLINE_DISCLAIMER,
            estimate: null,
            not_found_reason: `No program with slug '${input.slug}' in the corpus. Use list_online_programs to find valid slugs.`,
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        }],
      };
    }
    const estimate = estimateCost(
      program,
      input.credits ?? null,
      input.include_application_fee ?? false,
    );
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          disclaimer: ONLINE_DISCLAIMER,
          estimate,
          not_found_reason: null,
          corpus_built_at: corpus?.builtAt ?? null,
        }, null, 2),
      }],
    };
  },
};
