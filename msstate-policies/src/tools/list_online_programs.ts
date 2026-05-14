import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { listAllPrograms, getOnlineCorpus } from "../online/corpus.js";
import { filterPrograms } from "../online/search.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    level: z.enum(["bachelor", "master", "specialist", "doctoral", "certificate", "endorsement"]).optional(),
    subject_keyword: z.string().max(MAX_QUERY_CHARS).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

export const list_online_programs = {
  name: "list_online_programs",
  description:
    "Browse / filter MSU's online programs from online.msstate.edu. Returns lightweight rows ({slug, name, degree_level, short_description, url}); for full per-program details (contacts, deadlines, tuition) follow up with get_online_program. " +
    "`level` filters by degree level (bachelor / master / specialist / doctoral / certificate / endorsement). " +
    "`subject_keyword` is a case-insensitive substring match against the name + short_description (e.g. 'engineering', 'business', 'education'). " +
    "`limit` (default 50, max 200) and `offset` (default 0) for pagination. Every response carries the online disclaimer about info changing.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const result = filterPrograms(listAllPrograms(), {
      level: input.level,
      subject_keyword: input.subject_keyword,
      limit: input.limit,
      offset: input.offset,
    });
    const corpus = getOnlineCorpus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: ONLINE_DISCLAIMER,
            matches: result.matches,
            total: result.total,
            filtered_total: result.filtered_total,
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
