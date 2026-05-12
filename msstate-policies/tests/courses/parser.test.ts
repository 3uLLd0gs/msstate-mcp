import { describe, it, expect } from "vitest";
import { parsePrereqProse } from "../../src/courses/parser.js";

describe("parsePrereqProse — Pass 1 (lossless course codes)", () => {
  it("returns null for empty input", () => {
    expect(parsePrereqProse("")).toBeNull();
    expect(parsePrereqProse(null as unknown as string)).toBeNull();
  });

  it("extracts a single course code", () => {
    const r = parsePrereqProse("(Prerequisites: CSE 3724)")!;
    expect(r.required_courses).toEqual(["CSE 3724"]);
    expect(r.raw_prose).toBe("(Prerequisites: CSE 3724)");
  });

  it("extracts two OR'd codes (with grade)", () => {
    const r = parsePrereqProse(
      "(Prerequisites: Grade of C or better in CSE 3724 or ECE 3724)",
    )!;
    expect(r.required_courses).toEqual(["CSE 3724", "ECE 3724"]);
    expect(r.logic).toBe("or");
    expect(r.min_grade).toBe("C");
  });

  it("extracts AND'd codes", () => {
    const r = parsePrereqProse("(Prerequisites: CSE 1284 and MA 1713)")!;
    expect(r.required_courses).toEqual(["CSE 1284", "MA 1713"]);
    expect(r.logic).toBe("and");
  });

  it("flags mixed logic when both AND and OR present", () => {
    const r = parsePrereqProse(
      "(Prerequisites: CSE 1284 and (MA 1713 or MA 1723))",
    )!;
    expect(r.required_courses).toEqual(["CSE 1284", "MA 1713", "MA 1723"]);
    expect(r.logic).toBe("mixed");
  });

  it("captures non-course conditions", () => {
    const r = parsePrereqProse(
      "(Prerequisites: junior standing or consent of instructor)",
    )!;
    expect(r.required_courses).toEqual([]);
    expect(r.non_course).toEqual(
      expect.arrayContaining(["junior standing", "consent of instructor"]),
    );
  });

  it("handles 4-letter dept codes (e.g., MGMT)", () => {
    const r = parsePrereqProse("(Prerequisites: MGMT 3823)")!;
    expect(r.required_courses).toEqual(["MGMT 3823"]);
  });

  it("ignores course-like patterns outside the prereq paren", () => {
    // Course descriptions sometimes mention other courses outside the prereq
    // sentence; the parser must only operate inside the parenthesized clause.
    const onlyDescription = "Three hours lecture. Covers ENG 1103 themes.";
    expect(parsePrereqProse(onlyDescription)).toBeNull();
  });

  it("preserves raw_prose verbatim including punctuation", () => {
    const input =
      "(Prerequisites: Grade of B or better in MA 1713; junior standing)";
    const r = parsePrereqProse(input)!;
    expect(r.raw_prose).toBe(input);
    expect(r.min_grade).toBe("B");
  });

  it("returns null when no parenthesized prereq clause is present", () => {
    expect(parsePrereqProse("Three hours lecture.")).toBeNull();
  });

  it("recognizes coreq clause as a separate parse target", () => {
    // The coreq parser is exported separately; this test guards that the
    // prereq parser does NOT pick up coreq paren content.
    expect(
      parsePrereqProse("(Corequisites: CSE 1284). Three hours."),
    ).toBeNull();
  });
});
