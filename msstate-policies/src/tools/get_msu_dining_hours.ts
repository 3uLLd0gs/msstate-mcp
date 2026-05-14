import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  getDiningLocationBySlug,
  listAllDiningLocations,
  getDiningCorpus,
} from "../dining/corpus.js";
import { fuzzyResolveLocation, computeOpenStatus } from "../dining/search.js";
import { DINING_DISCLAIMER, MAX_QUERY_CHARS } from "../dining/types.js";

const Input = z
  .object({
    slug: z.string().min(1).max(MAX_QUERY_CHARS).optional(),
    name_query: z.string().min(1).max(MAX_QUERY_CHARS).optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.slug) !== Boolean(v.name_query),
    { message: "Exactly one of slug or name_query is required" },
  );

export const get_msu_dining_hours = {
  name: "get_msu_dining_hours",
  description:
    "Fetch one MSU dining venue's full record: name + url + per-day hours + today's meal periods + status_now (open / closed / closes_at / opens_at, computed in America/Chicago). " +
    "Provide `slug` (e.g., 'perry-food-hall', 'chick-fil-a') for direct lookup, OR `name_query` (e.g., 'perry', 'chickfila') for fuzzy match. Exactly one required. " +
    "When name_query matches multiple venues, top-1 is in `matched` and next-2 in `did_you_mean`. " +
    "Every response carries the dining disclaimer.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const corpus = getDiningCorpus();
    let matched = null;
    let did_you_mean: Array<{ slug: string; name: string }> = [];
    let not_found_reason: string | null = null;

    if (input.slug) {
      matched = getDiningLocationBySlug(input.slug);
      if (!matched) not_found_reason = `No location with slug '${input.slug}'. Try list_msu_dining_locations to see valid slugs.`;
    } else if (input.name_query) {
      const r = fuzzyResolveLocation(listAllDiningLocations(), input.name_query);
      matched = r.matched;
      did_you_mean = r.did_you_mean;
      if (!matched) not_found_reason = `No location matched '${input.name_query}'. Try list_msu_dining_locations(name_substring=...) to browse.`;
    }

    const status_now = matched ? computeOpenStatus(matched, new Date()) : null;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: DINING_DISCLAIMER,
            matched,
            status_now,
            did_you_mean,
            not_found_reason,
            corpus_built_at: corpus?.builtAt ?? null,
            source_url: matched?.url ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
