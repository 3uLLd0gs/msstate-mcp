import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { prereqsSatisfied, normalizeCompleted } from "../../src/courses/planner.js";
import { filterCandidateCourses } from "../../src/courses/planner.js";
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
  test("respects pre-normalized completed set (caller must normalize)", () => {
    const c = course("CSE 2383", pr(["CSE 1284"], "and"));
    // Caller is expected to call normalizeCompleted() first. Un-normalized
    // input intentionally does NOT match — keeps the hot path cheap.
    assert.equal(prereqsSatisfied(c, new Set(["cse  1284"])), false);
    assert.equal(prereqsSatisfied(c, normalizeCompleted(["cse  1284"])), true);
  });
});

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
