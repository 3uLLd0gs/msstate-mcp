import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  listAllPrograms,
  getOnlineCorpus,
  getAllInfoPages,
} from "../online/corpus.js";
import { rankPrograms, type StateAuthorization } from "../online/matcher.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    career_goal: z.string().max(MAX_QUERY_CHARS).optional(),
    level_preference: z
      .enum(["bachelor", "master", "specialist", "doctoral", "certificate", "endorsement"])
      .optional(),
    budget_usd: z.number().min(0).max(1_000_000).optional(),
    time_budget_months: z.number().int().min(1).max(120).optional(),
    state: z.string().regex(/^[A-Za-z]{2}$/).optional(),
    estimated_credits: z.number().int().min(0).max(500).optional(),
    include_application_fee: z.boolean().optional(),
  })
  .strict();

const US_STATE_RE = /\b([A-Z]{2})\b/g;
const ALL_50 = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);

function parseStateAuthorization(): StateAuthorization | null {
  const page = getAllInfoPages().find((p) => p.slug === "state-authorization");
  if (!page) return null;
  const matches = new Set<string>();
  for (const m of page.body_markdown.matchAll(US_STATE_RE)) {
    if (ALL_50.has(m[1])) matches.add(m[1]);
  }
  if (matches.size === 0) return null;
  return { authorized_states: [...matches] };
}

export const match_online_program = {
  name: "match_online_program",
  description:
    "Rank MSU Online programs against a prospective-student profile. ALL fields optional — supply only what the user has stated. " +
    "`career_goal` (free text — keyword overlap vs. program name + short_description), " +
    "`level_preference` (HARD filter: bachelor / master / specialist / doctoral / certificate / endorsement), " +
    "`budget_usd` (soft cap — programs over budget score lower but still appear; see estimate_program_cost for breakdown), " +
    "`time_budget_months` (penalises doctoral < 36mo and bachelor < 24mo), " +
    "`state` (2-letter postal code; cross-referenced against the state-authorization info page when present), " +
    "`estimated_credits` (optional override for cost estimation; defaults per degree level), " +
    "`include_application_fee` (default false). " +
    "Returns up to 5 matches sorted by fit_score (0–100) with fit_reasons, estimated_total_usd, application_deadline_next, primary_contact_name/email, and state_authorization_flag (ok / unknown / check_state_authorization_page). " +
    "Does NOT predict admission probability — only ranks fit. Always carries the online disclaimer.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const programs = listAllPrograms();
    const stateAuth = input.state ? parseStateAuthorization() : null;
    const matches = rankPrograms(programs, {
      career_goal: input.career_goal,
      level_preference: input.level_preference,
      budget_usd: input.budget_usd,
      time_budget_months: input.time_budget_months,
      state: input.state,
      estimated_credits: input.estimated_credits,
      include_application_fee: input.include_application_fee,
    }, stateAuth);
    const corpus = getOnlineCorpus();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          disclaimer: ONLINE_DISCLAIMER,
          matches,
          state_authorization_source: stateAuth ? "state-authorization info page" : null,
          corpus_built_at: corpus?.builtAt ?? null,
        }, null, 2),
      }],
    };
  },
};
