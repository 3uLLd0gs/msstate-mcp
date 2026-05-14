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
        "AA 1001": {
          code: "AA 1001",
          title: "x",
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
        "AA 1002": {
          code: "AA 1002",
          title: "x",
          hours: 3,
          level: "undergraduate",
          description: "",
          semester_offered: null,
          prereqs: {
            required_courses: ["AA 1001"],
            logic: "and",
            min_grade: "C",
            non_course: [],
            raw_prose: "(Prerequisites: C or better in AA 1001)",
            parse_warnings: [],
          },
          coreqs: null,
          cross_listed: [],
          source_url: "x",
          prereq_summary: "AA 1001 (C or better)",
        },
        "AA 1003": {
          code: "AA 1003",
          title: "x",
          hours: 3,
          level: "undergraduate",
          description: "",
          semester_offered: null,
          prereqs: {
            required_courses: [],
            logic: null,
            min_grade: null,
            non_course: [],
            raw_prose: "(Prerequisites: a vibe check)",
            parse_warnings: ["non_course_unparsed"],
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
    const res = await health_check.handler({});
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    assert.ok(parsed.courses_parse_quality, "courses_parse_quality block missing from response");
    assert.equal(parsed.courses_parse_quality.total_records, 3);
    assert.equal(parsed.courses_parse_quality.with_prose, 2);
    assert.equal(parsed.courses_parse_quality.fully_parsed, 1);
    assert.equal(parsed.courses_parse_quality.with_warnings, 1);
    assert.equal(parsed.courses_parse_quality.warning_breakdown.non_course_unparsed, 1);
  });
});
