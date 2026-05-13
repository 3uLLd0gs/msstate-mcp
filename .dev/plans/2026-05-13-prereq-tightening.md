# Prereq Tightening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three measured accuracy gaps in the prereq parser (63 non_course-dropped + 28 min_grade-missed + 130 zero-codes), add `parse_warnings` per row, surface aggregate counts in `health_check`, add `prereq_summary` to `get_msu_course`. Ships as v0.9.0.

**Architecture:** Extend `msstate-policies/src/courses/parser.ts` and `types.ts`; add a `prereq_summary` builder; wire the new fields through the scrape pipeline + Worker + tools. No new MCP tool. Build pipeline aborts on per-category ceiling regressions. Worker mirrors the new response fields inline.

**Tech Stack:** TypeScript / Node 18+ / esbuild / cheerio / zod / `@modelcontextprotocol/sdk` / Cloudflare Workers / `node:test` runner.

**Spec:** `.dev/specs/2026-05-13-prereq-tightening-design.md` (read before starting).

**Read-before-touching invariants** (from `CLAUDE.md`):
1. **Corpus rule** — every value comes from `*.msstate.edu`. The parser operates on raw_prose strings extracted from `catalog.msstate.edu`; no training-data heuristics for prereq inference.
2. **stderr-only logging** on stdio surface.
3. **Security score 257 (Linux CI) must not regress.**
4. **Field name stability** — `types.ts` field names are tool-output schemas and the baked corpus references them. Renaming is breaking; ADDING a field is non-breaking.

---

## Stage 0 — Preflight

### Task 0.1: Cut feature branch + verify state

**Files:** none (git only).

- [ ] **Step 1: Branch from main and verify clean state**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
git checkout main
git pull origin main
git log -1 --oneline
git checkout -b feat/prereq-tightening
cd msstate-policies && npm test 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: latest commit is `42cb342 docs(courses): brainstorming design for v0.9.0 prereq tightening` (or newer). Tests show 288/288 pass. Branch `feat/prereq-tightening` checked out from main.

- [ ] **Step 2: Capture baseline corpus stats**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
jq '[.courses.records | to_entries[] | select(.value.prereqs.raw_prose != null and .value.prereqs.raw_prose != "") | {has_codes: ((.value.prereqs.required_courses | length) > 0), has_non_course: ((.value.prereqs.non_course | length) > 0), has_grade: (.value.prereqs.min_grade != null)}] | {total: length, has_codes: ([.[] | select(.has_codes)] | length), has_non_course: ([.[] | select(.has_non_course)] | length), has_grade: ([.[] | select(.has_grade)] | length), zero_codes_zero_non_course: ([.[] | select((.has_codes | not) and (.has_non_course | not))] | length)}' worker/corpus.json
```

Expected output approximately:
```
{ "total": 678, "has_codes": 548, "has_non_course": 152, "has_grade": 87, "zero_codes_zero_non_course": 63 }
```

These are the baseline numbers the regression test (Task 9.1) will compare against to assert improvement.

---

## Stage 1 — Type extensions

### Task 1.1: Extend `Prereq` and `Course` interfaces

**Files:**
- Modify: `msstate-policies/src/courses/types.ts:34-69`

- [ ] **Step 1: Write failing test**

**Create file:** `msstate-policies/tests/courses/types.test.ts` (if it doesn't already exist; append a describe block if it does):

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Prereq, Course, PrereqWarning } from "../../src/courses/types.js";

describe("courses/types — v0.9.0 extensions", () => {
  test("Prereq accepts parse_warnings array", () => {
    const p: Prereq = {
      required_courses: ["CSE 1384"],
      logic: "and",
      min_grade: "C",
      non_course: [],
      raw_prose: "(Prerequisites: C or better in CSE 1384)",
      parse_warnings: [],
    };
    assert.deepEqual(p.parse_warnings, []);
  });
  test("PrereqWarning is a string literal union of 4 values", () => {
    const all: PrereqWarning[] = [
      "non_course_unparsed",
      "grade_signal_present_but_unparsed",
      "grade_signal_ambiguous",
      "logic_ambiguous",
    ];
    assert.equal(all.length, 4);
  });
  test("Course accepts prereq_summary field", () => {
    const c: Course = {
      code: "CSE 4733",
      title: "Operating Systems I",
      hours: 3,
      level: "undergraduate",
      description: "",
      semester_offered: null,
      prereqs: null,
      coreqs: null,
      cross_listed: [],
      source_url: "https://catalog.msstate.edu/search/?P=CSE%204733",
      prereq_summary: "CSE 3183 (C or better), and (CSE 3724 or ECE 3714)",
    };
    assert.equal(typeof c.prereq_summary, "string");
  });
  test("prereq_summary may be null", () => {
    const c: Course = {
      code: "ART 1001",
      title: "Intro to Art",
      hours: 3,
      level: "undergraduate",
      description: "",
      semester_offered: null,
      prereqs: null,
      coreqs: null,
      cross_listed: [],
      source_url: "https://catalog.msstate.edu/search/?P=ART%201001",
      prereq_summary: null,
    };
    assert.equal(c.prereq_summary, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/courses/types.test.ts 2>&1 | tail -5
```

Expected: FAIL — `PrereqWarning` and `parse_warnings` and `prereq_summary` not exported.

- [ ] **Step 3: Edit `types.ts` — add `PrereqWarning` and extend `Prereq` + `Course`**

In `msstate-policies/src/courses/types.ts`, after the `MAX_GRAPH_DEPTH`/`COURSE_CODE_RE` block and before `interface Prereq`, add:

```typescript
/** Per-row diagnostic signals emitted by the prereq parser. Empty array
 *  means "parser thinks it got everything cleanly." Non-empty means the
 *  client (or model) should fall back to `raw_prose` for fields whose
 *  warning indicates incomplete parsing. */
export type PrereqWarning =
  | "non_course_unparsed"
  | "grade_signal_present_but_unparsed"
  | "grade_signal_ambiguous"
  | "logic_ambiguous";
```

Then extend the `Prereq` interface by appending one field:

```typescript
export interface Prereq {
  required_courses: string[];
  logic: "or" | "and" | "mixed" | null;
  min_grade: "A" | "B" | "C" | "D" | null;
  non_course: string[];
  raw_prose: string;
  /** v0.9.0 — diagnostic signals; empty array when fully parsed. */
  parse_warnings: PrereqWarning[];
}
```

Then extend the `Course` interface by appending one field after `source_url`:

```typescript
export interface Course {
  code: string;
  title: string;
  hours: number | string;
  level: "undergraduate" | "graduate";
  description: string;
  semester_offered: string | null;
  prereqs: Prereq | null;
  coreqs: Prereq | null;
  cross_listed: string[];
  source_url: string;
  /** v0.9.0 — human-readable one-line prereq summary built at corpus
   *  build time from the prereq fields. Null when raw_prose is null.
   *  Sentinel string when parse_warnings is non-empty. */
  prereq_summary: string | null;
}
```

- [ ] **Step 4: Run test + typecheck**

```bash
cd msstate-policies && npx tsx --test tests/courses/types.test.ts 2>&1 | tail -5
npm run typecheck 2>&1 | tail -3
```

Expected: 4 tests PASS. typecheck PASSES.

Note: existing tests may break because they construct `Prereq` or `Course` objects without the new fields. We fix them in subsequent tasks (`parse_warnings: []` and `prereq_summary: null` get defaulted by the parser, but bare-fixture tests need updating). For now, accept temporary regression — Task 1.2 fixes it.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/courses/types.ts msstate-policies/tests/courses/types.test.ts
git status --short
git commit -m "feat(courses): add PrereqWarning + parse_warnings + prereq_summary types"
```

### Task 1.2: Update existing parser to emit `parse_warnings: []` (preserve compatibility)

**Files:**
- Modify: `msstate-policies/src/courses/parser.ts:75-99`

- [ ] **Step 1: Edit `parseClause` to always emit `parse_warnings: []`**

In `parser.ts`, find the `parseClause` function (~line 75-99). Both `return` paths (the empty-but-prose path and the normal path) need a `parse_warnings: []` field on the returned object. Replace the function with:

```typescript
function parseClause(label: "Prerequisites" | "Corequisites", input: string): Prereq | null {
  if (!input) return null;
  const clause = extractParenthesized(label, input);
  if (!clause) return null;
  const required_courses = uniqueCourseCodes(clause);
  const non_course = extractNonCourse(clause);
  if (required_courses.length === 0 && non_course.length === 0) {
    // Empty (no recognizable content); still report raw_prose so caller knows
    // there WAS a prereq clause we couldn't decompose.
    return {
      required_courses: [],
      logic: null,
      min_grade: null,
      non_course: [],
      raw_prose: clause,
      parse_warnings: [],  // Task 4.x will populate this when warranted
    };
  }
  return {
    required_courses,
    logic: inferLogic(clause),
    min_grade: inferMinGrade(clause),
    non_course,
    raw_prose: clause,
    parse_warnings: [],  // Task 4.x will populate this when warranted
  };
}
```

- [ ] **Step 2: Run the full suite to confirm no test breakage**

```bash
cd msstate-policies && npm test 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: 292/292 pass (288 existing + 4 new from Task 1.1). If any existing test fails because it asserts a specific `Prereq` object shape WITHOUT `parse_warnings`, update that test to include `parse_warnings: []`.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/courses/parser.ts
# Plus any test files you updated to include parse_warnings: [].
git status --short
git commit -m "feat(courses): emit parse_warnings: [] from parseClause (compat shim)"
```

---

## Stage 2 — Broaden `extractNonCourse` (closes the 63-dropped gap)

### Task 2.1: Write failing tests for 4 new non_course categories

**Files:**
- Modify: `msstate-policies/tests/courses/parser.test.ts` (file may exist; check first)

- [ ] **Step 1: Check whether `parser.test.ts` exists**

```bash
ls msstate-policies/tests/courses/parser.test.ts 2>&1
```

If absent, create it with the boilerplate:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePrereqProse } from "../../src/courses/parser.js";
```

- [ ] **Step 2: Append the failing test block**

In `msstate-policies/tests/courses/parser.test.ts`, append:

```typescript
describe("extractNonCourse — Section 1 (admission status)", () => {
  test("extracts 'Admission to Teacher Education'", () => {
    const p = parsePrereqProse("(Prerequisites: Admission to Teacher Education)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /Admission to Teacher Education/i.test(s)));
  });
  test("extracts mixed admission + standing", () => {
    const p = parsePrereqProse("(Prerequisites: Admission to Teacher Education and senior standing)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /Admission to Teacher Education/i.test(s)));
    assert.ok(p.non_course.some((s) => /senior standing/i.test(s)));
  });
});

describe("extractNonCourse — Section 1 (hours-of-X)", () => {
  test("extracts 'Seven hours of biological science'", () => {
    const p = parsePrereqProse("(Prerequisites: Seven hours of biological science)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /Seven hours of biological science/i.test(s)));
  });
  test("extracts hours phrasing with 'and'-joined clauses", () => {
    const p = parsePrereqProse("(Prerequisites: Ten hours of biological science and organic chemistry)");
    assert.ok(p);
    assert.ok(p.non_course.length >= 1);
  });
});

describe("extractNonCourse — Section 1 (completion of X)", () => {
  test("extracts 'Completion of any 1000-level history course'", () => {
    const p = parsePrereqProse("(Prerequisites: Completion of any 1000-level history course)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /Completion of any 1000-level history course/i.test(s)));
  });
  test("extracts MPH core completion phrasing", () => {
    const p = parsePrereqProse("(Prerequisites: Completion of all core Master of Public Health courses AND permission of primary advisor)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /Completion of all core Master of Public Health courses/i.test(s)));
    assert.ok(p.non_course.some((s) => /permission of primary advisor/i.test(s)));
  });
});

describe("extractNonCourse — Section 1 (proficiency)", () => {
  test("extracts 'Proficiency with spreadsheet software'", () => {
    const p = parsePrereqProse("(Prerequisites: Proficiency with spreadsheet software)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /Proficiency with spreadsheet software/i.test(s)));
  });
});

describe("extractNonCourse — Section 1 (broader permission phrasing)", () => {
  test("extracts 'permission of practicum director'", () => {
    const p = parsePrereqProse("(Prerequisites: Master of Public Health core courses and permission of practicum director)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /permission of practicum director/i.test(s)));
  });
  test("extracts 'consent of the practicum director' (with definite article)", () => {
    const p = parsePrereqProse("(Prerequisites: consent of the practicum director)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /consent of (the )?practicum director/i.test(s)));
  });
});

describe("extractNonCourse — preserves existing patterns (regression guard)", () => {
  test("still extracts 'consent of instructor'", () => {
    const p = parsePrereqProse("(Prerequisites: consent of instructor)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /consent of instructor/i.test(s)));
  });
  test("still extracts 'senior standing'", () => {
    const p = parsePrereqProse("(Prerequisites: senior standing)");
    assert.ok(p);
    assert.ok(p.non_course.some((s) => /senior standing/i.test(s)));
  });
});
```

- [ ] **Step 3: Run tests to verify the new ones fail**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | tail -10
```

Expected: existing tests in the file still pass; the new tests in the 5 new describe blocks FAIL because the current `extractNonCourse` only matches consent/permission/standing/ACT/SAT (the existing patterns). Roughly 8-10 new failures.

### Task 2.2: Expand `extractNonCourse` to cover the 4 new categories

**Files:**
- Modify: `msstate-policies/src/courses/parser.ts:16-22, 47-58`

- [ ] **Step 1: Expand the `NON_COURSE_PATTERNS` array**

In `parser.ts`, replace the existing `NON_COURSE_PATTERNS` constant (~line 16-22) with:

```typescript
const NON_COURSE_PATTERNS: Array<{ rx: RegExp; label: (m: RegExpExecArray) => string }> = [
  // EXISTING — keep verbatim (regression-guarded by Task 2.1's "preserves existing patterns" block).
  { rx: /\bconsent of (?:the )?instructor\b/gi, label: () => "consent of instructor" },
  { rx: /\b(junior|senior|graduate|sophomore|freshman) standing\b/gi, label: (m) => `${m[1].toLowerCase()} standing` },
  { rx: /\bACT\s+\d+\b/gi, label: (m) => m[0] },
  { rx: /\bSAT\s+\d+\b/gi, label: (m) => m[0] },

  // NEW (v0.9.0) — broader permission/consent. Captures any "permission/consent of <role>"
  // including "permission of practicum director", "consent of the primary advisor", etc.
  // The role is anything word-y, stopping at AND/OR/;/. so we don't gobble downstream clauses.
  {
    rx: /\b(permission|consent)\s+of\s+(?:the\s+)?([\w\s]+?)(?=\s+and\b|\s+or\b|[;.,)]|$)/gi,
    label: (m) => `${m[1].toLowerCase()} of ${m[2].trim().toLowerCase()}`,
  },

  // NEW — admission status. "Admission to Teacher Education", "Admission to the Graduate School", etc.
  // Stops at AND/OR/punctuation. Title-case the program but normalize "Admission to".
  {
    rx: /\bAdmission\s+to\s+(?:the\s+)?([A-Z][\w\s]+?)(?=\s+and\b|\s+or\b|[;.,)]|$)/g,
    label: (m) => `Admission to ${m[1].trim()}`,
  },

  // NEW — hours-of-X. "Seven hours of biological science", "Thirty hours of BIO graduate work", etc.
  // The hour count can be written ("Seven", "Thirty") or numeric ("7", "30").
  {
    rx: /\b((?:[A-Z][a-z]+(?:-[a-z]+)?|\d+))\s+hours?\s+of\s+([^,.()]+?)(?=\s+and\b|\s+or\b|[;.,)]|$)/gi,
    label: (m) => `${m[1]} hours of ${m[2].trim()}`,
  },

  // NEW — completion of X. "Completion of any 1000-level history course",
  // "Completion of all core Master of Public Health courses", etc.
  {
    rx: /\bCompletion\s+of\s+([^,.()]+?)(?=\s+and\b|\s+or\b|[;.,)]|$)/gi,
    label: (m) => `Completion of ${m[1].trim()}`,
  },

  // NEW — proficiency / skill. "Proficiency with spreadsheet software",
  // "Proficiency in MATLAB", etc.
  {
    rx: /\bProficiency\s+(?:with|in)\s+([^,.()]+?)(?=\s+and\b|\s+or\b|[;.,)]|$)/gi,
    label: (m) => `Proficiency with ${m[1].trim()}`,
  },
];
```

- [ ] **Step 2: Run tests**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | tail -10
```

Expected: all describe blocks pass. If a test fails because the extracted label has different casing or trailing whitespace than expected, fix the `label:` callback to match the test expectation EXACTLY (don't loosen the test).

- [ ] **Step 3: Run the full course test suite (no regression in scraper / search / corpus tests)**

```bash
cd msstate-policies && npx tsx --test "tests/courses/*.test.ts" 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all course tests pass.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/courses/parser.ts msstate-policies/tests/courses/parser.test.ts
git status --short
git commit -m "feat(courses): broaden extractNonCourse for 4 new categories"
```

---

## Stage 3 — Tighten `inferMinGrade` (closes the 28-missed gap)

### Task 3.1: Write failing tests for new grade phrasings

**Files:**
- Modify: `msstate-policies/tests/courses/parser.test.ts` (append)

- [ ] **Step 1: Append the new describe block**

```typescript
describe("inferMinGrade — Section 2", () => {
  test("'C or better in CSE 3183' (existing format) → 'C'", () => {
    const p = parsePrereqProse("(Prerequisites: C or better in CSE 3183)");
    assert.equal(p?.min_grade, "C");
  });
  test("'a C or better' → 'C'", () => {
    const p = parsePrereqProse("(Prerequisites: a C or better in CSE 3183)");
    assert.equal(p?.min_grade, "C");
  });
  test("'grade of C or better' → 'C'", () => {
    const p = parsePrereqProse("(Prerequisites: grade of C or better in CSE 3183)");
    assert.equal(p?.min_grade, "C");
  });
  test("'minimum grade of C' → 'C'", () => {
    const p = parsePrereqProse("(Prerequisites: minimum grade of C in CSE 3183)");
    assert.equal(p?.min_grade, "C");
  });
  test("'earning a C' → 'C'", () => {
    const p = parsePrereqProse("(Prerequisites: CSE 3183 with earning a C)");
    assert.equal(p?.min_grade, "C");
  });
  test("'with a C or better' → 'C'", () => {
    const p = parsePrereqProse("(Prerequisites: CSE 3183 with a C or better)");
    assert.equal(p?.min_grade, "C");
  });
  test("'minimum B grade' → 'B'", () => {
    const p = parsePrereqProse("(Prerequisites: minimum B grade in CSE 3183)");
    assert.equal(p?.min_grade, "B");
  });

  // False-positive guards
  test("'in CSE 3183 and ECE 3714' (no grade phrase) → null", () => {
    const p = parsePrereqProse("(Prerequisites: in CSE 3183 and ECE 3714)");
    assert.equal(p?.min_grade, null);
  });
  test("'A score of 70%' (A in a different sense) → null", () => {
    const p = parsePrereqProse("(Prerequisites: A score of 70% on the placement exam)");
    assert.equal(p?.min_grade, null);
  });
  test("'with a B' (no 'or better', genuinely ambiguous) → null", () => {
    const p = parsePrereqProse("(Prerequisites: CSE 3183 with a B)");
    assert.equal(p?.min_grade, null);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | grep -E "FAIL|inferMinGrade" | head
```

Expected: 6-8 failures in the new block (current `inferMinGrade` only matches "Grade of X" with capital G + word "Grade", so most new phrasings don't match).

### Task 3.2: Rewrite `inferMinGrade` with prioritized pattern list

**Files:**
- Modify: `msstate-policies/src/courses/parser.ts:42-45`

- [ ] **Step 1: Replace `inferMinGrade`**

In `parser.ts`, replace the single-regex `inferMinGrade` with:

```typescript
/** Prioritized list of grade-phrasing patterns. First match wins.
 *  The captured letter is restricted to [A-D] to avoid false positives on
 *  standalone letters (e.g., "E" in "ECE 3714"). The third pattern's
 *  leading `[^A-Z]` guards against grabbing the first letter of a course prefix. */
const GRADE_PATTERNS: readonly RegExp[] = [
  /minimum\s+grade\s+of\s+(?:an?\s+)?([A-D])\b/i,
  /grade\s+of\s+(?:an?\s+)?([A-D])\s+or\s+better/i,
  /(?:^|[^A-Z])(?:an?\s+)?([A-D])\s+or\s+better/,
  /minimum\s+(?:an?\s+)?([A-D])\s+grade/i,
  /earning\s+(?:an?\s+)?([A-D])\b/i,
  /with\s+(?:an?\s+)?([A-D])\s+or\s+better/i,
];

function inferMinGrade(clause: string): Prereq["min_grade"] {
  for (const rx of GRADE_PATTERNS) {
    const m = rx.exec(clause);
    if (m) return m[1].toUpperCase() as Prereq["min_grade"];
  }
  return null;
}
```

- [ ] **Step 2: Run grade tests**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | grep -E "inferMinGrade|^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all 10 grade tests pass. If false-positive guards fail (e.g., "A score of 70%" returns "A"), inspect which pattern matched and tighten — likely the third pattern. Adding `[^A-Z]` lookbehind isn't supported uniformly, so the leading char-class is intentional. Don't loosen the test.

- [ ] **Step 3: Run all course tests**

```bash
cd msstate-policies && npx tsx --test "tests/courses/*.test.ts" 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all course tests pass, including pre-existing CSE 4733-style fixtures that already used "C or better".

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/courses/parser.ts msstate-policies/tests/courses/parser.test.ts
git commit -m "feat(courses): prioritized GRADE_PATTERNS list (closes 28-grade-miss gap)"
```

---

## Stage 4 — Emit `parse_warnings`

### Task 4.1: Write failing tests for the 4 warning categories

**Files:**
- Modify: `msstate-policies/tests/courses/parser.test.ts` (append)

- [ ] **Step 1: Append warning tests**

```typescript
describe("parse_warnings — Section 3a", () => {
  test("non_course_unparsed when raw_prose has content but extractors found nothing", () => {
    // A prereq we don't recognize — none of the 9 categories match it.
    const p = parsePrereqProse("(Prerequisites: completion of an internship at a Fortune 500 company)");
    assert.ok(p);
    // After Task 2.x, "Completion of X" matches. Pick a phrase NO pattern catches:
    const q = parsePrereqProse("(Prerequisites: a vibe check from the department chair)");
    assert.ok(q);
    assert.ok(q.parse_warnings.includes("non_course_unparsed"),
      `expected non_course_unparsed in ${JSON.stringify(q.parse_warnings)}`);
  });
  test("no warning when fully parsed (clean course-codes case)", () => {
    const p = parsePrereqProse("(Prerequisites: CSE 1384)");
    assert.ok(p);
    assert.deepEqual(p.parse_warnings, []);
  });
  test("no warning when non_course extraction succeeded", () => {
    const p = parsePrereqProse("(Prerequisites: senior standing)");
    assert.ok(p);
    assert.deepEqual(p.parse_warnings, []);
  });
  test("grade_signal_present_but_unparsed when prose mentions 'grade' but inferMinGrade returns null", () => {
    // "grade" word present but no recognized pattern.
    const p = parsePrereqProse("(Prerequisites: CSE 1384 with a B grade)");
    assert.ok(p);
    // "with a B" with no "or better" doesn't match — but "grade" is present.
    assert.ok(p.parse_warnings.includes("grade_signal_present_but_unparsed"),
      `expected grade_signal_present_but_unparsed in ${JSON.stringify(p.parse_warnings)}`);
  });
  test("no grade warning when 'grade' word absent", () => {
    const p = parsePrereqProse("(Prerequisites: CSE 1384)");
    assert.ok(p);
    assert.ok(!p.parse_warnings.includes("grade_signal_present_but_unparsed"));
  });
  test("logic_ambiguous emitted when 'mixed' AND/OR composition detected", () => {
    const p = parsePrereqProse("(Prerequisites: CSE 1284 and (MA 1713 or MA 1723))");
    assert.ok(p);
    assert.equal(p.logic, "mixed");
    assert.ok(p.parse_warnings.includes("logic_ambiguous"));
  });
  test("'none' / 'n/a' in raw_prose emits no warning (treated as null-equivalent)", () => {
    // The parser won't extract these as a clause (parens label match fails) but
    // a synthetic input demonstrates the guard isn't tripped.
    const p = parsePrereqProse("(Prerequisites: none)");
    assert.ok(p);
    assert.deepEqual(p.parse_warnings, []);  // empty array, NOT non_course_unparsed
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | grep -E "parse_warnings|^ℹ" | head -15
```

Expected: multiple new failures (all assertions about `parse_warnings` content fail because the array is currently always `[]`).

### Task 4.2: Implement warning emission in `parseClause`

**Files:**
- Modify: `msstate-policies/src/courses/parser.ts:75-99`

- [ ] **Step 1: Add a `computeWarnings` helper above `parseClause`**

In `parser.ts`, before `function parseClause`, add:

```typescript
const GRADE_TRIGGER_RE = /\b(grade|better|minimum|earning)\b/i;
const NONE_EQUIVALENT_RE = /^\s*(none|n\/?a|see\s+description)\s*$/i;

function computeWarnings(
  clause: string,
  required_courses: string[],
  non_course: string[],
  logic: Prereq["logic"],
  min_grade: Prereq["min_grade"],
): PrereqWarning[] {
  const warnings: PrereqWarning[] = [];

  // Treat "none"/"n/a"/"see description" as null-equivalent — no warning.
  if (NONE_EQUIVALENT_RE.test(clause.replace(/^\(\s*[A-Za-z]+:\s*/i, "").replace(/\)$/, ""))) {
    return [];
  }

  // non_course_unparsed: raw_prose has content but neither required_courses NOR non_course got anything.
  if (required_courses.length === 0 && non_course.length === 0) {
    warnings.push("non_course_unparsed");
  }

  // grade_signal_present_but_unparsed: grade-trigger word present, but inferMinGrade returned null.
  if (min_grade === null && GRADE_TRIGGER_RE.test(clause)) {
    warnings.push("grade_signal_present_but_unparsed");
  }

  // logic_ambiguous: parser marked it "mixed".
  if (logic === "mixed") {
    warnings.push("logic_ambiguous");
  }

  return warnings;
}
```

- [ ] **Step 2: Update `parseClause` to import the warning type and emit warnings**

In `parser.ts`, find the `import` line for types:

```typescript
import { COURSE_CODE_RE, type Course, type Prereq } from "./types.js";
```

Replace with:

```typescript
import { COURSE_CODE_RE, type Course, type Prereq, type PrereqWarning } from "./types.js";
```

Then update `parseClause` body — both return paths — to call `computeWarnings`:

```typescript
function parseClause(label: "Prerequisites" | "Corequisites", input: string): Prereq | null {
  if (!input) return null;
  const clause = extractParenthesized(label, input);
  if (!clause) return null;
  const required_courses = uniqueCourseCodes(clause);
  const non_course = extractNonCourse(clause);
  const logic = inferLogic(clause);
  const min_grade = inferMinGrade(clause);

  const parse_warnings = computeWarnings(clause, required_courses, non_course, logic, min_grade);

  return {
    required_courses,
    logic,
    min_grade,
    non_course,
    raw_prose: clause,
    parse_warnings,
  };
}
```

(Note: the old empty-but-prose branch is now folded into the normal path — the warnings handle the "we got nothing" signal explicitly. Simpler code.)

- [ ] **Step 3: Run tests**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | grep -E "parse_warnings|^ℹ tests|^ℹ pass|^ℹ fail" | head -10
```

Expected: all 7 new warning tests pass; all earlier parser tests still pass.

- [ ] **Step 4: Run full test suite**

```bash
cd msstate-policies && npm test 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: 300+/300+ pass (288 baseline + new types tests + new parser tests).

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/courses/parser.ts msstate-policies/tests/courses/parser.test.ts
git commit -m "feat(courses): emit parse_warnings for 4 diagnostic categories"
```

---

## Stage 5 — `buildPrereqSummary` builder

### Task 5.1: Write failing tests for the summary builder

**Files:**
- Create: `msstate-policies/tests/courses/prereq-summary.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPrereqSummary } from "../../src/courses/parser.js";
import type { Prereq } from "../../src/courses/types.js";

const WARNING_SENTINEL =
  "(prereqs published but not machine-parsed in full — see raw_prose)";

function prereq(over: Partial<Prereq>): Prereq {
  return {
    required_courses: [],
    logic: null,
    min_grade: null,
    non_course: [],
    raw_prose: "(Prerequisites: …)",
    parse_warnings: [],
    ...over,
  };
}

describe("buildPrereqSummary", () => {
  test("returns null when prereqs is null", () => {
    assert.equal(buildPrereqSummary(null), null);
  });
  test("returns warning sentinel when parse_warnings is non-empty", () => {
    const p = prereq({
      required_courses: ["CSE 1384"],
      parse_warnings: ["non_course_unparsed"],
    });
    assert.equal(buildPrereqSummary(p), WARNING_SENTINEL);
  });
  test("clean: one course-code", () => {
    const p = prereq({
      required_courses: ["CSE 1384"],
      logic: "and",
      raw_prose: "(Prerequisites: CSE 1384)",
    });
    assert.equal(buildPrereqSummary(p), "CSE 1384");
  });
  test("clean: AND-joined courses + min_grade", () => {
    const p = prereq({
      required_courses: ["CSE 1384", "MA 1713"],
      logic: "and",
      min_grade: "C",
      raw_prose: "(Prerequisites: C or better in CSE 1384 and MA 1713)",
    });
    assert.equal(buildPrereqSummary(p), "CSE 1384 and MA 1713 (C or better)");
  });
  test("clean: OR-joined courses", () => {
    const p = prereq({
      required_courses: ["MA 1713", "MA 1723"],
      logic: "or",
      raw_prose: "(Prerequisites: MA 1713 or MA 1723)",
    });
    assert.equal(buildPrereqSummary(p), "MA 1713 or MA 1723");
  });
  test("clean: non_course only", () => {
    const p = prereq({
      non_course: ["senior standing", "permission of instructor"],
      raw_prose: "(Prerequisites: senior standing and permission of instructor)",
    });
    assert.equal(
      buildPrereqSummary(p),
      "senior standing; permission of instructor",
    );
  });
  test("clean: required_courses + min_grade + non_course", () => {
    const p = prereq({
      required_courses: ["CSE 1384"],
      logic: "and",
      min_grade: "C",
      non_course: ["senior standing"],
      raw_prose: "(Prerequisites: C or better in CSE 1384 and senior standing)",
    });
    assert.equal(
      buildPrereqSummary(p),
      "CSE 1384 (C or better); senior standing",
    );
  });
  test("logic null defaults to 'and' when joining", () => {
    const p = prereq({
      required_courses: ["CSE 1384", "MA 1713"],
      logic: null,
      raw_prose: "(Prerequisites: CSE 1384, MA 1713)",
    });
    assert.equal(buildPrereqSummary(p), "CSE 1384 and MA 1713");
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd msstate-policies && npx tsx --test tests/courses/prereq-summary.test.ts
```

Expected: FAIL — `buildPrereqSummary` not exported.

### Task 5.2: Implement `buildPrereqSummary`

**Files:**
- Modify: `msstate-policies/src/courses/parser.ts` (append at end of file, before the last existing export if any)

- [ ] **Step 1: Add the function**

In `parser.ts`, append:

```typescript
const PREREQ_WARNING_SENTINEL =
  "(prereqs published but not machine-parsed in full — see raw_prose)";

/** Build a one-line human-readable prereq summary from the structured fields.
 *
 *  Rules (deterministic, no LLM):
 *   1. null → null
 *   2. any parse_warnings → sentinel string ("fall back to raw_prose")
 *   3. else: join required_courses by AND/OR (logic defaults to "and"),
 *      append "(min_grade or better)" if min_grade set,
 *      append "; <non_course items>" joined by "; ".
 */
export function buildPrereqSummary(p: Prereq | null): string | null {
  if (p === null) return null;
  if (p.parse_warnings.length > 0) return PREREQ_WARNING_SENTINEL;

  const parts: string[] = [];

  if (p.required_courses.length > 0) {
    const joiner = p.logic === "or" ? " or " : " and ";
    let courses = p.required_courses.join(joiner);
    if (p.min_grade) courses = `${courses} (${p.min_grade} or better)`;
    parts.push(courses);
  }

  if (p.non_course.length > 0) {
    parts.push(p.non_course.join("; "));
  }

  return parts.length > 0 ? parts.join("; ") : null;
}
```

- [ ] **Step 2: Run tests**

```bash
cd msstate-policies && npx tsx --test tests/courses/prereq-summary.test.ts 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: 8/8 pass.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/courses/parser.ts msstate-policies/tests/courses/prereq-summary.test.ts
git commit -m "feat(courses): buildPrereqSummary deterministic builder"
```

---

## Stage 6 — Wire `prereq_summary` into the Course record

### Task 6.1: Find where Course records are constructed during scrape

**Files:**
- Read: `msstate-policies/src/courses/parser.ts:143-` (parseCourseHtml)
- Read: `msstate-policies/src/courses/scraper.ts` (to confirm flow)

- [ ] **Step 1: Inspect `parseCourseHtml`**

```bash
grep -n "parseCourseHtml\|return.*prereqs.*coreqs\|return {" msstate-policies/src/courses/parser.ts | head -10
```

Find the function that builds the final `Course` object (constructing all 11 fields). Note its return statement's structure.

- [ ] **Step 2: Update `parseCourseHtml` to compute `prereq_summary`**

In `parser.ts`, locate `parseCourseHtml` (`export function parseCourseHtml(html: string, expectedCode: string): Course | null`). Find its return statement that builds the `Course` object. Add `prereq_summary: buildPrereqSummary(prereqs)` immediately after `source_url`, e.g.:

```typescript
return {
  code: expectedCode,
  title,
  hours,
  level,
  description,
  semester_offered,
  prereqs,
  coreqs,
  cross_listed,
  source_url,
  prereq_summary: buildPrereqSummary(prereqs),
};
```

If the function's `return` statement isn't built that way (e.g., it builds intermediate objects), find the LAST point where a `Course`-shaped object is constructed and add the field there.

- [ ] **Step 3: Run the catalog parser tests**

```bash
cd msstate-policies && npx tsx --test tests/courses/parser.test.ts 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all course tests still pass. If a test fails because it asserts a literal `Course` object shape without `prereq_summary`, update that test to include the field.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/courses/parser.ts
git commit -m "feat(courses): populate prereq_summary on every Course record"
```

---

## Stage 7 — Corpus regression test (audit all 678 raw_prose)

### Task 7.1: Write the corpus-regression audit test

**Files:**
- Create: `msstate-policies/tests/courses/prereq-corpus-regression.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePrereqProse } from "../../src/courses/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(here, "..", "..", "..", "worker", "corpus.json");

interface AuditCounts {
  total_records: number;
  with_prose: number;
  fully_parsed: number;
  with_warnings: number;
  warning_breakdown: {
    non_course_unparsed: number;
    grade_signal_present_but_unparsed: number;
    grade_signal_ambiguous: number;
    logic_ambiguous: number;
  };
}

function auditCorpus(): AuditCounts {
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const records = corpus.courses.records as Record<string, { prereqs: { raw_prose: string | null } | null }>;
  let total = 0, withProse = 0, fullyParsed = 0, withWarnings = 0;
  const breakdown = {
    non_course_unparsed: 0,
    grade_signal_present_but_unparsed: 0,
    grade_signal_ambiguous: 0,
    logic_ambiguous: 0,
  };
  for (const rec of Object.values(records)) {
    total++;
    const rawProse = rec.prereqs?.raw_prose ?? null;
    if (rawProse) {
      withProse++;
      // Reparse with the new parser to get warnings (the baked corpus may be older).
      const reparsed = parsePrereqProse(rawProse);
      if (reparsed && reparsed.parse_warnings.length === 0) fullyParsed++;
      if (reparsed && reparsed.parse_warnings.length > 0) {
        withWarnings++;
        for (const w of reparsed.parse_warnings) {
          breakdown[w]++;
        }
      }
    }
  }
  return { total_records: total, with_prose: withProse, fully_parsed: fullyParsed, with_warnings: withWarnings, warning_breakdown: breakdown };
}

describe("prereq corpus audit — post-fix ceilings", () => {
  test("non_course_unparsed ≤ 30 (was 63 before fixes)", () => {
    const a = auditCorpus();
    assert.ok(
      a.warning_breakdown.non_course_unparsed <= 30,
      `regression: ${a.warning_breakdown.non_course_unparsed} > 30 (baseline pre-fix was 63)`,
    );
  });
  test("grade_signal_present_but_unparsed ≤ 10 (was 28)", () => {
    const a = auditCorpus();
    assert.ok(
      a.warning_breakdown.grade_signal_present_but_unparsed <= 10,
      `regression: ${a.warning_breakdown.grade_signal_present_but_unparsed} > 10 (baseline pre-fix was 28)`,
    );
  });
  test("logic_ambiguous ≤ 50 (informational ceiling)", () => {
    const a = auditCorpus();
    assert.ok(
      a.warning_breakdown.logic_ambiguous <= 50,
      `regression: ${a.warning_breakdown.logic_ambiguous} > 50`,
    );
  });
  test("fully_parsed ≥ 620 (was 595)", () => {
    const a = auditCorpus();
    assert.ok(
      a.fully_parsed >= 620,
      `regression: fully_parsed=${a.fully_parsed} < 620 (baseline pre-fix was 595)`,
    );
  });
});
```

Note: This test READS the existing baked corpus and REPARSES each raw_prose with the new parser. It will pass once the parser changes (Stages 1-4) are merged AND the corpus has been rebuilt (Stage 11) so prose-text matches the parser's expectations.

For the initial run (before Stage 11's live rebuild), the audit reparses old prose strings — the new parser handles them too because raw_prose is invariant input, just the parser logic changed.

- [ ] **Step 2: Run test**

```bash
cd msstate-policies && npx tsx --test tests/courses/prereq-corpus-regression.test.ts 2>&1 | tail -15
```

Expected: all 4 assertions PASS. Print the actual counts so you can confirm the improvement:

```bash
cd msstate-policies && npx tsx -e '
import { readFileSync } from "node:fs";
import { parsePrereqProse } from "./src/courses/parser.ts";
const c = JSON.parse(readFileSync("../worker/corpus.json", "utf8"));
let bd = { non_course_unparsed:0, grade_signal_present_but_unparsed:0, grade_signal_ambiguous:0, logic_ambiguous:0 };
let total=0, withProse=0, fully=0, withW=0;
for (const r of Object.values(c.courses.records)) {
  total++;
  if (r.prereqs?.raw_prose) {
    withProse++;
    const p = parsePrereqProse(r.prereqs.raw_prose);
    if (p && p.parse_warnings.length === 0) fully++;
    if (p && p.parse_warnings.length > 0) { withW++; for (const w of p.parse_warnings) bd[w]++; }
  }
}
console.log(JSON.stringify({total,withProse,fully,withW,breakdown:bd},null,2));'
```

Use this output to update the spec/plan if the actual numbers differ from my pre-implementation estimates.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/tests/courses/prereq-corpus-regression.test.ts
git commit -m "test(courses): corpus-wide prereq parser regression audit"
```

---

## Stage 8 — `get_msu_course` response shape + description tweak

### Task 8.1: Surface `prereq_summary` + `parse_warnings` in the response

**Files:**
- Read: `msstate-policies/src/tools/get_msu_course.ts`
- Modify: same file

- [ ] **Step 1: Inspect current handler shape**

```bash
cat msstate-policies/src/tools/get_msu_course.ts
```

Note how the response object is built. The handler returns `record` from the corpus; the new fields (`prereq_summary` on Course; `parse_warnings` inside `prereqs`) will be present automatically IF the corpus has them. But the tool's description should explicitly tell the model how to use them.

- [ ] **Step 2: Append a sentence to the tool description**

In `get_msu_course.ts`, locate the `description:` string for the tool definition. At the end (before the closing backtick or quote), append one sentence:

> Prefer `prereq_summary` for quoting prereqs in answers; fall back to `raw_prose` when `prereqs.parse_warnings` is non-empty.

Concrete edit: find the existing description string and replace the closing punctuation + quote with `". Prefer prereq_summary for quoting prereqs in answers; fall back to raw_prose when prereqs.parse_warnings is non-empty."` — keep the rest unchanged.

- [ ] **Step 3: Write a tool-level test**

**Modify:** `msstate-policies/tests/courses/tool-get-msu-course.test.ts` (append a new describe block; if file doesn't exist, create it with imports):

```typescript
describe("get_msu_course — v0.9.0 response shape", () => {
  test("response includes prereq_summary (may be null)", async () => {
    // Set up corpus with a known course
    setCourseCorpus({
      version: "test",
      scraped_at: "2026-05-13T00:00:00Z",
      records: {
        "CSE 4733": {
          code: "CSE 4733",
          title: "Operating Systems I",
          hours: 3,
          level: "undergraduate",
          description: "",
          semester_offered: null,
          prereqs: {
            required_courses: ["CSE 3183"],
            logic: "and",
            min_grade: "C",
            non_course: [],
            raw_prose: "(Prerequisites: C or better in CSE 3183)",
            parse_warnings: [],
          },
          coreqs: null,
          cross_listed: [],
          source_url: "x",
          prereq_summary: "CSE 3183 (C or better)",
        },
      },
      forward_dag: {},
      reverse_dag: {},
    });

    const res = await get_msu_course.handler({ code: "CSE 4733" });
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(parsed.prereq_summary, "CSE 3183 (C or better)");
    assert.deepEqual(parsed.prereqs.parse_warnings, []);
  });
  test("response prereq_summary is null when course has no prereqs", async () => {
    setCourseCorpus({
      version: "test",
      scraped_at: "x",
      records: {
        "ART 1001": {
          code: "ART 1001",
          title: "Intro to Art",
          hours: 3,
          level: "undergraduate",
          description: "",
          semester_offered: null,
          prereqs: null,
          coreqs: null,
          cross_listed: [],
          source_url: "x",
          prereq_summary: null,
        },
      },
      forward_dag: {},
      reverse_dag: {},
    });
    const res = await get_msu_course.handler({ code: "ART 1001" });
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(parsed.prereq_summary, null);
  });
});
```

Imports at the top of the file (if creating new):

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { get_msu_course } from "../../src/tools/get_msu_course.js";
import { setCourseCorpus } from "../../src/courses/corpus.js";
```

- [ ] **Step 4: Run test**

```bash
cd msstate-policies && npx tsx --test tests/courses/tool-get-msu-course.test.ts 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all pass. If the handler doesn't surface `prereq_summary` because it builds a custom response object (rather than returning the whole record), update the handler to include `prereq_summary: record.prereq_summary` in the returned JSON.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/get_msu_course.ts msstate-policies/tests/courses/tool-get-msu-course.test.ts
git commit -m "feat(get_msu_course): surface prereq_summary + parse_warnings"
```

---

## Stage 9 — `health_check` aggregate counts

### Task 9.1: Add `courses_parse_quality` to `health_check` response

**Files:**
- Read: `msstate-policies/src/tools/health_check.ts`
- Modify: same file
- Modify: `msstate-policies/src/courses/corpus.ts` (add a stats accessor)

- [ ] **Step 1: Add a stats getter in `corpus.ts`**

In `msstate-policies/src/courses/corpus.ts`, append:

```typescript
export interface CoursesParseQuality {
  total_records: number;
  with_prose: number;
  fully_parsed: number;
  with_warnings: number;
  warning_breakdown: {
    non_course_unparsed: number;
    grade_signal_present_but_unparsed: number;
    grade_signal_ambiguous: number;
    logic_ambiguous: number;
  };
}

export function coursesParseQuality(): CoursesParseQuality {
  const records = getCourseCorpus()?.records ?? {};
  let withProse = 0, fullyParsed = 0, withWarnings = 0;
  const breakdown = {
    non_course_unparsed: 0,
    grade_signal_present_but_unparsed: 0,
    grade_signal_ambiguous: 0,
    logic_ambiguous: 0,
  };
  for (const rec of Object.values(records)) {
    if (rec.prereqs?.raw_prose) {
      withProse++;
      const ws = rec.prereqs.parse_warnings ?? [];
      if (ws.length === 0) fullyParsed++;
      else {
        withWarnings++;
        for (const w of ws) {
          if (w in breakdown) breakdown[w as keyof typeof breakdown]++;
        }
      }
    }
  }
  return {
    total_records: Object.keys(records).length,
    with_prose: withProse,
    fully_parsed: fullyParsed,
    with_warnings: withWarnings,
    warning_breakdown: breakdown,
  };
}
```

This reads from the in-memory corpus (no re-scan). Confirm `getCourseCorpus()` is exported from this file — if it's named differently, adjust.

- [ ] **Step 2: Update `health_check` to include the new block**

In `msstate-policies/src/tools/health_check.ts`, import the new helper and add it to the response. Find where the handler returns its JSON response object and add a new key:

```typescript
import { coursesParseQuality } from "../courses/corpus.js";

// ... inside the handler ...
return {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        // ... existing fields ...
        courses_parse_quality: coursesParseQuality(),
      }, null, 2),
    },
  ],
};
```

- [ ] **Step 3: Write a tool-level test**

In `msstate-policies/tests/courses/tool-health-check.test.ts` (create if absent):

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { health_check } from "../../src/tools/health_check.js";
import { setCourseCorpus } from "../../src/courses/corpus.js";

describe("health_check — courses_parse_quality block", () => {
  test("returns aggregate counts with breakdown", async () => {
    setCourseCorpus({
      version: "test",
      scraped_at: "x",
      records: {
        "A 1001": { code: "A 1001", title: "x", hours: 3, level: "undergraduate", description: "", semester_offered: null, prereqs: null, coreqs: null, cross_listed: [], source_url: "x", prereq_summary: null },
        "A 1002": { code: "A 1002", title: "x", hours: 3, level: "undergraduate", description: "", semester_offered: null, prereqs: { required_courses: ["A 1001"], logic: "and", min_grade: "C", non_course: [], raw_prose: "(Prerequisites: C or better in A 1001)", parse_warnings: [] }, coreqs: null, cross_listed: [], source_url: "x", prereq_summary: "A 1001 (C or better)" },
        "A 1003": { code: "A 1003", title: "x", hours: 3, level: "undergraduate", description: "", semester_offered: null, prereqs: { required_courses: [], logic: null, min_grade: null, non_course: [], raw_prose: "(Prerequisites: a vibe check)", parse_warnings: ["non_course_unparsed"] }, coreqs: null, cross_listed: [], source_url: "x", prereq_summary: "(prereqs published but not machine-parsed in full — see raw_prose)" },
      },
      forward_dag: {},
      reverse_dag: {},
    });
    const res = await health_check.handler({});
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    assert.ok(parsed.courses_parse_quality);
    assert.equal(parsed.courses_parse_quality.total_records, 3);
    assert.equal(parsed.courses_parse_quality.with_prose, 2);
    assert.equal(parsed.courses_parse_quality.fully_parsed, 1);
    assert.equal(parsed.courses_parse_quality.with_warnings, 1);
    assert.equal(parsed.courses_parse_quality.warning_breakdown.non_course_unparsed, 1);
  });
});
```

- [ ] **Step 4: Run test**

```bash
cd msstate-policies && npx tsx --test tests/courses/tool-health-check.test.ts 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/courses/corpus.ts msstate-policies/src/tools/health_check.ts msstate-policies/tests/courses/tool-health-check.test.ts
git commit -m "feat(health_check): expose courses_parse_quality aggregate"
```

---

## Stage 10 — Worker mirror

### Task 10.1: Mirror `parse_warnings` + `prereq_summary` + health_check block in the Worker

**Files:**
- Modify: `worker/src/index.ts`

The Worker has no module boundary — types and helpers live inline. Mirror the new fields in the inline interfaces and dispatch handlers.

- [ ] **Step 1: Find the inline course types in worker/src/index.ts**

```bash
grep -nE "interface Course|interface Prereq|prereqs:|raw_prose" worker/src/index.ts | head -15
```

Locate the inline `interface Prereq` (or `CoursePrereqs`) and `interface Course` (or `CourseRecord`) definitions in the Worker.

- [ ] **Step 2: Extend Worker types**

In `worker/src/index.ts`, find the `Prereq` interface and add the new field:

```typescript
interface Prereq {  // or whatever the local name is — keep it
  required_courses: string[];
  logic: "or" | "and" | "mixed" | null;
  min_grade: "A" | "B" | "C" | "D" | null;
  non_course: string[];
  raw_prose: string;
  parse_warnings?: string[];  // v0.9.0 — optional for backward compat with older corpus.json
}
```

And the `Course` interface:

```typescript
interface Course {  // or whatever the local name is
  // ... existing fields ...
  prereq_summary?: string | null;  // v0.9.0 — optional for backward compat
}
```

The `?` makes them optional so an older corpus.json (without these fields) still parses. The Worker is read-only — it surfaces whatever the corpus has.

- [ ] **Step 3: Update the `get_msu_course` case branch in tools/call**

Find the `case "get_msu_course":` branch. The handler returns the record from the corpus. Verify it includes `prereq_summary` and `prereqs.parse_warnings` by reading the record's full shape — if the handler explicitly picks fields (rather than spreading), add the two new keys to the picked output.

- [ ] **Step 4: Add `courses_parse_quality` to health_check inline**

Find the `case "health_check":` branch. Add a helper function before the switch:

```typescript
function coursesParseQualityWorker(): {
  total_records: number;
  with_prose: number;
  fully_parsed: number;
  with_warnings: number;
  warning_breakdown: Record<string, number>;
} {
  const records = (corpus as { courses?: { records?: Record<string, { prereqs?: { raw_prose: string | null; parse_warnings?: string[] } | null }> } }).courses?.records ?? {};
  let withProse = 0, fullyParsed = 0, withWarnings = 0;
  const breakdown: Record<string, number> = {
    non_course_unparsed: 0,
    grade_signal_present_but_unparsed: 0,
    grade_signal_ambiguous: 0,
    logic_ambiguous: 0,
  };
  for (const rec of Object.values(records)) {
    if (rec.prereqs?.raw_prose) {
      withProse++;
      const ws = rec.prereqs.parse_warnings ?? [];
      if (ws.length === 0) fullyParsed++;
      else {
        withWarnings++;
        for (const w of ws) if (w in breakdown) breakdown[w]++;
      }
    }
  }
  return {
    total_records: Object.keys(records).length,
    with_prose: withProse,
    fully_parsed: fullyParsed,
    with_warnings: withWarnings,
    warning_breakdown: breakdown,
  };
}
```

Inside the `health_check` case branch, add `courses_parse_quality: coursesParseQualityWorker()` to the returned JSON.

- [ ] **Step 5: Typecheck the Worker**

```bash
cd worker && npx --no-install tsc --noEmit 2>&1 | tail -5
```

Expected: clean. Fix any type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
git add worker/src/index.ts
git commit -m "feat(worker): mirror parse_warnings + prereq_summary + health stats"
```

---

## Stage 11 — Build pipeline ceiling aborts

### Task 11.1: Add per-category aborts to `scripts/build-worker-corpus.mjs`

**Files:**
- Modify: `scripts/build-worker-corpus.mjs`

The course-scrape already aborts on shape errors with the canonical string `"refusing to ship a poisoned course corpus"`. Add 3 more abort sites for per-category ceiling breaches.

- [ ] **Step 1: Find the existing course validation block**

```bash
grep -n "refusing to ship a poisoned course corpus\|out.courses" scripts/build-worker-corpus.mjs | head -10
```

- [ ] **Step 2: Add a parse-quality audit + ceiling enforcement**

After the course scrape completes and `out.courses` is populated (look for `out.courses = { ... }` or similar), add:

```javascript
// v0.9.0 — per-category parse-quality ceilings. Counts come from
// reparsing each record's raw_prose with the live parser (so a corpus
// that was scraped under an older parser still gets audited under the
// current rules).
{
  const { parsePrereqProse } = await import("../msstate-policies/src/courses/parser.js");
  const records = out.courses.records;
  const breakdown = {
    non_course_unparsed: 0,
    grade_signal_present_but_unparsed: 0,
    grade_signal_ambiguous: 0,
    logic_ambiguous: 0,
  };
  for (const rec of Object.values(records)) {
    if (!rec.prereqs?.raw_prose) continue;
    const reparsed = parsePrereqProse(rec.prereqs.raw_prose);
    for (const w of (reparsed?.parse_warnings ?? [])) {
      if (w in breakdown) breakdown[w]++;
    }
  }
  console.error(
    `[build-worker-corpus]   courses_parse_quality: non_course_unparsed=${breakdown.non_course_unparsed} grade_unparsed=${breakdown.grade_signal_present_but_unparsed} logic_ambiguous=${breakdown.logic_ambiguous}`,
  );
  if (breakdown.non_course_unparsed > 30) {
    throw new Error(
      `courses: non_course_unparsed=${breakdown.non_course_unparsed} > 30 — refusing to ship a poisoned course corpus`,
    );
  }
  if (breakdown.grade_signal_present_but_unparsed > 10) {
    throw new Error(
      `courses: grade_signal_present_but_unparsed=${breakdown.grade_signal_present_but_unparsed} > 10 — refusing to ship a poisoned course corpus`,
    );
  }
  if (breakdown.logic_ambiguous > 50) {
    throw new Error(
      `courses: logic_ambiguous=${breakdown.logic_ambiguous} > 50 — refusing to ship a poisoned course corpus`,
    );
  }
}
```

The dynamic `import("../msstate-policies/src/courses/parser.js")` reads the parser straight from source (esbuild bundling happens later for the npm package; the build script itself runs unbundled TypeScript via `tsx`).

- [ ] **Step 3: Verify the canonical abort string count is ≥ existing-count + 3**

```bash
grep -c "refusing to ship a poisoned course corpus" scripts/build-worker-corpus.mjs
```

Expected: the count grew by 3.

- [ ] **Step 4: Smoke-run the build pipeline (no live MSU yet — dry-validation)**

The build script also touches the live MSU site, so we need a full run. Skip dry-run — go straight to Stage 12.2's live rebuild and confirm the new aborts don't trigger spuriously.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-worker-corpus.mjs
git commit -m "build(courses): per-category parse-quality ceiling aborts"
```

---

## Stage 12 — Eval extension + live corpus rebuild

### Task 12.1: Add 3 new courses-eval questions

**Files:**
- Modify: `msstate-policies/eval/courses.jsonl`

- [ ] **Step 1: Inspect the existing eval shape**

```bash
head -3 msstate-policies/eval/courses.jsonl
wc -l msstate-policies/eval/courses.jsonl
```

Note the JSONL format and existing question shapes (likely `{kind, q, args, expected_…}` or similar).

- [ ] **Step 2: Pick 3 real courses from the corpus to use as test subjects**

```bash
# Find a course with non_course prereqs (e.g., MPH or FNH)
jq -r '.courses.records | to_entries[] | select(.value.prereqs.raw_prose != null and ((.value.prereqs.required_courses | length) == 0) and ((.value.prereqs.non_course | length) > 0)) | .key' worker/corpus.json | head -3

# Find a course with a min_grade
jq -r '.courses.records | to_entries[] | select(.value.prereqs.min_grade == "C") | .key' worker/corpus.json | head -3

# Find a course with "senior standing" in prereqs
jq -r '.courses.records | to_entries[] | select(.value.prereqs.non_course // [] | any(. | test("senior standing"; "i"))) | .key' worker/corpus.json | head -3
```

Pick one course per category. Use the EXACT course code returned.

- [ ] **Step 3: Append the 3 new eval rows**

```bash
# Replace <CODE_1>, <CODE_2>, <CODE_3> with the picks from Step 2.
cat >> msstate-policies/eval/courses.jsonl <<EOF
{"kind":"prereq_non_course","desc":"course with non-course prereqs surfaces them","args":{"name":"get_msu_course","arguments":{"code":"<CODE_1>"}},"expect":{"prereqs.non_course.length_gte":1,"prereq_summary.contains":"…"}}
{"kind":"prereq_min_grade","desc":"course with 'C or better' surfaces min_grade","args":{"name":"get_msu_course","arguments":{"code":"<CODE_2>"}},"expect":{"prereqs.min_grade":"C","prereq_summary.contains":"C or better"}}
{"kind":"prereq_senior_standing","desc":"course with 'senior standing' surfaces it","args":{"name":"get_msu_course","arguments":{"code":"<CODE_3>"}},"expect":{"prereqs.non_course.contains_substring":"senior standing"}}
EOF
```

Replace `<CODE_X>` and the `expect` values' `…` placeholders with the EXACT data you found in Step 2's `jq` output.

If the existing eval runner's `expect` keys use different names than these (e.g., `expected_amount` vs `expect.amount_usd`), match the existing convention by reading the courses suite block in `scripts/run-eval.mjs`.

- [ ] **Step 4: If `scripts/run-eval.mjs --suite=courses` doesn't recognize the 3 new `kind` values, add their handlers**

```bash
grep -n 'q.kind === "prereq_' scripts/run-eval.mjs | head -3
```

If those kinds aren't handled, add `if (q.kind === "prereq_non_course") { … }` branches near the existing courses-suite branches. Each branch:

1. Calls `get_msu_course` with `q.args.arguments`
2. Parses the response JSON
3. Evaluates the `expect` clauses (length_gte, equality, contains_substring)

Mirror the existing per-kind assertion pattern.

- [ ] **Step 5: Run the eval**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && node scripts/run-eval.mjs --suite=courses 2>&1 | tail -5
```

Expected: pass count ≥ ceil(0.95 × total). The 52 existing questions should still pass at 100%; the 3 new ones should also pass.

- [ ] **Step 6: Commit**

```bash
git add msstate-policies/eval/courses.jsonl scripts/run-eval.mjs
git commit -m "test(courses): 3 new eval questions exercising parse_warnings + prereq_summary"
```

### Task 12.2: Rebuild corpus end-to-end

**Files:**
- Modify (regenerated): `worker/corpus.json`, `msstate-policies/dist/index.js`, `msstate-policies/dist/calendar-synonyms.json`

- [ ] **Step 1: Source env and run the live build**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
set -a; . ./.env; set +a
node scripts/build-worker-corpus.mjs 2>&1 | tail -40
```

Expected: build succeeds; new log line `courses_parse_quality: non_course_unparsed=X grade_unparsed=Y logic_ambiguous=Z` with all three ≤ ceiling. NO abort.

- [ ] **Step 2: Validate the new corpus has the expected shape**

```bash
jq '[.courses.records | to_entries[] | select(.value.prereq_summary != null)] | length' worker/corpus.json
jq '[.courses.records | to_entries[] | select((.value.prereqs.parse_warnings // []) | length > 0)] | length' worker/corpus.json
```

Expected: first count is high (most courses with prereqs have a summary); second count is well under the historical baseline (was 91 = 63 + 28 + ambiguous; should be ≤ 50 post-fix).

- [ ] **Step 3: Rebuild stdio bundle**

```bash
cd msstate-policies && npm run build 2>&1 | tail -3
head -2 dist/index.js
```

Expected: banner reads `// msstate-policies-mcp 0.8.0 …`. (Bump comes in Stage 13.)

- [ ] **Step 4: Run all tests against the rebuilt corpus**

```bash
cd msstate-policies && npm test 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all pass, including the corpus-regression test from Task 7.1 (which now runs against the rebuilt corpus and sees the lower warning counts).

- [ ] **Step 5: Commit**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
git add worker/corpus.json msstate-policies/dist/index.js msstate-policies/dist/calendar-synonyms.json
git commit -m "build(courses): rebuild corpus with v0.9.0 parser + prereq_summary"
```

---

## Stage 13 — Docs, version bump, release

### Task 13.1: Update CLAUDE.md / README.md / docs/BUILD.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/BUILD.md`

- [ ] **Step 1: README — bump the courses Quality row + add parse_warnings note**

In `README.md`, find the Quality table. Update the courses row:

```markdown
| Courses | 55 catalog-grounded questions across 4 buckets (incl. parse_warnings + prereq_summary) | 100% / 100% / 100% / 100% |
```

And add the v0.9.0 line to the `get_msu_course` row in the 18-tools table:

```markdown
| `get_msu_course` | One course's full record — title, hours, prereqs (structured + `prereq_summary` one-liner + `parse_warnings` diagnostic), cross-listings, source URL |
```

Bump current version banner from `v0.8.0` to `v0.9.0` everywhere it appears in README.

- [ ] **Step 2: CLAUDE.md — addendum**

After the v0.8.0 tuition extension section, append:

```markdown
### Corpus extension (2026-05-13c) — prereq tightening (v0.9.0)

Closes three measured accuracy gaps in the courses prereq parser. No new tools; the `Prereq` block gains `parse_warnings: PrereqWarning[]` and the `Course` record gains `prereq_summary: string | null`. `health_check` exposes `courses_parse_quality`.

The parser uses regex-based extraction (Approach A from the spec). When prose contains content but extractors find nothing, emit `non_course_unparsed`. When a grade-trigger word is present but no pattern matched, emit `grade_signal_present_but_unparsed`. When AND/OR composition is genuinely mixed, emit `logic_ambiguous`.

**Build aborts (3 new sites, all use the canonical "refusing to ship a poisoned course corpus" string):**

- `non_course_unparsed > 30`
- `grade_signal_present_but_unparsed > 10`
- `logic_ambiguous > 50`

Treat these ceilings as load-bearing. If a future parser change drops the score, fix the parser before merging — do not raise the ceiling.

**Field stability:** `parse_warnings` is appended to `Prereq`; `prereq_summary` is appended to `Course`. Both are non-breaking additions to the JSON-RPC response shape. Worker mirrors the new fields inline.
```

- [ ] **Step 3: docs/BUILD.md — Courses module addendum**

After the existing courses module section, append a "Prereq parser quality (v0.9.0)" subsection with:

- Pre-fix baseline (130 / 63 / 28 from the spec)
- Post-fix targets (≤ 30 / ≤ 10 / ≥ 620 fully_parsed)
- The 6-pattern non_course extraction list (categories only — full regex in code)
- The 6-pattern grade list (categories only)
- The 4 warning types and what each one means

This is documentation, not code — keep it under 50 lines, link to the parser source for details.

- [ ] **Step 4: Run full test suite (sanity)**

```bash
cd msstate-policies && npm test 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail"
```

Expected: all pass.

- [ ] **Step 5: Commit docs**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
git add CLAUDE.md README.md docs/BUILD.md
git commit -m "docs(courses): v0.9.0 prereq tightening — README/CLAUDE/BUILD addenda"
```

### Task 13.2: Version bump 0.8.0 → 0.9.0 + rebuild

**Files:**
- Modify: `msstate-policies/package.json`
- Modify: `msstate-policies/.claude-plugin/plugin.json` (auto-synced by sync-version.mjs on next build)
- Modify: `worker/src/index.ts` (3 hardcoded "0.8.0" sites — `version: "0.8.0"`, `serverInfo: { name: ..., version: "0.8.0" }`, info JSON version field)

- [ ] **Step 1: Bump all versions**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
sed -i.bak 's/"version": "0.8.0"/"version": "0.9.0"/' msstate-policies/package.json && rm msstate-policies/package.json.bak
sed -i.bak 's/version: "0.8.0"/version: "0.9.0"/g; s/"version": "0.8.0"/"version": "0.9.0"/g' worker/src/index.ts && rm worker/src/index.ts.bak
grep '"version"' msstate-policies/package.json
grep -nE '0\.[89]\.0' worker/src/index.ts | head -3
```

Expected: package.json shows 0.9.0; worker shows 0.9.0 in all 3 sites.

- [ ] **Step 2: Rebuild bundle + verify banner**

```bash
cd msstate-policies && npm run build 2>&1 | tail -3
head -2 dist/index.js
```

Expected: banner reads `msstate-policies-mcp 0.9.0 <sha> …`. The `npm run build` chain runs `sync-version.mjs` first, which copies the new version into `plugin.json`.

- [ ] **Step 3: Run the full test suite + security checklist**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
(cd msstate-policies && npm test 2>&1 | grep -E "^ℹ tests|^ℹ pass|^ℹ fail")
bash tools/security-checklist.sh 2>&1 | tail -1
```

Expected: all tests pass; security score still 245 (macOS) / 257 (Linux CI). No new security checks for this release.

- [ ] **Step 4: Commit version bump**

```bash
git add msstate-policies/package.json msstate-policies/.claude-plugin/plugin.json worker/src/index.ts msstate-policies/dist/index.js
git status --short
git commit -m "release: v0.9.0 — prereq tightening

- 4 parse_warnings categories; per-row diagnostic on every Prereq
- prereq_summary one-liner on every Course (human-readable)
- broadened extractNonCourse (4 new categories) + prioritized GRADE_PATTERNS
- health_check.courses_parse_quality aggregate counts
- build aborts on per-category ceiling regression
- 3 new courses-eval questions exercise the new fields

No new MCP tools (still 18). Response shape additions are non-breaking.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 13.3: Push branch, open PR (STOP — do not merge)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/prereq-tightening 2>&1 | tail -3
```

- [ ] **Step 2: Open a PR**

```bash
gh pr create --base main --head feat/prereq-tightening --title "v0.9.0: Prereq tightening + accuracy tracking" --body "$(cat <<'EOF'
## Summary

Closes three measured accuracy gaps in the courses prereq parser. No new MCP tools — `Prereq` gains `parse_warnings: PrereqWarning[]`, `Course` gains `prereq_summary: string | null`, `health_check` exposes `courses_parse_quality`.

- **Spec:** `.dev/specs/2026-05-13-prereq-tightening-design.md`
- **Plan:** `.dev/plans/2026-05-13-prereq-tightening.md`

## What this delivers

| | |
|---|---|
| Tool count | 18 → **18** (no change) |
| Eval | 52 → 55 questions, 100% pass |
| Unit tests | 288 → ~310 pass |
| Parse-quality (non_course_unparsed) | 63 → ≤ 30 (≥ 52% reduction) |
| Parse-quality (grade unparsed) | 28 → ≤ 10 (≥ 64% reduction) |
| Build aborts | +3 (per-category ceilings) |
| Security score (Linux CI) | 257 / 257 (unchanged) |

## Response-shape additions (non-breaking)

- `Course.prereq_summary: string | null` — one-line human-readable prereq summary, or warning sentinel when parse is incomplete
- `Prereq.parse_warnings: PrereqWarning[]` — diagnostic categories; empty array means fully parsed
- `health_check.courses_parse_quality` — aggregate counts + breakdown

## Test plan

- [x] `npm test` → all unit tests pass
- [x] `node scripts/run-eval.mjs --suite=courses` → 55/55 pass
- [x] `bash tools/security-checklist.sh` → score 245 (macOS) / 257 (Linux CI)
- [x] Live corpus rebuilt; aggregate post-fix counts under ceilings
- [x] Stdio bundle banner reads `msstate-policies-mcp 0.9.0`

## Release follow-ups (after merge)

- npm publish msstate-policies-mcp@0.9.0
- cd worker && wrangler deploy
- git tag v0.9.0 && git push origin v0.9.0

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

- [ ] **Step 3: STOP — do not merge**

PR is open. Do NOT merge automatically — user will review and merge themselves. Report the PR URL and stop.

---

## Done

After Stage 13, the v0.9.0 PR is open. Same release pattern as v0.8.0: review PR → merge → npm publish → wrangler deploy → tag.

If a downstream model asks about a course whose prereqs include "permission of instructor" or a non-course requirement, the model now sees a clean `prereq_summary` instead of empty arrays and learns to fall back to `raw_prose` when `parse_warnings` is non-empty.



