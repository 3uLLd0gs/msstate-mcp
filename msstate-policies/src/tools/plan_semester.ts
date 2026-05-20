import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getCourseCorpus } from "../courses/corpus.js";
import {
  filterCandidateCourses,
  generateBundles,
  normalizeCompleted,
} from "../courses/planner.js";
import { MAX_QUERY_CHARS } from "../courses/types.js";
import type { SemesterPlanResult } from "../courses/planner-types.js";

const Input = z
  .object({
    department: z.string().min(2).max(MAX_QUERY_CHARS),
    completed_courses: z.array(z.string().max(MAX_QUERY_CHARS)).max(200).default([]),
    target_credits_min: z.number().int().min(0).max(30).default(12),
    target_credits_max: z.number().int().min(0).max(30).default(18),
    focus_keyword: z.string().max(MAX_QUERY_CHARS).optional(),
    level: z.enum(["undergraduate", "graduate"]).optional(),
  })
  .strict()
  .refine((v) => v.target_credits_max >= v.target_credits_min, {
    message: "target_credits_max must be >= target_credits_min",
  });

const NON_GOAL_NOTES = [
  "Plan does NOT check live section / seat availability — catalog.msstate.edu does not publish term sections.",
  "Plan does NOT verify degree requirement coverage — required-for-major lists are not in the catalog corpus.",
  "Plan does NOT predict admission to restricted courses (e.g., major-restricted, instructor-permission).",
];

export const plan_semester = {
  name: "plan_semester",
  description:
    "Catalog-only semester planner. Given a `department` (2-4 letter prefix like 'CSE' / 'MA' / 'ENGL') and the student's `completed_courses` (course codes), returns up to 3 candidate bundles of courses sized to the credit-hour window (default 12-18). " +
    "Each bundle's courses are prereq-validated against `completed_courses` (conservative AND on mixed/null logic; non_course gates like 'instructor permission' exclude the course). " +
    "Optional `focus_keyword` filters on title + description (e.g., 'algorithms'). Optional `level` restricts to undergraduate or graduate. " +
    "EXPLICIT NON-GOALS: this does NOT check live section / seat availability, does NOT verify degree requirement coverage, does NOT predict admission to restricted courses. Treat output as a starting point for advising, not a registration plan. Every response surfaces these limits in the `notes` field.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const corpus = getCourseCorpus();
    if (!corpus) {
      const result: SemesterPlanResult = {
        department: input.department.toUpperCase(),
        completed_courses_normalized: [],
        target_credits_min: input.target_credits_min,
        target_credits_max: input.target_credits_max,
        candidates: [],
        candidate_pool_size: 0,
        notes: ["course corpus not loaded — server may be in cold-start", ...NON_GOAL_NOTES],
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    const completed = normalizeCompleted(input.completed_courses);
    const candidates = filterCandidateCourses(
      corpus, input.department, completed, input.focus_keyword, input.level,
    );
    const bundles = generateBundles(candidates, input.target_credits_min, input.target_credits_max);

    const notes = [...NON_GOAL_NOTES];
    if (bundles.length === 0) {
      notes.unshift(
        candidates.length === 0
          ? `no valid bundle: no courses in ${input.department.toUpperCase()} satisfied prereqs from completed_courses (pool=${candidates.length})`
          : `no valid bundle: ${candidates.length} candidate course(s) but none combine to a total within [${input.target_credits_min}, ${input.target_credits_max}] credit-hour window`,
      );
    }

    const result: SemesterPlanResult = {
      department: input.department.toUpperCase(),
      completed_courses_normalized: [...completed],
      target_credits_min: input.target_credits_min,
      target_credits_max: input.target_credits_max,
      candidates: bundles,
      candidate_pool_size: candidates.length,
      notes,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
};
