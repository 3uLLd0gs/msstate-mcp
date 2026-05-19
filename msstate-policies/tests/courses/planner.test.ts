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
