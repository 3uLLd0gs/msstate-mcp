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
