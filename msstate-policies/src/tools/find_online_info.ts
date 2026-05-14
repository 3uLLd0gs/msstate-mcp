import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getOnlineCorpus } from "../online/corpus.js";
import { bm25SearchInfo } from "../online/search.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    q: z.string().min(1).max(MAX_QUERY_CHARS),
    k: z.number().int().min(1).max(10).optional(),
    scope: z
      .enum(["all", "state-authorization", "military-assistance", "orientation", "faq", "financial-matters", "staff"])
      .optional(),
  })
  .strict();

export const find_online_info = {
  name: "find_online_info",
  description:
    "BM25 search over MSU Online's support pages (state-authorization, military-assistance, orientation, faq, financial-matters) + the central staff directory rendered as a searchable doc. " +
    "Use when the question isn't about a specific program (use get_online_program) and isn't the general admissions process (use get_online_admissions_process). " +
    "`scope` lets you pre-filter to a single info-page slug when the category is known. The `staff` scope searches the central staff directory. " +
    "Returns matches with `slug`, `title`, `excerpt` (~300 chars verbatim from the body), `full_body` (entire body_markdown), `source_url`, and `bm25_score`. Every response carries the online disclaimer.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const k = input.k ?? 3;
    const scope = input.scope ?? "all";
    const hits = bm25SearchInfo(input.q, k, scope);
    const corpus = getOnlineCorpus();
    const matches = hits.map((h) => {
      const body = h.row.body_markdown;
      const excerpt = body.length <= 300 ? body : body.slice(0, 300) + "…";
      return {
        slug: h.row.slug,
        title: h.row.title,
        excerpt,
        full_body: body,
        source_url: h.row.url,
        bm25_score: h.score,
      };
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: ONLINE_DISCLAIMER,
            matches,
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
