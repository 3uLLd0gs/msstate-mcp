/**
 * Semester planner — pure helpers over CourseCorpus.
 *
 * Conservative defaults:
 *  - mixed/null prereq logic -> treat as AND (the safer interpretation;
 *    advisors prefer "this might be too few" over "you can take this").
 *  - non_course prereqs -> NOT auto-satisfied (we cannot verify "instructor
 *    permission" or "admission to major"). The course is excluded from the
 *    candidate pool with an explanatory note.
 */
import type { Course, CourseCorpus } from "./types.js";

function normalize(code: string): string {
  return (code ?? "").toUpperCase().trim().replace(/\s+/g, " ");
}

export function normalizeCompleted(codes: string[]): Set<string> {
  return new Set(codes.map(normalize).filter((c) => c.length > 0));
}

export function prereqsSatisfied(course: Course, completed: Set<string>): boolean {
  const p = course.prereqs;
  if (!p) return true;
  if (p.required_courses.length === 0 && p.non_course.length === 0) return true;
  if (p.non_course.length > 0) return false; // can't verify non-course gates
  const normCompleted = new Set([...completed].map((c) => normalize(c)));
  const reqs = p.required_courses.map(normalize);
  const logic = p.logic ?? "and";
  if (logic === "or") return reqs.some((r) => normCompleted.has(r));
  // and OR mixed -> conservative AND
  return reqs.every((r) => normCompleted.has(r));
}

const DEPT_RE = /^[A-Z]{2,4}$/;

export function filterCandidateCourses(
  corpus: CourseCorpus,
  department: string,
  completed: Set<string>,
  focusKeyword: string | undefined,
  level: "undergraduate" | "graduate" | undefined,
): Course[] {
  const dept = (department ?? "").toUpperCase().trim();
  if (!DEPT_RE.test(dept)) throw new Error("department must be 2-4 letters");
  const completedNorm = new Set([...completed].map((c) => c.toUpperCase().trim().replace(/\s+/g, " ")));
  const keyword = focusKeyword?.toLowerCase().trim() || null;

  const out: Course[] = [];
  for (const c of Object.values(corpus.records)) {
    if (!c.code.startsWith(dept + " ")) continue;
    if (completedNorm.has(c.code)) continue;
    if (level && c.level !== level) continue;
    if (keyword) {
      const hay = `${c.title} ${c.description}`.toLowerCase();
      if (!hay.includes(keyword)) continue;
    }
    if (!prereqsSatisfied(c, completedNorm)) continue;
    out.push(c);
  }
  return out;
}
