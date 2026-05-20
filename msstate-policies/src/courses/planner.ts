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

import type { PlanCandidate, PlanCandidateCourse } from "./planner-types.js";

const MAX_CANDIDATE_POOL = 80;
const MAX_BUNDLES = 3;

function numericHours(h: number | string): number {
  return typeof h === "number" ? h : 0;
}

function isStringHours(h: number | string): boolean {
  return typeof h !== "number";
}

function toCandidateCourse(c: Course): PlanCandidateCourse {
  return {
    code: c.code,
    title: c.title,
    hours: c.hours,
    prereq_summary: c.prereq_summary,
    prereq_parse_warnings: c.prereqs?.parse_warnings ?? [],
    source_url: c.source_url,
  };
}

// Enumerate up-to-MAX_BUNDLE_SIZE-element subsets of candidates such that
// the credit-hour sum falls in [minCr, maxCr]. To keep this O(N^5) bounded,
// the candidate pool is sliced to MAX_CANDIDATE_POOL first.
export function generateBundles(
  candidates: Course[],
  minCr: number,
  maxCr: number,
): PlanCandidate[] {
  if (minCr < 0 || maxCr < minCr) return [];
  const pool = candidates.slice(0, MAX_CANDIDATE_POOL);
  const bundles: Map<string, { courses: Course[]; total: number; stringCount: number }> = new Map();
  const N = pool.length;

  function tryAdd(items: Course[]) {
    const total = items.reduce((s, c) => s + numericHours(c.hours), 0);
    if (total < minCr || total > maxCr) return;
    const stringCount = items.filter((c) => isStringHours(c.hours)).length;
    const codes = items.map((c) => c.code).sort();
    const key = codes.join(",");
    if (!bundles.has(key)) bundles.set(key, { courses: items, total, stringCount });
  }

  // 1-course bundles
  for (let i = 0; i < N; i++) tryAdd([pool[i]]);
  // Bundle size is structurally capped at 5 by the loop depth below.
  // Changing the cap requires adding/removing loop levels.
  // 2-5-course bundles via simple nested loops; bounded by MAX_CANDIDATE_POOL.
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      tryAdd([pool[i], pool[j]]);
      for (let k = j + 1; k < N; k++) {
        tryAdd([pool[i], pool[j], pool[k]]);
        for (let l = k + 1; l < N; l++) {
          tryAdd([pool[i], pool[j], pool[k], pool[l]]);
          for (let m = l + 1; m < N; m++) {
            tryAdd([pool[i], pool[j], pool[k], pool[l], pool[m]]);
          }
        }
      }
    }
  }

  // Rank: prefer bundles with (a) total closer to midpoint of credit window,
  // (b) more unique-department coverage (proxy for diversity), (c) fewer
  // string-hours courses (less ambiguity).
  const midpoint = (minCr + maxCr) / 2;
  const ranked = [...bundles.values()].map(({ courses, total, stringCount }) => {
    const distance = Math.abs(total - midpoint);
    const distinctDepts = new Set(courses.map((c) => c.code.split(" ")[0])).size;
    const score = Math.max(0, Math.round(100 - distance * 5 - stringCount * 5 + distinctDepts * 3));
    return { courses, total, stringCount, score };
  }).sort((a, b) => b.score - a.score);

  // Take top MAX_BUNDLES distinct (already distinct by key).
  const top = ranked.slice(0, MAX_BUNDLES);
  return top.map((b, i) => ({
    bundle_id: ["core", "balanced", "stretch"][i] ?? `bundle-${i}`,
    bundle_label: ["Core load", "Balanced load", "Stretch load"][i] ?? `Bundle ${i + 1}`,
    courses: b.courses.map(toCandidateCourse),
    total_credit_hours: b.total,
    string_hours_count: b.stringCount,
    score: b.score,
    notes: b.stringCount > 0
      ? [`${b.stringCount} course(s) have variable credit hours — total assumes 0 for those; consult catalog.`]
      : [],
  }));
}

// Exported for testing; mainly the score is computed inline inside generateBundles.
export function scorePlan(plan: PlanCandidate): number {
  return plan.score;
}
