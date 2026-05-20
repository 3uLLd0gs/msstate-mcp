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
  return { version: "x", scraped_at: "2026-05-19T00:00:00.000Z", records: r, forward_dag: {}, reverse_dag: {} };
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
    assert.ok(r.notes.some((n: string) => /live section/i.test(n)));
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
