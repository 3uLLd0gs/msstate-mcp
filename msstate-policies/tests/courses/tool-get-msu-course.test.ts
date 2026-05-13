import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { get_msu_course } from "../../src/tools/get_msu_course.js";
import { setCourseCorpus } from "../../src/courses/corpus.js";
import type { CourseCorpus } from "../../src/courses/types.js";

const CORPUS: CourseCorpus = {
  version: "test", scraped_at: "2026-05-12T00:00:00Z",
  records: {
    "CSE 4153": {
      code: "CSE 4153", title: "Data Communications", hours: 3, level: "undergraduate",
      description: "(Prerequisites: CSE 3724). Networks.",
      semester_offered: null,
      prereqs: { required_courses: ["CSE 3724"], logic: null, min_grade: null, non_course: [], raw_prose: "(Prerequisites: CSE 3724)", parse_warnings: [] },
      coreqs: null, cross_listed: [],
      source_url: "https://catalog.msstate.edu/search/?P=CSE%204153",
      prereq_summary: null,
    },
  },
  forward_dag: { "CSE 4153": ["CSE 3724"] }, reverse_dag: { "CSE 3724": ["CSE 4153"] },
};

before(() => setCourseCorpus(CORPUS));

describe("get_msu_course", () => {
  test("returns found:true for an existing course", async () => {
    const res = await get_msu_course.handler({ code: "CSE 4153" });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.found, true);
    assert.equal(parsed.course.code, "CSE 4153");
    assert.deepEqual(parsed.course.prereqs.required_courses, ["CSE 3724"]);
  });

  test("normalizes case + whitespace", async () => {
    const res = await get_msu_course.handler({ code: "cse  4153" });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.found, true);
  });

  test("returns found:false with suggestions for an unknown course", async () => {
    const res = await get_msu_course.handler({ code: "ZZ 9999" });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.found, false);
    assert.ok(Array.isArray(parsed.suggestions));
  });

  test("rejects malformed codes", async () => {
    await assert.rejects(get_msu_course.handler({ code: "not a code" }));
  });
});

describe("get_msu_course — v0.9.0 response shape", () => {
  test("response includes prereq_summary when course has prereqs", async () => {
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
    assert.equal(parsed.course.prereq_summary, "CSE 3183 (C or better)");
    assert.deepEqual(parsed.course.prereqs.parse_warnings, []);
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
    assert.equal(parsed.course.prereq_summary, null);
  });
  test("response includes parse_warnings array when present", async () => {
    setCourseCorpus({
      version: "test",
      scraped_at: "x",
      records: {
        "XX 1001": {
          code: "XX 1001",
          title: "x",
          hours: 3,
          level: "undergraduate",
          description: "",
          semester_offered: null,
          prereqs: {
            required_courses: ["XX 1000"],
            logic: "mixed",
            min_grade: null,
            non_course: [],
            raw_prose: "(Prerequisites: XX 1000 and (YY 1000 or ZZ 1000))",
            parse_warnings: ["logic_ambiguous"],
          },
          coreqs: null,
          cross_listed: [],
          source_url: "x",
          prereq_summary: "(prereqs published but not machine-parsed in full — see raw_prose)",
        },
      },
      forward_dag: {},
      reverse_dag: {},
    });
    const res = await get_msu_course.handler({ code: "XX 1001" });
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    assert.deepEqual(parsed.course.prereqs.parse_warnings, ["logic_ambiguous"]);
    assert.equal(parsed.course.prereq_summary, "(prereqs published but not machine-parsed in full — see raw_prose)");
  });
});
