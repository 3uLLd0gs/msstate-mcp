import { test } from "node:test";
import assert from "node:assert/strict";
import { indexCalendarRows, searchCalendarRows } from "../src/calendars/search.js";
import { contentHash } from "../src/calendars/hash.js";
import type { CalendarRow } from "../src/calendars/types.js";

function row(event: string, term: string, synonyms?: string[]): CalendarRow {
  const r: CalendarRow = {
    source: "academic_calendar",
    event,
    start: "2026-01-01",
    end: "2026-01-01",
    term,
    source_url: "https://www.registrar.msstate.edu/calendars/academic-calendar/2026/spring",
    retrieved_at: "2026-05-12T00:00:00Z",
    citation: `[${event}, ${term}](https://example.msstate.edu)`,
  };
  if (synonyms) r.synonyms = synonyms;
  r.contentHash = contentHash(r);
  return r;
}

test("BM25 with synonyms ranks paraphrase-matching row above non-matches", () => {
  const rows = [
    row("Classes begin", "Spring 2026", ["semester starts", "first day of class", "school begins", "term begins", "instruction begins"]),
    row("Spring Break", "Spring 2026", ["spring vacation", "spring recess", "march break", "mid-term break", "school holiday"]),
    row("Final Examinations", "Spring 2026", ["final exams", "end-of-term tests", "finals week", "exam week", "term tests"]),
  ];
  indexCalendarRows(rows);
  const hits = searchCalendarRows("when does the semester start", 5);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].row.event, "Classes begin", "row with 'semester starts' synonym should rank first");
});

test("BM25 without synonyms (legacy behavior) still works", () => {
  const rows = [
    row("Classes begin", "Spring 2026"),
    row("Spring Break", "Spring 2026"),
  ];
  indexCalendarRows(rows);
  const hits = searchCalendarRows("spring break", 5);
  assert.equal(hits[0].row.event, "Spring Break");
});

test("synonyms field weight is lower than event field", () => {
  const rows = [
    row("Commencement", "Spring 2026"),
    row("Spring Break", "Spring 2026", ["commencement", "graduation", "ceremony", "diploma", "convocation"]),
  ];
  indexCalendarRows(rows);
  const hits = searchCalendarRows("commencement", 5);
  assert.equal(hits[0].row.event, "Commencement", "event field weight should dominate synonyms");
});
