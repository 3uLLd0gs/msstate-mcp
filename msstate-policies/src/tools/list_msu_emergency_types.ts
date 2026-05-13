import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { listGuidelines } from "../emergency/corpus.js";
import { MANDATORY_DISCLAIMER } from "../emergency/types.js";

const Input = z.object({}).strict();

export const list_msu_emergency_types = {
  name: "list_msu_emergency_types",
  description:
    "List MSU's published emergency-guideline types (12 entries: tornado, fire, active threat, evacuation, etc.). Returns `{ slug, title, url }` for each. Pair with `get_msu_emergency_guideline` to fetch the body. Every response leads with the 911 disclaimer. All content sourced from www.emergency.msstate.edu/guidelines.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    Input.parse(rawInput);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              disclaimer: MANDATORY_DISCLAIMER,
              types: listGuidelines().map((g) => ({
                slug: g.slug,
                title: g.title,
                url: g.url,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
