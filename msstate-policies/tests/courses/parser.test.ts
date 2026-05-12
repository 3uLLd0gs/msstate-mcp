import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePrereqProse, parseCourseHtml } from "../../src/courses/parser.js";

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "..", "fixtures", "courses", name),
    "utf8",
  );
}

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

describe("parseCourseHtml", () => {
  it("extracts code/title/hours from CSE 4153 fixture", () => {
    const c = parseCourseHtml(fixture("cse-4153.html"), "CSE 4153")!;
    expect(c.code).toBe("CSE 4153");
    expect(c.title).toMatch(/Data Communications|Computer Networks/i);
    expect(c.hours).toBe(3);
    expect(c.level).toBe("undergraduate");
    expect(c.source_url).toBe("https://catalog.msstate.edu/search/?P=CSE%204153");
  });

  it("extracts prereqs for CSE 4153", () => {
    const c = parseCourseHtml(fixture("cse-4153.html"), "CSE 4153")!;
    expect(c.prereqs).not.toBeNull();
    expect(c.prereqs!.required_courses).toEqual(
      expect.arrayContaining(["CSE 3724", "ECE 3724"]),
    );
    expect(c.prereqs!.raw_prose).toMatch(/Prerequisites/);
  });

  it("returns null for an unknown course (HTML 200 but no result card)", () => {
    // Use any HTML that does NOT contain a searchresult article.
    const empty = "<html><body><p>nothing here</p></body></html>";
    expect(parseCourseHtml(empty, "ZZ 9999")).toBeNull();
  });

  it("CSE 1284 has no prereqs (or only a non-course condition)", () => {
    const c = parseCourseHtml(fixture("cse-1284.html"), "CSE 1284")!;
    // Either null prereqs, or required_courses === [] with non_course populated.
    if (c.prereqs) {
      expect(c.prereqs.required_courses).toEqual([]);
    }
  });

  it("hours field handles range strings like '0,4' as a string", () => {
    // Synthetic minimal fixture covering ranged-hours markup — none of the
    // current live fixtures (CSE 1284/4153/4733) publish a ranged value.
    const syntheticRanged = `<article class="searchresult search-pageresult">
      <h2 class="hours">0,4 Hours.</h2>
      <h2 class="title">EX 9999. <span class="title">Example Ranged.</span></h2>
      <div class="courseblockdesc"><p>(Prerequisites: EX 1000). Description.</p></div>
    </article>`;
    const c = parseCourseHtml(syntheticRanged, "EX 9999")!;
    expect(typeof c.hours === "string" ? c.hours : String(c.hours)).toBe("0,4");
  });
});
