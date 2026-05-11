import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDateTable } from "../src/calendars/parsers/date_table.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "fixtures", "calendars", name), "utf8");
}

test("parseDateTable: university_holidays returns >= 5 rows with ISO dates", () => {
  const rows = parseDateTable(
    fixture("hrm_holidays.html"),
    "university_holidays",
  );
  assert.ok(rows.length >= 5, `expected >= 5 holiday rows; got ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.source, "university_holidays");
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/, `start not ISO: ${r.start}`);
    assert.match(r.end, /^\d{4}-\d{2}-\d{2}$/, `end not ISO: ${r.end}`);
    assert.ok(r.event.length > 0, "event must be non-empty");
    assert.equal(r.source_url, "https://www.hrm.msstate.edu/benefits/holidays/");
  }
});

test("parseDateTable: at least one row mentions a recognizable holiday", () => {
  const rows = parseDateTable(
    fixture("hrm_holidays.html"),
    "university_holidays",
  );
  const text = rows.map((r) => r.event.toLowerCase()).join(" | ");
  const recognizable = ["christmas", "thanksgiving", "independence", "memorial", "labor"];
  const found = recognizable.some((h) => text.includes(h));
  assert.ok(found, `none of ${recognizable.join(",")} appeared in ${text}`);
});

test("parseDateTable: university_holidays correctly parses multi-day Christmas/Winter holiday range", () => {
  const rows = parseDateTable(
    fixture("hrm_holidays.html"),
    "university_holidays",
  );
  // The MSU fixture contains at least one multi-day Christmas/New Year/Winter block.
  // It must parse as a date range (start !== end) — earlier versions of the regex
  // misparsed "December 23, YYYY, through January D, YYYY+1" as a single-day event.
  const winterBlock = rows.find(
    (r) => /christmas|winter|new\s*year/i.test(r.event) && r.start !== r.end,
  );
  assert.ok(
    winterBlock,
    "expected a multi-day Christmas/Winter/New Year holiday block with start !== end",
  );
  // Sanity: end must be chronologically >= start.
  if (winterBlock) {
    assert.ok(
      winterBlock.start <= winterBlock.end,
      `range out of order: ${winterBlock.start}..${winterBlock.end}`,
    );
  }
});

test("parseDateTable: academic_calendar returns rows for multiple terms", () => {
  const rows = parseDateTable(
    fixture("registrar_academic.html"),
    "academic_calendar",
  );
  assert.ok(rows.length >= 10, `expected >= 10 academic rows; got ${rows.length}`);
  const terms = new Set(rows.map((r) => r.term).filter(Boolean));
  assert.ok(terms.size >= 2, `expected multiple terms; got ${[...terms]}`);
  for (const r of rows) {
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("parseDateTable: academic_calendar surfaces a recognizable break", () => {
  const rows = parseDateTable(fixture("registrar_academic.html"), "academic_calendar");
  const text = rows.map((r) => r.event.toLowerCase()).join(" | ");
  const found = ["spring break", "thanksgiving", "fall break", "winter break"].some((b) =>
    text.includes(b),
  );
  assert.ok(found, "expected at least one recognizable break in academic calendar");
});

test("parseDateTable: exam_schedule has finals-week dates", () => {
  const rows = parseDateTable(fixture("registrar_exams.html"), "exam_schedule");
  assert.ok(rows.length > 0, "expected non-empty exam schedule");
  for (const r of rows) assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
});

test("parseDateTable: grad_school_calendar produces dated rows", () => {
  const rows = parseDateTable(fixture("grad_school.html"), "grad_school_calendar");
  assert.ok(rows.length > 0, "expected non-empty grad school calendar");
  for (const r of rows) {
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.source, "grad_school_calendar");
  }
});
