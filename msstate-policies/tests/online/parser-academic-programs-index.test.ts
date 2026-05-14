import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAcademicProgramsIndex } from "../../src/online/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, "..", "fixtures", "online", "academic-programs.html"),
  "utf8",
);
const PAGE_URL = "https://www.online.msstate.edu/academic-programs";

describe("parseAcademicProgramsIndex", () => {
  test("extracts at least 100 program slugs (we expect ~126)", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    assert.ok(entries.length >= 100, `got ${entries.length}`);
  });
  test("each entry has slug, name, degree_level", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    for (const e of entries) {
      assert.ok(e.slug.length > 0);
      assert.ok(e.name.length > 0);
      assert.ok(["bachelor", "master", "specialist", "doctoral", "certificate", "endorsement"].includes(e.degree_level));
    }
  });
  test("slugs are URL-safe (no spaces, no leading slash)", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    for (const e of entries) {
      assert.ok(!e.slug.includes("/"));
      assert.ok(!e.slug.includes(" "));
    }
  });
  test("includes the MBA at master level", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    const mba = entries.find((e) => e.slug === "mba");
    assert.ok(mba, "no mba entry");
    assert.equal(mba.degree_level, "master");
    assert.match(mba.name, /business administration/i);
  });
  test("includes at least one doctoral program", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    assert.ok(entries.some((e) => e.degree_level === "doctoral"));
  });
  test("extracts short_description from Prg-card-description for most entries (v1.0.1)", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    const withDesc = entries.filter((e) => e.short_description.length >= 20).length;
    assert.ok(withDesc / entries.length > 0.7, `only ${withDesc}/${entries.length} entries have a description`);
  });
  test("MBA short_description contains substantive marketing text (v1.0.1)", () => {
    const entries = parseAcademicProgramsIndex(FIXTURE, PAGE_URL);
    const mba = entries.find((e) => e.slug === "mba");
    assert.ok(mba);
    assert.ok(mba.short_description.length >= 20, `short_description: ${JSON.stringify(mba.short_description)}`);
  });
  test("returns [] on input with no program list", () => {
    const empty = parseAcademicProgramsIndex(
      "<html><body><p>nothing here</p></body></html>",
      PAGE_URL,
    );
    assert.deepEqual(empty, []);
  });
});
