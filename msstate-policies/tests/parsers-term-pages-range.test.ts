import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTermPage } from "../src/calendars/parsers/term_pages.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, "fixtures", "calendars", name), "utf8");

test("parseTermPage: academic_calendar Spring 2026 Spring Break has end=2026-03-13", () => {
  const rows = parseTermPage(
    fixture("registrar_academic_2026_spring.html"),
    "academic_calendar",
    {
      url: "https://www.registrar.msstate.edu/calendars/academic-calendar/2026/spring",
      year: 2026,
      term: "Spring",
    },
  );
  const springBreak = rows.find((r) => /spring break/i.test(r.event));
  assert.ok(springBreak, "expected a Spring Break row");
  assert.equal(springBreak!.start, "2026-03-09");
  assert.equal(springBreak!.end, "2026-03-13");
});

test("parseTermPage: academic_calendar single-day events still have start == end", () => {
  const rows = parseTermPage(
    fixture("registrar_academic_2026_spring.html"),
    "academic_calendar",
    {
      url: "https://www.registrar.msstate.edu/calendars/academic-calendar/2026/spring",
      year: 2026,
      term: "Spring",
    },
  );
  const singleDay = rows.filter((r) => r.start === r.end);
  assert.ok(
    singleDay.length >= 3,
    `expected >= 3 genuine single-day rows in Spring 2026; got ${singleDay.length}`,
  );
  for (const r of singleDay) {
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.start, r.end);
  }
});

test("parseTermPage: academic_calendar handles cross-month ranges", () => {
  const rows = parseTermPage(
    fixture("registrar_academic_2026_spring.html"),
    "academic_calendar",
    {
      url: "https://www.registrar.msstate.edu/calendars/academic-calendar/2026/spring",
      year: 2026,
      term: "Spring",
    },
  );
  const gradApp = rows.find(
    (r) => /apply.*graduation|graduation.*apply|early bird/i.test(r.event) && r.start === "2026-01-28",
  );
  assert.ok(gradApp, "expected a Jan-28-start graduation-application window");
  assert.equal(gradApp!.end, "2026-03-27");
});
