/**
 * Semester planner — types.
 *
 * Corpus rule: every Course referenced in a SemesterPlanResult MUST exist
 * in the baked CourseCorpus. The planner NEVER recommends a course it
 * cannot prove exists in catalog.msstate.edu.
 *
 * Explicit non-goals (called out in tool description AND every response.notes):
 *  - No live section / seat availability (Banner data not in scope).
 *  - No degree-requirement check (FERPA — not in catalog data).
 *  - No prediction of admission probability or grade prospects.
 */
import type { PrereqWarning } from "./types.js";

export interface SemesterPlanInput {
  department: string;          // 2-4 letter prefix, e.g., "CSE", "MA", "ENGL"
  completed_courses: string[]; // course codes like "CSE 1284"; case/space normalized server-side
  target_credits_min?: number; // default 12
  target_credits_max?: number; // default 18
  focus_keyword?: string;      // optional substring filter on title + description
  level?: "undergraduate" | "graduate"; // optional level filter
}

export interface PlanCandidateCourse {
  code: string;
  title: string;
  hours: number | string;
  prereq_summary: string | null;            // verbatim from Course.prereq_summary
  prereq_parse_warnings: PrereqWarning[];   // verbatim from Course.prereqs?.parse_warnings ?? []
  source_url: string;
}

export interface PlanCandidate {
  bundle_id: string;             // stable id within a response, e.g., "core-heavy"
  bundle_label: string;          // human-readable, e.g., "Balanced load"
  courses: PlanCandidateCourse[];
  total_credit_hours: number;    // sum of numeric hours; courses with string hours contribute 0
  string_hours_count: number;    // count of courses whose hours field was non-numeric (range/pair)
  score: number;                 // 0-100
  notes: string[];               // per-bundle annotations
}

export interface SemesterPlanResult {
  department: string;
  completed_courses_normalized: string[];
  target_credits_min: number;
  target_credits_max: number;
  candidates: PlanCandidate[];
  candidate_pool_size: number;   // count after filter, before bundle enumeration
  notes: string[];               // global disclaimers
}
