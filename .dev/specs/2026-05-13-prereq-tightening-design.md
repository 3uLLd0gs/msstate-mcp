# Prereq parser tightening + accuracy tracking — design

**Date:** 2026-05-13
**Target release:** v0.9.0
**Status:** brainstorming approved, pending implementation plan

## Motivation

The course-catalog module is at 84% prereq-extraction quality:

| Symptom | Count (of 3,737 courses) | % |
|---|---|---|
| Courses with non-empty `raw_prose` | 678 | 18.1% |
| Of those, `required_courses` extracted | 548 | 80.8% |
| Of those, `required_courses` AND `non_course` BOTH empty | 63 | 9.3% |
| `raw_prose` contains "C or better" / similar AND `min_grade` is null | 28 | (26% miss rate on a clear signal) |

The user-facing effect: when a student asks the model about a course whose prereqs are non-course-coded (e.g., "admission to Teacher Education", "senior standing", "permission of instructor"), the model sees `required_courses: []` and `non_course: []` and may incorrectly conclude the course has no prereqs. The `raw_prose` field carries the truth, but only as a fallback the model has to recognize.

Goal: tighten the parser so the dropped 63 land in `non_course`, the missed 28 land in `min_grade`, and we get a routable signal (`parse_warnings`) on the remainder so the model knows when to fall back to `raw_prose`. Also surface aggregate parse quality in `health_check` so accuracy regressions are visible and CI-gated.

Out of scope: a grammar-based parser rewrite (would chase the long tail with diminishing returns), and a student-side "courses remaining" planner (different problem, would need a degree-requirements corpus we don't have).

## Approach

Approach A from brainstorming: **targeted parser fixes + per-row warnings + aggregate `health_check` counts + `prereq_summary` string in `get_msu_course`**. No new MCP tool; tool count stays at 18.

## Section 1 — `non_course` extraction (closes the 63-dropped gap)

The 63 courses with empty `required_courses` AND empty `non_course` fall into six recognizable categories. Sampling confirms each category is matchable with a focused pattern.

| Category | Pattern (case-insensitive) | Example extraction |
|---|---|---|
| Permission / consent | `/(permission\|consent)\s+of\s+[\w\s]+?(?=$\|\sand\|\sor\|;\|\.)/` | `permission of instructor` |
| Admission status | `/admission\s+to\s+([A-Z][\w\s]+?)(?=$\|\sand\|\sor\|;\|\.)/` | `Admission to Teacher Education` |
| Hours-of-X | `/((?:\d+\|[a-z]+-?[a-z]*))\s+hours?\s+of\s+([^,.()]+?)(?=$\|\sand\|\sor\|;\|\.)/` | `Seven hours of biological science` |
| Class standing | `/(freshman\|sophomore\|junior\|senior\|graduate)\s+standing/` | `senior standing` |
| Core / sequence completion | `/completion\s+of\s+([^,.()]+?)(?=$\|\sand\|\sor\|;\|\.)/` | `Completion of all core MPH courses` |
| Skill / proficiency | `/proficiency\s+(?:with\|in)\s+([^,.()]+)/` | `Proficiency with spreadsheet software` |

The extractor runs all six over `raw_prose`, dedupes results (preserving order of first appearance), and lands the array in `non_course: string[]`. If `raw_prose` has content but ALL six produce zero matches AND `required_courses` is also empty, emit `parse_warnings: ["non_course_unparsed"]` so the model knows to surface `raw_prose` verbatim instead of claiming no prereqs.

Explicitly NOT solving here: complex multi-clause AND/OR composition (e.g., *"either (X and Y) or Z"*). The `logic` field stays best-effort with the `logic_ambiguous` warning when composition can't be classified.

## Section 2 — `min_grade` regex tightening (closes the 28-missed gap)

Replace the single brittle regex with a prioritized pattern list (first match wins). Patterns are case-insensitive; the captured letter is constrained to `[A-D]` to avoid false positives on standalone letters (e.g., `E` in `ECE 3714`, `F` in `FOR 1234`).

```typescript
const GRADE_PATTERNS: readonly RegExp[] = [
  /minimum\s+grade\s+of\s+(?:an?\s+)?([A-D])\b/i,
  /grade\s+of\s+(?:an?\s+)?([A-D])\s+or\s+better/i,
  /(?:^|[^A-Z])(?:an?\s+)?([A-D])\s+or\s+better/,    // anchored to non-letter to avoid grabbing course prefix
  /minimum\s+(?:an?\s+)?([A-D])\s+grade/i,
  /earning\s+(?:an?\s+)?([A-D])\b/i,
  /with\s+(?:an?\s+)?([A-D])\s+or\s+better/i,
];
```

Phrasings explicitly tested (in `tests/courses/prereq.test.ts`):

- `"C or better in CSE 3183"` → `"C"` (the 80 already-matched cases)
- `"a C or better"` → `"C"`
- `"grade of C or better"` → `"C"`
- `"minimum grade of C"` → `"C"`
- `"earning a C"` → `"C"`
- `"with a C or better"` → `"C"`
- `"minimum B grade"` → `"B"`
- `"in CSE 3183 and ECE 3714"` → `null` (no grade phrase, just course codes — false-positive guard)
- `"A score of 70%"` → `null` ("A" but not a grade — false-positive guard)
- `"with a B"` → `null` (no "or better" → genuinely ambiguous; "with" is not in the grade-signal trigger list, so emits no warning)

When `raw_prose` contains any of the trigger words `grade` / `better` / `minimum` / `earning` but NO pattern matches, emit `parse_warnings: ["grade_signal_present_but_unparsed"]`. This is distinct from `grade_signal_ambiguous`, which is reserved for the case where a pattern DID match but the captured letter is low-confidence (e.g., a single letter that could be a course-prefix initial when context is missing — currently unreachable given the `[A-D]` + `[^A-Z]` guards, but reserved for future false-positive cases discovered in the wild).

## Section 3 — Tracking surface

### 3a — Per-row `parse_warnings` field

Extend the existing `prereqs` block in the `CourseRecord` interface in `msstate-policies/src/courses/types.ts`:

```typescript
interface CoursePrereqs {
  required_courses: string[];                 // (existing) authoritative
  raw_prose: string | null;                   // (existing) authoritative
  logic: "and" | "or" | "mixed" | null;       // (existing) best-effort
  min_grade: "A" | "B" | "C" | "D" | null;    // (existing) best-effort, regex now tightened
  non_course: string[];                       // (existing) populated by Section 1's broader extraction

  // NEW
  parse_warnings: PrereqWarning[];
}

type PrereqWarning =
  | "non_course_unparsed"
  | "grade_signal_present_but_unparsed"
  | "grade_signal_ambiguous"
  | "logic_ambiguous";
```

Empty array means "parser thinks it got everything cleanly." Non-empty array is a routable signal: the model checks the array and falls back to `raw_prose` for any field whose warning indicates incomplete parsing.

### 3b — Aggregate `courses_parse_quality` block in `health_check`

Extend the `health_check` tool's response with a new top-level key:

```json
{
  "courses_parse_quality": {
    "total_records": 3737,
    "with_prose": 678,
    "fully_parsed": 620,
    "with_warnings": 58,
    "warning_breakdown": {
      "non_course_unparsed": 30,
      "grade_signal_present_but_unparsed": 8,
      "grade_signal_ambiguous": 0,
      "logic_ambiguous": 20
    }
  }
}
```

Counts are computed at corpus-build time and baked into the corpus JSON; `health_check` reads them at runtime (no re-scan).

Build-time guards in `scripts/build-worker-corpus.mjs` abort with the canonical string `refusing to ship a poisoned course corpus` (already in use) on:

- `non_course_unparsed > 30`
- `grade_signal_present_but_unparsed > 10`
- `logic_ambiguous > 50`

Ceilings are 3-4× post-fix expected rates — generous enough to absorb MSU markup drift, tight enough to catch real regressions.

### 3c — `prereq_summary` field in `get_msu_course` response

A short, human-readable sentence the model can quote without parsing arrays. Computed at corpus-build time and stored on each course record.

Examples:

| Course condition | `prereq_summary` |
|---|---|
| `raw_prose` is null | `null` |
| Clean parse: required_courses + min_grade + non_course | `"CSE 3183 (C or better), and (CSE 3724 or ECE 3714)"` |
| Clean parse: non_course only | `"Permission of instructor; senior standing"` |
| Clean parse: hours-of-X | `"Seven hours of biological science; two semesters of organic chemistry"` |
| Any `parse_warnings` present | `"(prereqs published but not machine-parsed in full — see raw_prose)"` |

Construction algorithm (deterministic, no LLM):

1. If `raw_prose` is null → return `null`.
2. If `parse_warnings` has any entry → return the sentinel string `"(prereqs published but not machine-parsed in full — see raw_prose)"`.
3. Otherwise:
   - Start with `required_courses` joined by AND/OR based on `logic` (default AND when `logic` is null).
   - If `min_grade` is set, append ` (${min_grade} or better)` after the joined courses.
   - If `non_course` is non-empty, append `"; "` + items joined by `"; "`.

### 3d — `get_msu_course` tool description tweak

Append one sentence to the existing description:

> Prefer `prereq_summary` for quoting; fall back to `raw_prose` when `parse_warnings` is non-empty.

So both Claude and ChatGPT pick the right field. Consistent with the v0.8.0 server-instructions philosophy.

## Section 4 — Test plan

### Unit tests — extend `msstate-policies/tests/courses/prereq.test.ts`

Three `describe` blocks, table-driven:

- `parseNonCourseRequirements (Section 1)` — ~15 cases across all six categories, plus edge cases (empty `raw_prose`, course-codes-only, deduplication).
- `parseMinGrade (Section 2)` — the 9 phrasings listed in Section 2 above, plus the 2 false-positive guards.
- `prereqWarnings (Section 3a)` — assert correct warning emission for each scenario, and assert that fully-parsed inputs emit `[]`.

### Corpus regression test — new file `msstate-policies/tests/courses/prereq-corpus-regression.test.ts`

Runs the new prereq parser over every `raw_prose` in `worker/corpus.json` and asserts category counts stay within ceilings:

```typescript
test("post-fix aggregate stays within ceiling", () => {
  const counts = auditCorpus();
  assert.ok(counts.non_course_unparsed <= 30);
  assert.ok(counts.grade_signal_present_but_unparsed <= 10);
  assert.ok(counts.fully_parsed >= 620);  // expect 25+ newly-fixed (was 595)
});
```

Real safety net: a future parser change that drops the score gets caught at `npm test` time.

### Tool-shape test — extend `msstate-policies/tests/courses/tool-get-msu-course.test.ts`

- Response includes `prereq_summary` (string or null) on every call.
- `prereq_summary` is `null` iff `raw_prose` is `null`.
- `prereq_summary` is the warning sentinel iff `parse_warnings` is non-empty.
- `parse_warnings` is always an array (never undefined).

### Eval — extend `msstate-policies/eval/courses.jsonl`

Add 3 questions exercising the new fields:

- A FNH or MPH course with non-course prereqs → assert response includes the `non_course` items
- A CSE course with "C or better" → assert response includes `min_grade: "C"` in either `prereqs.min_grade` or `prereq_summary`
- A course with senior-standing requirement → assert `non_course` contains `"senior standing"`

Existing 52 course-eval questions must still pass at 100%.

## Section 5 — Worker mirror

The Worker has no module boundary — types and helpers live inline in `worker/src/index.ts`. Mirror these changes:

- Extend the inline `CoursePrereqs` interface with `parse_warnings: string[]`.
- Update the `get_msu_course` case branch to include `prereq_summary` in the response object (read from the baked corpus, no recomputation at request time).
- Update the `health_check` case branch to include the `courses_parse_quality` block.

Worker reads from `worker/corpus.json`, so the build pipeline writing the new fields is what makes them available. No new logic in the Worker itself.

## Net deltas

| Dimension | Before (v0.8.0) | After (v0.9.0) | Delta |
|---|---|---|---|
| Tool count | 18 | 18 | 0 |
| `prereqs` block keys | 5 | 6 (`parse_warnings`) | +1 |
| `get_msu_course` response keys | M | M+1 (`prereq_summary`) | +1 |
| `health_check` response keys | N | N+1 (`courses_parse_quality`) | +1 |
| Unit tests | 288 | ~308 | +~20 |
| Eval questions (courses) | 52 | 55 | +3 |
| Build-time aborts | existing | +3 (per-category ceiling) | +3 |
| Tool description edits | 0 | 1 (`get_msu_course`) | +1 sentence |
| New deps | 0 | 0 | 0 |
| Lines added (estimate) | — | ~400 | parser + tests + tool tweak + health_check |
| Security checklist score | 245 macOS / 257 Linux | unchanged | 0 |

## Source-data quirks (handled, do not regress)

- The 63 dropped courses include phrasing variations like *"consent of the practicum director"* (definite article) — Section 1's permission/consent regex uses `\w+` not `instructor`/`director` to catch all permission-like phrases.
- Three courses in the corpus have `raw_prose` like *"none"* or *"None"* — these should NOT trigger `non_course_unparsed`. Add an early-out: if `raw_prose.trim().toLowerCase()` matches `none|n/a|see description`, treat as null-equivalent and emit no warning.
- The `with a B` test case intentionally stays unparsed — without "or better" it's ambiguous whether the prose means "you'll get a B" vs "you need a B." This is the right behavior; the warning surfaces it for the model.

## Out of scope

- **Approach C (grammar-based parser rewrite)** — deferred until we hit a quality ceiling that regex can't crack.
- **Student-side "courses remaining" planner / graduation audit** — different domain; requires degree-requirements corpus we don't have.
- **A 19th MCP tool for parser-issue diagnostics** — rejected in brainstorming; this stays a maintainer concern surfaced through `health_check`.
- **Cross-listed course prereq inheritance** — current behavior is correct; cross-listings each get their own record with shared prereqs from the source page.
- **`coreqs` field deep parsing** — no evidence it's broken; left as best-effort.

## Release path

Single feature branch `feat/prereq-tightening`. Standard cadence:

1. Implement parser + tests + corpus regression test on the branch
2. Rebuild corpus against live MSU; verify aggregate counts hit the targets (`non_course_unparsed ≤ 30`, `grade_signal_present_but_unparsed ≤ 10`, `fully_parsed ≥ 620`)
3. Update CLAUDE.md / docs/BUILD.md with parse_warnings invariants
4. Update README — bump Quality table row for courses (84% → ~92% extraction); mention `parse_warnings` + `prereq_summary` in the `get_msu_course` row
5. Bump version 0.8.0 → 0.9.0 in `package.json`, `plugin.json`, `worker/src/index.ts` (3 places)
6. PR + merge to main
7. Re-deploy Worker + republish npm + tag v0.9.0

## Open questions

None — all clarifying questions resolved during brainstorming.

## References

- Brainstorming transcript: parent conversation, 2026-05-13.
- Predecessor module pattern: `msstate-policies/src/courses/prereq.ts` (existing, will be extended).
- Build pipeline: `scripts/build-worker-corpus.mjs` — adds per-category ceiling aborts.
- Eval runner: `scripts/run-eval.mjs --suite=courses` — 52 questions → 55 questions.
