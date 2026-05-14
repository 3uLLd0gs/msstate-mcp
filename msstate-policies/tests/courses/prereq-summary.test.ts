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
