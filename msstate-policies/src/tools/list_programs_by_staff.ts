import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  getStaffToProgramsIndex,
  getOnlineCorpus,
} from "../online/corpus.js";
import { resolveStaff, suggestStaff } from "../online/search.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_CHARS),
  })
  .strict();

export const list_programs_by_staff = {
  name: "list_programs_by_staff",
  description:
    "Look up the MSU Online programs a Center for Distance Education staff member is responsible for. " +
    "Query by email (preferred — unambiguous) or by name (first, last, or full name). " +
    "Returns each matching staff member's program portfolio with their role label per program. " +
    "Use for 'what programs am I responsible for?' or 'who handles the MBA?' workflows. " +
    "Email match is exact and case-insensitive; name match is case-insensitive substring (or all-tokens-present) " +
    "with diacritic normalization (so 'Elise' matches 'Élise'). " +
    "Ambiguous queries return ≥2 matches surfaced so the model can disambiguate. " +
    "No-match returns empty matches + did_you_mean (closest names by trigram similarity).",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const index = getStaffToProgramsIndex();
    const matches = resolveStaff(index, input.query);
    const corpus = getOnlineCorpus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: ONLINE_DISCLAIMER,
            query: input.query,
            match_count: matches.length,
            matches: matches.map((m) => ({
              staff: {
                display_name: m.display_name,
                email: m.email,
                role: m.role,
                match_kind: m.match_kind,
              },
              programs: m.programs,
              program_count: m.programs.length,
            })),
            did_you_mean: matches.length === 0 ? suggestStaff(index, input.query) : [],
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
