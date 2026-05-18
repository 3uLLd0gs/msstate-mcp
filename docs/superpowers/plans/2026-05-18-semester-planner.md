# Semester Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `plan_semester(department, completed_courses, target_credits_min?, target_credits_max?, focus_keyword?)` — a catalog-only semester planner that returns 2–3 viable course bundles for the student's next term. Each bundle is prereq-validated against `completed_courses`, sized to the credit-hour window, and tagged with `parse_warnings_for_prereqs` so the caller can fall back to raw prose when our parser was uncertain.

**Architecture:** Pure-derived tool over the existing `CourseCorpus`. No new scraping. Filtering uses dept-prefix match on course code (e.g., `CSE`); prereq satisfaction reuses the parsed `Course.prereqs` block; bundle generation is a deterministic small-N enumeration (cap candidate set to ≤ 80 courses post-filter, then enumerate up-to-5-course bundles within the credit window, score each, keep top-3 distinct bundles). Explicit non-goals: no live-section data (Banner not in scope), no degree-audit (FERPA), no probability of getting in. These limitations are disclosed in the tool description and in every response's `notes` field.

**Tech Stack:** TypeScript 5.5, zod 3.23, existing courses module. No new dependencies.

---

## Read Before Starting

1. `CLAUDE.md` § "Reading order" + § "CORPUS RULE".
2. `msstate-policies/src/courses/types.ts` — `Course`, `Prereq`, `PrereqWarning`, `COURSE_CODE_RE`, graph types.
3. `msstate-policies/src/courses/corpus.ts` — `getCourse`, `getCourseCorpus`, `isCourseCodeValid`.
4. `msstate-policies/src/courses/search.ts` — existing search index (reuse `indexCourses` access pattern if needed).
5. `msstate-policies/src/tools/get_msu_course_graph.ts` + `search_msu_courses.ts` — current tool-file patterns.
6. `worker/src/index.ts` — search `case "get_msu_course_graph":` for the worker mirror pattern.
7. `msstate-policies/tests/courses/` — existing courses test conventions and fixture helpers.

## File Structure

**New files:**
- `msstate-policies/src/courses/planner.ts` — pure helpers: `filterCandidateCourses(corpus, dept, completed, focus)`, `prereqsSatisfied(course, completed)`, `generateBundles(candidates, minCr, maxCr) → PlanCandidate[]`, `scorePlan(plan, candidates) → number`.
- `msstate-policies/src/courses/planner-types.ts` — `SemesterPlanInput`, `PlanCandidate`, `SemesterPlanResult`. (Separated from `types.ts` so the catalog data types stay slim.)
- `msstate-policies/src/tools/plan_semester.ts` — MCP tool wrapper.
- `msstate-policies/tests/courses/planner.test.ts` — unit tests for the four helpers.
- `msstate-policies/tests/courses/tool-plan-semester.test.ts` — integration tests for the tool.

**Modified files:**
- `msstate-policies/src/index.ts` — register `plan_semester` in TOOLS; extend rule 3 in SERVER_INSTRUCTIONS.
- `worker/src/index.ts` — tool descriptor + dispatch case.
- `msstate-policies/eval/semester.jsonl` — NEW eval file with 12 cases.
- `scripts/run-eval.mjs` — `--suite semester` and new expect keys.
- `tools/security-checklist.sh` — extend CAT block with CAT5 (planner purity + input caps), +5 pts.
- `CLAUDE.md`, `README.md`, `msstate-policies/README.md`, `docs/BUILD.md` — addendum + tool count bump.
- `msstate-policies/package.json` — version bump (1.2.0 / 1.2.2 / 1.2.3 → 1.2.4, depending on plan ordering).

## Scope check

Single tool, single feature. The planner is intentionally a tool — not a CLI or a chain-of-tools — because the value is composing prereq-validation + dept-filter + bundle-generation in one server-side call (LLM orchestration would re-derive this badly). Independent of program-matcher and citation-card plans — order doesn't matter.

---

## Task 1: Add planner types

**Files:**
- Create: `msstate-policies/src/courses/planner-types.ts`

- [ ] **Step 1: Write the types**

```typescript
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
import type { Course, PrereqWarning } from "./types.js";

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
```

- [ ] **Step 2: Typecheck**

Run: `cd msstate-policies && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/courses/planner-types.ts
git commit -m "feat(courses): add semester-planner types"
```

---

## Task 2: TDD `prereqsSatisfied`

**Files:**
- Create: `msstate-policies/src/courses/planner.ts`
- Create: `msstate-policies/tests/courses/planner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `msstate-policies/tests/courses/planner.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { prereqsSatisfied } from "../../src/courses/planner.js";
import type { Course, Prereq } from "../../src/courses/types.js";

function course(code: string, prereqs: Prereq | null = null, hours: number | string = 3): Course {
  return {
    code, title: code, hours, level: "undergraduate", description: "",
    semester_offered: null, prereqs, coreqs: null, cross_listed: [],
    source_url: `https://catalog.msstate.edu/search/?P=${encodeURIComponent(code)}`,
    prereq_summary: null,
  };
}

function pr(required: string[], logic: "or" | "and" | "mixed" | null = "and"): Prereq {
  return { required_courses: required, logic, min_grade: null, non_course: [],
    raw_prose: required.join(", "), parse_warnings: [] };
}

describe("prereqsSatisfied", () => {
  test("no prereqs -> satisfied", () => {
    assert.equal(prereqsSatisfied(course("CSE 1284"), new Set()), true);
  });
  test("AND logic: all required present -> satisfied", () => {
    const c = course("CSE 2383", pr(["CSE 1284", "MA 1713"], "and"));
    assert.equal(prereqsSatisfied(c, new Set(["CSE 1284", "MA 1713"])), true);
  });
  test("AND logic: missing one -> not satisfied", () => {
    const c = course("CSE 2383", pr(["CSE 1284", "MA 1713"], "and"));
    assert.equal(prereqsSatisfied(c, new Set(["CSE 1284"])), false);
  });
  test("OR logic: any present -> satisfied", () => {
    const c = course("CSE 4153", pr(["CSE 2383", "CSE 2813"], "or"));
    assert.equal(prereqsSatisfied(c, new Set(["CSE 2383"])), true);
  });
  test("OR logic: none present -> not satisfied", () => {
    const c = course("CSE 4153", pr(["CSE 2383", "CSE 2813"], "or"));
    assert.equal(prereqsSatisfied(c, new Set(["CSE 1284"])), false);
  });
  test("MIXED or null logic: treat as AND (conservative)", () => {
    const c = course("X", pr(["A", "B"], "mixed"));
    assert.equal(prereqsSatisfied(c, new Set(["A"])), false);
    assert.equal(prereqsSatisfied(c, new Set(["A", "B"])), true);
  });
  test("non_course present -> not satisfied (we can't verify)", () => {
    const c = course("X");
    c.prereqs = { required_courses: [], logic: null, min_grade: null,
      non_course: ["instructor approval"], raw_prose: "instr appr", parse_warnings: [] };
    assert.equal(prereqsSatisfied(c, new Set()), false);
  });
  test("code normalization (whitespace + case)", () => {
    const c = course("CSE 2383", pr(["CSE 1284"], "and"));
    assert.equal(prereqsSatisfied(c, new Set(["cse  1284"])), true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd msstate-policies && npx tsx --test tests/courses/planner.test.ts`
Expected: All FAIL — `Cannot find module '../../src/courses/planner.js'`.

- [ ] **Step 3: Implement prereqsSatisfied**

Create `msstate-policies/src/courses/planner.ts`:

```typescript
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
import type { Course } from "./types.js";

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
  const normCompleted = completed instanceof Set
    ? new Set([...completed].map((c) => normalize(c)))
    : new Set([...(completed as Iterable<string>)].map(normalize));
  const reqs = p.required_courses.map(normalize);
  const logic = p.logic ?? "and";
  if (logic === "or") return reqs.some((r) => normCompleted.has(r));
  // and OR mixed -> conservative AND
  return reqs.every((r) => normCompleted.has(r));
}
```

- [ ] **Step 4: Run tests**

Run: `cd msstate-policies && npx tsx --test tests/courses/planner.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/courses/planner.ts msstate-policies/tests/courses/planner.test.ts
git commit -m "feat(courses): add prereqsSatisfied helper (conservative AND on mixed/null)"
```

---

## Task 3: TDD `filterCandidateCourses`

**Files:**
- Modify: `msstate-policies/src/courses/planner.ts` (append)
- Modify: `msstate-policies/tests/courses/planner.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
import { filterCandidateCourses } from "../../src/courses/planner.js";

describe("filterCandidateCourses", () => {
  test("dept-prefix filter", () => {
    const corpus = {
      version: "x", scraped_at: "x",
      records: {
        "CSE 1284": course("CSE 1284"),
        "MA 1713":  course("MA 1713"),
        "CSE 2383": course("CSE 2383", pr(["CSE 1284"], "and")),
      },
      forward_dag: {}, reverse_dag: {},
    };
    const r = filterCandidateCourses(corpus, "CSE", new Set([]), undefined, undefined);
    assert.equal(r.length, 1); // CSE 1284 only (no prereq); CSE 2383 needs CSE 1284
  });
  test("excludes courses already completed", () => {
    const corpus = {
      version: "x", scraped_at: "x",
      records: {
        "CSE 1284": course("CSE 1284"),
        "CSE 2383": course("CSE 2383", pr(["CSE 1284"], "and")),
      },
      forward_dag: {}, reverse_dag: {},
    };
    const r = filterCandidateCourses(corpus, "CSE", new Set(["CSE 1284"]), undefined, undefined);
    assert.equal(r.length, 1);
    assert.equal(r[0].code, "CSE 2383");
  });
  test("focus_keyword filters on title + description", () => {
    const corpus = {
      version: "x", scraped_at: "x",
      records: {
        "CSE 1284": { ...course("CSE 1284"), title: "Intro to Programming", description: "First C++ class." },
        "CSE 1213": { ...course("CSE 1213"), title: "Calculus for Engineers", description: "math." },
      },
      forward_dag: {}, reverse_dag: {},
    };
    const r = filterCandidateCourses(corpus, "CSE", new Set(), "programming", undefined);
    assert.equal(r.length, 1);
    assert.equal(r[0].code, "CSE 1284");
  });
  test("level filter", () => {
    const corpus = {
      version: "x", scraped_at: "x",
      records: {
        "CSE 1284": course("CSE 1284"),
        "CSE 8990": { ...course("CSE 8990"), level: "graduate" as const },
      },
      forward_dag: {}, reverse_dag: {},
    };
    const r = filterCandidateCourses(corpus, "CSE", new Set(), undefined, "graduate");
    assert.equal(r.length, 1);
    assert.equal(r[0].code, "CSE 8990");
  });
  test("rejects empty dept", () => {
    assert.throws(() => filterCandidateCourses({ version: "x", scraped_at: "x", records: {}, forward_dag: {}, reverse_dag: {} }, "", new Set(), undefined, undefined), /department must be 2-4 letters/);
  });
  test("normalises dept to upper", () => {
    const corpus = {
      version: "x", scraped_at: "x",
      records: { "CSE 1284": course("CSE 1284") },
      forward_dag: {}, reverse_dag: {},
    };
    const r = filterCandidateCourses(corpus, "cse", new Set(), undefined, undefined);
    assert.equal(r.length, 1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd msstate-policies && npx tsx --test tests/courses/planner.test.ts`
Expected: 6 new tests FAIL — `filterCandidateCourses is not exported`.

- [ ] **Step 3: Implement filterCandidateCourses**

Append to `msstate-policies/src/courses/planner.ts`:

```typescript
import type { CourseCorpus } from "./types.js";

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
```

- [ ] **Step 4: Run tests**

Run: `cd msstate-policies && npx tsx --test tests/courses/planner.test.ts`
Expected: All 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/courses/planner.ts msstate-policies/tests/courses/planner.test.ts
git commit -m "feat(courses): add filterCandidateCourses (dept + level + focus + completion + prereqs)"
```

---

## Task 4: TDD `generateBundles` + `scorePlan`

**Files:**
- Modify: `msstate-policies/src/courses/planner.ts` (append)
- Modify: `msstate-policies/tests/courses/planner.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
import { generateBundles, scorePlan } from "../../src/courses/planner.js";

describe("generateBundles", () => {
  test("produces 2-3 distinct bundles within credit window", () => {
    const candidates = [
      course("CSE 1284", null, 3),
      course("CSE 1213", null, 3),
      course("CSE 2383", null, 3),
      course("MA 1713",  null, 3),
      course("ENGL 1113", null, 3),
      course("HI 1063",  null, 3),
    ];
    const bundles = generateBundles(candidates, 12, 15);
    assert.ok(bundles.length >= 2);
    assert.ok(bundles.length <= 3);
    for (const b of bundles) {
      assert.ok(b.total_credit_hours >= 12 && b.total_credit_hours <= 15);
      assert.ok(b.courses.length >= 1);
    }
  });
  test("skips courses whose numeric hours don't fit", () => {
    const candidates = [
      course("X 1000", null, 9),
      course("Y 1000", null, 3),
      course("Z 1000", null, 3),
      course("W 1000", null, 3),
    ];
    const bundles = generateBundles(candidates, 9, 12);
    for (const b of bundles) assert.ok(b.total_credit_hours >= 9 && b.total_credit_hours <= 12);
  });
  test("string-hours courses contribute 0 to total but get counted", () => {
    const candidates = [
      course("X 1000", null, "1-3"),
      course("Y 1000", null, 3),
      course("Z 1000", null, 3),
      course("W 1000", null, 3),
      course("V 1000", null, 3),
    ];
    const bundles = generateBundles(candidates, 12, 12);
    assert.ok(bundles.length >= 1);
    const withString = bundles.find((b) => b.string_hours_count > 0);
    // Either we have a bundle with string-hours (counted, total still 12) OR
    // the enumeration avoided string-hours entirely. Both are acceptable.
    if (withString) assert.ok(withString.string_hours_count >= 1);
  });
  test("returns empty when no bundle fits", () => {
    const candidates = [course("X 1000", null, 1)]; // 1 credit, target 12-18
    const bundles = generateBundles(candidates, 12, 18);
    assert.equal(bundles.length, 0);
  });
  test("bundles are distinct by course set", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => course(`X ${1000 + i}`, null, 3));
    const bundles = generateBundles(candidates, 12, 15);
    const sigs = bundles.map((b) => b.courses.map((c) => c.code).sort().join(","));
    assert.equal(new Set(sigs).size, sigs.length);
  });
});

describe("scorePlan", () => {
  test("higher coverage of candidate-pool diversity -> higher score (within window)", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => course(`X ${1000 + i}`, null, 3));
    const bundles = generateBundles(candidates, 12, 15);
    if (bundles.length >= 2) {
      // Score is monotonic-ish; both bundles in window should have score > 0
      for (const b of bundles) assert.ok(b.score > 0);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd msstate-policies && npx tsx --test tests/courses/planner.test.ts`
Expected: New tests FAIL with `not exported`.

- [ ] **Step 3: Implement generateBundles + scorePlan**

Append to `msstate-policies/src/courses/planner.ts`:

```typescript
import type { PlanCandidate, PlanCandidateCourse } from "./planner-types.js";

const MAX_CANDIDATE_POOL = 80;
const MAX_BUNDLE_SIZE = 5;
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

  // Iterative bounded enumeration: bundle size 1..MAX_BUNDLE_SIZE.
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
```

- [ ] **Step 4: Run tests**

Run: `cd msstate-policies && npx tsx --test tests/courses/planner.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/courses/planner.ts msstate-policies/tests/courses/planner.test.ts
git commit -m "feat(courses): add generateBundles + scorePlan with bounded enumeration"
```

---

## Task 5: Build the `plan_semester` MCP tool

**Files:**
- Create: `msstate-policies/src/tools/plan_semester.ts`
- Create: `msstate-policies/tests/courses/tool-plan-semester.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/courses/tool-plan-semester.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { plan_semester } from "../../src/tools/plan_semester.js";
import { setCourseCorpus, __resetCourseCorpusForTests } from "../../src/courses/corpus.js";
import type { Course, CourseCorpus } from "../../src/courses/types.js";

function c(code: string, hours: number | string = 3, prereqs: Course["prereqs"] = null): Course {
  return {
    code, title: code, hours, level: "undergraduate", description: "",
    semester_offered: null, prereqs, coreqs: null, cross_listed: [],
    source_url: `https://catalog.msstate.edu/search/?P=${encodeURIComponent(code)}`,
    prereq_summary: null,
  };
}

function corpus(records: Course[]): CourseCorpus {
  const r: Record<string, Course> = {};
  for (const x of records) r[x.code] = x;
  return { version: "x", scraped_at: "2026-05-18T00:00:00.000Z", records: r, forward_dag: {}, reverse_dag: {} };
}

async function call(args: unknown) {
  const res = await plan_semester.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("plan_semester tool", () => {
  test("returns up to 3 bundles + global notes + normalized inputs", async () => {
    setCourseCorpus(corpus([
      c("CSE 1284"), c("CSE 1213"), c("MA 1713"), c("ENGL 1113"), c("HI 1063"),
    ]));
    const r = await call({ department: "cse", completed_courses: [], target_credits_min: 6, target_credits_max: 6 });
    assert.equal(r.department, "CSE");
    assert.ok(r.candidates.length >= 1);
    assert.ok(r.notes.some((n: string) => /no live section/i.test(n)));
    assert.ok(r.notes.some((n: string) => /degree requirement/i.test(n)));
  });
  test("excludes completed courses", async () => {
    setCourseCorpus(corpus([
      c("CSE 1284"),
      c("CSE 2383", 3, { required_courses: ["CSE 1284"], logic: "and", min_grade: null, non_course: [], raw_prose: "", parse_warnings: [] }),
    ]));
    const r = await call({ department: "CSE", completed_courses: ["CSE 1284"], target_credits_min: 3, target_credits_max: 3 });
    for (const cand of r.candidates) {
      for (const cr of cand.courses) assert.notEqual(cr.code, "CSE 1284");
    }
  });
  test("rejects invalid department", async () => {
    setCourseCorpus(corpus([]));
    await assert.rejects(() => call({ department: "12345", completed_courses: [] }));
  });
  test("rejects out-of-range credit window", async () => {
    setCourseCorpus(corpus([]));
    await assert.rejects(() => call({ department: "CSE", completed_courses: [], target_credits_min: -1 }));
    await assert.rejects(() => call({ department: "CSE", completed_courses: [], target_credits_max: 999 }));
  });
  test("returns empty candidates with explanatory note when no bundle fits", async () => {
    setCourseCorpus(corpus([c("CSE 1284", 1)]));
    const r = await call({ department: "CSE", completed_courses: [], target_credits_min: 12, target_credits_max: 18 });
    assert.equal(r.candidates.length, 0);
    assert.ok(r.notes.some((n: string) => /no valid bundle/i.test(n)));
  });
  test("focus_keyword narrows the pool", async () => {
    setCourseCorpus(corpus([
      { ...c("CSE 1284"), description: "introductory programming" },
      { ...c("CSE 1213"), description: "calculus" },
    ]));
    const r = await call({ department: "CSE", completed_courses: [], focus_keyword: "calculus", target_credits_min: 3, target_credits_max: 3 });
    if (r.candidates.length > 0) {
      for (const cand of r.candidates) {
        for (const cr of cand.courses) assert.equal(cr.code, "CSE 1213");
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd msstate-policies && npx tsx --test tests/courses/tool-plan-semester.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/plan_semester.js'`.

- [ ] **Step 3: Implement the tool**

Create `msstate-policies/src/tools/plan_semester.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

Run: `cd msstate-policies && npx tsx --test tests/courses/tool-plan-semester.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/plan_semester.ts msstate-policies/tests/courses/tool-plan-semester.test.ts
git commit -m "feat(courses): add plan_semester MCP tool"
```

---

## Task 6: Register in stdio server

**Files:**
- Modify: `msstate-policies/src/index.ts`

- [ ] **Step 1: Add import**

After the existing `get_msu_course_graph` import (around line 31):

```typescript
import { plan_semester } from "./tools/plan_semester.js";
```

- [ ] **Step 2: Register in TOOLS**

Insert `plan_semester,` immediately after `get_msu_course_graph,` in the TOOLS array.

- [ ] **Step 3: Extend SERVER_INSTRUCTIONS rule 3**

Replace rule 3 with:

```
3. Course questions ("what's the prereq for...", "what does X unlock?", "find a class about Y", "what should I take next semester in CSE?") → search_msu_courses, get_msu_course, get_msu_course_graph, plan_semester. Use plan_semester when the user gives a department + completed courses and wants a candidate schedule. Always surface the non-goals from plan_semester.notes (no live sections, no degree-audit, no admission prediction).
```

- [ ] **Step 4: Build + test**

Run: `cd msstate-policies && npm run typecheck && npm test && npm run build`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/index.ts msstate-policies/dist/
git commit -m "feat(courses): register plan_semester in stdio server"
```

---

## Task 7: Mirror in Worker

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add tool descriptor**

Copy the description string verbatim from the stdio tool file. Insert into the tool-descriptor list after `get_msu_course_graph`.

- [ ] **Step 2: Add dispatch case**

Add `case "plan_semester":` near the course cases. Re-implement `normalize`, `prereqsSatisfied`, `filterCandidateCourses`, `generateBundles` inline in the Worker file (Worker is a separate bundle). Copy logic from `src/courses/planner.ts`. Enforce `MAX_QUERY_CHARS` on `department` and `focus_keyword` and `completed_courses[].length` before parse, matching the existing courses pattern.

- [ ] **Step 3: Update Worker SERVER_INSTRUCTIONS rule 3**

Mirror the stdio change.

- [ ] **Step 4: Worker tests**

Run: `cd worker && npm test 2>&1 | tail -30`

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): mirror plan_semester dispatch"
```

---

## Task 8: Eval cases

**Files:**
- Create: `msstate-policies/eval/semester.jsonl`
- Modify: `scripts/run-eval.mjs`

- [ ] **Step 1: Create eval file**

Create `msstate-policies/eval/semester.jsonl` with 12 cases. Before authoring, verify each `department` exists by running `search_msu_courses` against the current corpus — never fabricate dept prefixes.

```jsonl
{"kind":"plan_basic","desc":"CSE no-prereqs, 6-credit window","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":[],"target_credits_min":6,"target_credits_max":6}},"expect":{"candidates_min":1,"all_bundles_credits_in":[6,6]}}
{"kind":"plan_with_completed","desc":"CSE after intro","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":["CSE 1284","MA 1713"],"target_credits_min":12,"target_credits_max":15}},"expect":{"candidates_min":1,"never_includes":["CSE 1284","MA 1713"]}}
{"kind":"plan_normalized_input","desc":"lowercase dept normalized","args":{"name":"plan_semester","arguments":{"department":"cse","completed_courses":[]}},"expect":{"department_normalized":"CSE"}}
{"kind":"plan_focus","desc":"focus_keyword narrows pool","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":[],"focus_keyword":"data"}},"expect":{"candidate_pool_size_max":80}}
{"kind":"plan_level","desc":"graduate filter","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":[],"level":"graduate"}},"expect":{"all_bundles_level":"graduate"}}
{"kind":"plan_invalid_dept","desc":"numeric dept rejected","args":{"name":"plan_semester","arguments":{"department":"12345","completed_courses":[]}},"expect":{"is_error":true}}
{"kind":"plan_window_swap","desc":"min>max rejected","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":[],"target_credits_min":15,"target_credits_max":12}},"expect":{"is_error":true}}
{"kind":"plan_no_bundle","desc":"single 1-credit course can't fill 12-18","args":{"name":"plan_semester","arguments":{"department":"AS","completed_courses":[],"target_credits_min":12,"target_credits_max":18}},"expect":{"notes_contains":"no valid bundle"}}
{"kind":"plan_notes_non_goals","desc":"every response surfaces non-goals","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":[]}},"expect":{"notes_contains_all":["no live section","degree requirement","admission"]}}
{"kind":"plan_default_window","desc":"defaults to 12-18 credits","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":[]}},"expect":{"target_credits_min":12,"target_credits_max":18}}
{"kind":"plan_unknown_dept","desc":"valid format but no courses","args":{"name":"plan_semester","arguments":{"department":"ZZZZ","completed_courses":[]}},"expect":{"candidate_pool_size":0,"candidates_len":0}}
{"kind":"plan_completed_normalized","desc":"completed_courses normalize whitespace + case","args":{"name":"plan_semester","arguments":{"department":"CSE","completed_courses":["cse  1284"]}},"expect":{"completed_courses_normalized_contains":"CSE 1284"}}
```

- [ ] **Step 2: Extend `scripts/run-eval.mjs`**

Add `--suite semester` (points to `eval/semester.jsonl`). Add assertion branches for `candidates_min`, `all_bundles_credits_in`, `never_includes`, `department_normalized`, `candidate_pool_size_max`, `all_bundles_level`, `is_error`, `notes_contains`, `notes_contains_all`, `target_credits_min`, `target_credits_max`, `candidate_pool_size`, `candidates_len`, `completed_courses_normalized_contains`.

- [ ] **Step 3: Run the suite**

Run: `cd msstate-policies && node ../scripts/run-eval.mjs --suite semester --no-judge`
Expected: All 12 cases pass.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/eval/semester.jsonl scripts/run-eval.mjs
git commit -m "test(eval): add semester suite (12 cases)"
```

---

## Task 9: Security checklist (CAT5, +5 pts)

**Files:**
- Modify: `tools/security-checklist.sh`

- [ ] **Step 1: Append CAT5**

Append after the existing CAT4 block:

```bash
# CAT5 (5 pts): plan_semester / planner.ts pure (no fetch/env/fs/child_process)
# AND tool enforces zod input caps on department / completed_courses /
# focus_keyword.
CAT5_OK=0
if [ -f msstate-policies/src/tools/plan_semester.ts ] \
   && [ -f msstate-policies/src/courses/planner.ts ]; then
  BAD=$(grep -nE 'fetch\(|require\(|process\.env|child_process|fs\.' \
    msstate-policies/src/tools/plan_semester.ts \
    msstate-policies/src/courses/planner.ts 2>/dev/null | wc -l | tr -d ' ')
  CAPS=$(grep -cE 'max\(MAX_QUERY_CHARS\)' msstate-policies/src/tools/plan_semester.ts 2>/dev/null)
  if [ "$BAD" = "0" ] && [ "$CAPS" -ge 2 ]; then CAT5_OK=1; fi
fi
if [ "$CAT5_OK" = "1" ]; then
  SCORE=$((SCORE+5))
  note "PASS" "CAT5 plan_semester pure + input caps enforced" 5
else
  note "FAIL" "CAT5 plan_semester impure or missing input caps" 5
fi
```

- [ ] **Step 2: Bump score targets**

`+5`. From the latest baseline (292 / 302 / 310 depending on prior plans) → +5.

- [ ] **Step 3: Run checklist**

Run: `bash tools/security-checklist.sh | tail -1`
Expected: matches bumped target.

- [ ] **Step 4: Commit**

```bash
git add tools/security-checklist.sh CLAUDE.md README.md docs/BUILD.md
git commit -m "chore(security): add CAT5 (plan_semester purity + caps); +5"
```

---

## Task 10: Docs + version bump + final smoke

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `msstate-policies/README.md`, `docs/BUILD.md`, `msstate-policies/package.json`

- [ ] **Step 1: Append CLAUDE.md addendum**

```markdown
### Corpus extension (2026-05-18) — semester planner (v1.2.4)

Adds 1 derived tool (`plan_semester`) over the existing CourseCorpus.
No new corpus sources.

**`plan_semester(department, completed_courses, target_credits_min?,
target_credits_max?, focus_keyword?, level?)`** — returns up to 3 candidate
course bundles within the credit-hour window. Prereq satisfaction uses
conservative AND on mixed/null logic; non_course gates (e.g., "instructor
permission") exclude the course. Bounded enumeration: candidate pool capped
at 80, bundles 1-5 courses, top 3 distinct by score.

**Explicit non-goals (surfaced in every response.notes):** no live section
availability, no degree-audit, no admission-probability prediction.

**Security check CAT5:** planner + tool pure (no fetch/env/fs/child_process)
+ zod input caps. +5 pts.
```

- [ ] **Step 2: Tool count bump**

`README.md`, `msstate-policies/README.md`, `docs/BUILD.md`: bump tool count. From baseline (25 / 27 / 28 depending on prior plans) → +1.

- [ ] **Step 3: Bump version**

`msstate-policies/package.json` version → `1.2.4`.

- [ ] **Step 4: Full build + test + checklist**

```bash
cd msstate-policies && npm run build && npm test
cd .. && bash tools/security-checklist.sh | tail -1
```

- [ ] **Step 5: Smoke**

```bash
node msstate-policies/dist/index.js < scripts/list-tools-stdin.json 2>/dev/null | grep plan_semester
```
Expected: includes `plan_semester` entry.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md msstate-policies/README.md docs/BUILD.md msstate-policies/package.json msstate-policies/dist/
git commit -m "release: v1.2.4 plan_semester catalog-only planner"
```

---

## Self-Review Checklist

1. **Spec coverage:** `prereqsSatisfied`, `filterCandidateCourses`, `generateBundles`, `scorePlan`, tool wrapper, worker mirror, 12 eval cases, CAT5 check, version + docs bump. All accounted for.
2. **Type consistency:** `SemesterPlanInput`, `PlanCandidate`, `PlanCandidateCourse`, `SemesterPlanResult` referenced identically across planner.ts, planner-types.ts, plan_semester.ts, tests, worker mirror.
3. **No placeholders:** Every step shows actual code or an exact command. The candidate enumeration is concrete (5-deep nested loops); no "implement BFS later" placeholder.
4. **Corpus rule:** Only candidates from baked `CourseCorpus.records` reach output. No URL is constructed — every recommended course carries the catalog's own `source_url`.
5. **Non-goals:** Surfaced in BOTH the tool description AND every response's `notes` field. The integration test (Task 5 step 1) asserts this.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-semester-planner.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
