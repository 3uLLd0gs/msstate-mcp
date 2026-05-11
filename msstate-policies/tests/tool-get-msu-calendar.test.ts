import { test } from "node:test";
import assert from "node:assert/strict";
import {
  get_msu_calendar,
  indexCalendarRowsForGetter,
} from "../src/tools/get_msu_calendar.js";
import type { CalendarRow } from "../src/calendars/types.js";

const SAMPLE: CalendarRow[] = [
  {
    source: "academic_calendar",
    event: "Fall 2026 Classes Begin",
    start: "2026-08-19",
    end: "2026-08-19",
    term: "Fall 2026",
    source_url: "https://www.registrar.msstate.edu/calendars/academic-calendar",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
  {
    source: "academic_calendar",
    event: "Spring 2026 Classes End",
    start: "2026-05-01",
    end: "2026-05-01",
    term: "Spring 2026",
    source_url: "https://www.registrar.msstate.edu/calendars/academic-calendar",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
  {
    source: "housing",
    event: "Move-In",
    start: "2026-08-17",
    end: "2026-08-17",
    source_url: "https://www.housing.msstate.edu/events/",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
];

test("get_msu_calendar returns rows for a single source", async () => {
  indexCalendarRowsForGetter(SAMPLE);
  const res = await get_msu_calendar.handler({ source: "housing" });
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].source, "housing");
});

test("get_msu_calendar filters by term substring (case-insensitive)", async () => {
  indexCalendarRowsForGetter(SAMPLE);
  const res = await get_msu_calendar.handler({ source: "academic_calendar", term: "fall 2026" });
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].term, "Fall 2026");
});

test("get_msu_calendar with no term returns all rows for the source", async () => {
  indexCalendarRowsForGetter(SAMPLE);
  const res = await get_msu_calendar.handler({ source: "academic_calendar" });
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.rows.length, 2);
});

test("get_msu_calendar rejects unknown source via zod", async () => {
  await assert.rejects(() => get_msu_calendar.handler({ source: "athletics" }));
});
