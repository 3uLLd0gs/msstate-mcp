# MSU Calendars (academic dates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools (`find_msu_date`, `get_msu_calendar`) to the existing `msstate-policies` server that answer date-anchored questions across six MSU subdomains. Tool count grows 5 → 7.

**Architecture:** Parsers per source under `msstate-policies/src/calendars/` (three shapes: single-page date table, term-index + sub-pages, paginated Drupal event list). Worker reads from a pre-built `academic_calendar` block in `worker/corpus.json`; local install live-fetches. Same security posture as policies (WAF abort, no err.message echo, hardcoded URLs, query-length cap).

**Tech Stack:** TypeScript (strict), `cheerio` for HTML parsing (already a dep), `node:test` + `tsx` for tests, `esbuild` for bundling, Cloudflare Workers runtime. Spec at `.dev/specs/2026-05-11-msu-calendars-design.md`.

---

## Foundational notes for the implementer

You have **zero prior context** for this codebase. Before starting Task 1, read these files in this order:

1. `CLAUDE.md` (repo root) — load-bearing rules: stderr-only logging, security score contract, CORPUS RULE.
2. `.dev/specs/2026-05-11-msu-calendars-design.md` — the spec this plan implements.
3. `msstate-policies/src/tools/search_policies.ts` and `msstate-policies/src/tools/health_check.ts` — the tool-file shape you'll mirror. Every tool exports `{ name, description, inputSchema, zodSchema, handler }`.
4. `msstate-policies/src/scraper.ts` lines 1-50 — to see how the policy scraper handles errors + caching. **Do not edit** this file; calendars get parallel files.
5. `worker/src/index.ts` lines 1-50 + 170-250 + 280-370 — the Worker is a standalone module that duplicates tool definitions and handlers (does NOT import from the policy bundle). Calendar tools land in both places.

**Key conventions:**
- All runtime logging via `import { log } from "./log.js"`. **Never** `console.log` — stdout is reserved for MCP JSON-RPC framing.
- Imports inside `src/` use `.js` extensions even for `.ts` source files (TypeScript ESM convention).
- Tests run via `npm test` from `msstate-policies/`; pattern is `tests/*.test.ts`.
- All ISO dates: `YYYY-MM-DD` (no time, no zone). Times stay as raw strings.
- Worker code cannot use `node:fs` or any Node API beyond what's in the CF Workers runtime.

**Branch:** Work happens on `claude/msu-calendars` (already checked out; the spec lives on this branch).

---

## File structure

### New files

```
msstate-policies/src/calendars/
├── types.ts                      # CalendarSource enum, CalendarRow interface
├── parsers/
│   ├── date_table.ts             # Shape A (4 sources)
│   ├── term_index.ts             # Shape B (SFA)
│   └── event_list.ts             # Shape C (housing)
├── scraper.ts                    # Fetch + WAF detection + dispatch to parsers
├── corpus.ts                     # Worker-snapshot reader; local live-fetch
└── search.ts                     # BM25 over event + description
msstate-policies/src/tools/
├── find_msu_date.ts              # Chain tool
└── get_msu_calendar.ts           # Raw getter
msstate-policies/tests/fixtures/calendars/
├── registrar_academic.html
├── registrar_exams.html
├── hrm_holidays.html
├── grad_school.html
├── sfa_index.html
├── sfa_term_2026_fall.html
└── housing_events.html
msstate-policies/tests/
├── parsers-date-table.test.ts
├── parsers-term-index.test.ts
├── parsers-event-list.test.ts
├── calendar-search.test.ts
├── tool-find-msu-date.test.ts
└── tool-get-msu-calendar.test.ts
msstate-policies/eval/
└── eval-calendars-2026-05-11.json
scripts/
└── _scrape-calendars.mjs         # subprocess called by build-worker-corpus.mjs
```

### Modified files

- `msstate-policies/src/index.ts` — register the 2 new tools.
- `msstate-policies/src/tools/health_check.ts` — add calendar fields.
- `scripts/build-worker-corpus.mjs` — scrape + write `academic_calendar` block.
- `worker/src/index.ts` — add tool definitions + handlers + BM25 over calendar rows.
- `tools/security-checklist.sh` — new checks for calendar invariants.
- `CLAUDE.md` — CORPUS RULE addendum.
- `docs/BUILD.md` — calendar architecture subsection.
- `README.md` — overview note + example questions + tool count 5→7.

---

## Task 1: Add calendar types

**Files:**
- Create: `msstate-policies/src/calendars/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * Shared types for MSU calendar tools.
 *
 * Field names are stable: tool output schemas and the eval harness reference
 * them. Renaming anything here is a breaking change.
 */

export type CalendarSource =
  | "academic_calendar"
  | "exam_schedule"
  | "university_holidays"
  | "grad_school_calendar"
  | "sfa_financial_aid"
  | "housing";

export const CALENDAR_SOURCES: readonly CalendarSource[] = [
  "academic_calendar",
  "exam_schedule",
  "university_holidays",
  "grad_school_calendar",
  "sfa_financial_aid",
  "housing",
] as const;

/** Canonical landing URL for each source — used as `source_url` on every row. */
export const CALENDAR_URLS: Record<CalendarSource, string> = {
  academic_calendar: "https://www.registrar.msstate.edu/calendars/academic-calendar",
  exam_schedule: "https://www.registrar.msstate.edu/students/schedules/exam-schedule",
  university_holidays: "https://www.hrm.msstate.edu/benefits/holidays/",
  grad_school_calendar: "https://www.grad.msstate.edu/students/graduate-school-calendar",
  sfa_financial_aid: "https://www.sfa.msstate.edu/calendars/",
  housing: "https://www.housing.msstate.edu/events/",
};

export interface CalendarRow {
  source: CalendarSource;
  /** Event/deadline name, e.g. "Spring Break", "Halls Close for Spring 2026". */
  event: string;
  /** ISO date, YYYY-MM-DD. */
  start: string;
  /** ISO date; equals `start` for single-day events. */
  end: string;
  /** Raw time string from source, e.g. "12:00 PM CST". Optional. */
  time?: string;
  /** Normalized, e.g. "Spring 2026". Omitted when not applicable (e.g. holidays). */
  term?: string;
  /** Free text from source, truncated to 500 chars. Optional. */
  description?: string;
  /** Canonical msstate.edu URL the row came from. */
  source_url: string;
  /** ISO-8601 UTC timestamp when the row was extracted. */
  retrieved_at: string;
}

/** Result of scraping a single source. */
export interface ScrapeResult {
  source: CalendarSource;
  rows: CalendarRow[];
  /** Set when scrape failed and rows is empty. Logged into health_check. */
  error: string | null;
}

export class CalendarWafError extends Error {
  constructor(public readonly source: CalendarSource, public readonly url: string) {
    super(`WAF challenge detected for ${source} at ${url}`);
    this.name = "CalendarWafError";
  }
}
```

- [ ] **Step 2: Typecheck passes**

Run: `cd msstate-policies && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/calendars/types.ts
git commit -m "feat(calendars): add CalendarSource + CalendarRow types"
```

---

## Task 2: Capture fixture HTML for university_holidays + write Shape A parser (RED → GREEN)

This task establishes the parser pattern. Subsequent Shape A sources reuse it.

**Files:**
- Create: `msstate-policies/tests/fixtures/calendars/hrm_holidays.html`
- Create: `msstate-policies/src/calendars/parsers/date_table.ts`
- Create: `msstate-policies/tests/parsers-date-table.test.ts`

- [ ] **Step 1: Capture the fixture from the live page**

Run (from repo root):
```bash
curl -sL \
  -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.hrm.msstate.edu/benefits/holidays/" \
  -o msstate-policies/tests/fixtures/calendars/hrm_holidays.html
```

Verify the file exists and is non-trivial:
```bash
wc -c msstate-policies/tests/fixtures/calendars/hrm_holidays.html
```
Expected: a number > 20000 (page is ~30-40 KB).

**If the file is < 5 KB or contains "Just a moment..."**, you hit a WAF challenge — stop and rerun later; do NOT commit a poisoned fixture.

- [ ] **Step 2: Inspect the fixture to identify date-row selectors**

```bash
grep -oE '<(tr|li|p|dt|dd)[^>]*>.{0,300}' \
  msstate-policies/tests/fixtures/calendars/hrm_holidays.html \
  | grep -iE 'january|february|march|april|may|june|july|august|september|october|november|december' \
  | head -20
```
This reveals the row structure (table row vs list item vs paragraph vs definition list). Note the wrapping tag and class names; you'll feed these into the parser's cheerio selectors.

- [ ] **Step 3: Write the failing parser test**

Create `msstate-policies/tests/parsers-date-table.test.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/parsers-date-table.test.ts`
Expected: FAIL with "Cannot find module './src/calendars/parsers/date_table.js'" or "parseDateTable is not a function".

- [ ] **Step 5: Implement `date_table.ts`**

Create `msstate-policies/src/calendars/parsers/date_table.ts`:

```typescript
/**
 * Shape A parser: single-page date table.
 *
 * Used for: university_holidays, academic_calendar, exam_schedule,
 * grad_school_calendar. Each source has its own selector + row-normalization
 * function below; the public parseDateTable dispatches by source id.
 *
 * Page structure varies per source. Inspect each fixture (see tests/fixtures/
 * calendars/) before adjusting selectors.
 */
import { load as cheerioLoad } from "cheerio";
import { CALENDAR_URLS, type CalendarRow, type CalendarSource } from "../types.js";

export type DateTableSourceId = Extract<
  CalendarSource,
  "academic_calendar" | "exam_schedule" | "university_holidays" | "grad_school_calendar"
>;

interface RawRow {
  event: string;
  rawDate: string;
  time?: string;
  term?: string;
  description?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Parse a date or date range from MSU page text.
 * Returns [startIso, endIso] in YYYY-MM-DD form, or null if unparseable.
 *
 * Handles these formats (observed across MSU sites):
 *   "January 20, 2026"
 *   "January 20-24, 2026"
 *   "December 22, 2025 - January 2, 2026"
 *   "Nov 25-29, 2025"
 *   "Tuesday, November 25, 2025"
 */
export function parseDateRange(
  raw: string,
  fallbackYear?: number,
): [string, string] | null {
  const clean = raw.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

  // Two-month range: "Month D, YYYY - Month D, YYYY"
  const twoMonth = clean.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?\s*-\s*([A-Za-z]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?/,
  );
  if (twoMonth) {
    const m1 = MONTHS[twoMonth[1].toLowerCase()];
    const m2 = MONTHS[twoMonth[4].toLowerCase()];
    const d1 = Number(twoMonth[2]);
    const d2 = Number(twoMonth[5]);
    const y1 = twoMonth[3] ? Number(twoMonth[3]) : (twoMonth[6] ? Number(twoMonth[6]) : fallbackYear);
    const y2 = twoMonth[6] ? Number(twoMonth[6]) : (y1 ?? fallbackYear);
    if (m1 && m2 && y1 && y2) return [iso(y1, m1, d1), iso(y2, m2, d2)];
  }

  // Single-month range: "Month D-D, YYYY"
  const oneMonthRange = clean.match(/([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})(?:,)?\s*(\d{4})?/);
  if (oneMonthRange) {
    const m = MONTHS[oneMonthRange[1].toLowerCase()];
    const d1 = Number(oneMonthRange[2]);
    const d2 = Number(oneMonthRange[3]);
    const y = oneMonthRange[4] ? Number(oneMonthRange[4]) : fallbackYear;
    if (m && y) return [iso(y, m, d1), iso(y, m, d2)];
  }

  // Single date: "Month D, YYYY" or "DayOfWeek, Month D, YYYY"
  const single = clean.match(/([A-Za-z]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?/);
  if (single) {
    const m = MONTHS[single[1].toLowerCase()];
    const d = Number(single[2]);
    const y = single[3] ? Number(single[3]) : fallbackYear;
    if (m && y) {
      const v = iso(y, m, d);
      return [v, v];
    }
  }
  return null;
}

function iso(y: number, m: number, d: number): string {
  return `${y}`.padStart(4, "0") + "-" + `${m}`.padStart(2, "0") + "-" + `${d}`.padStart(2, "0");
}

// ---- Per-source extractors -------------------------------------------------

function extractUniversityHolidays(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  $("table tr, ul li, ol li, dl > dt").each((_i, el) => {
    const tag = el.tagName?.toLowerCase();
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt) return;
    if (!/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(txt) && tag !== "dt") {
      return;
    }
    if (tag === "tr") {
      const cells = $(el).find("td").map((_j, td) => $(td).text().trim()).get();
      if (cells.length >= 2) {
        out.push({ event: cells[0], rawDate: cells.slice(1).join(" ") });
        return;
      }
    }
    if (tag === "dt") {
      const dd = $(el).next("dd");
      if (dd.length) {
        out.push({ event: txt, rawDate: dd.text().trim() });
        return;
      }
    }
    const m = txt.match(/^(.+?)[\s\-–—:]+([A-Z][a-z]+\s+\d.*\d{4}.*)$/);
    if (m) out.push({ event: m[1].trim(), rawDate: m[2].trim() });
  });
  return out;
}

function extractGenericRegistrarTable(_html: string): RawRow[] {
  // Placeholder — real extractors land in Task 3 when the 3 remaining
  // fixtures are captured.
  return [];
}

const EXTRACTORS: Record<DateTableSourceId, (html: string) => RawRow[]> = {
  university_holidays: extractUniversityHolidays,
  academic_calendar: extractGenericRegistrarTable,
  exam_schedule: extractGenericRegistrarTable,
  grad_school_calendar: extractGenericRegistrarTable,
};

// ---- Public entry ----------------------------------------------------------

export function parseDateTable(html: string, source: DateTableSourceId): CalendarRow[] {
  const extractor = EXTRACTORS[source];
  const raw = extractor(html);
  const retrievedAt = new Date().toISOString();
  // Infer a fallback year from the first 4-digit year on the page (per-page,
  // not training-data). MSU pages typically lead with "2025-2026 University Holidays".
  const yearGuess = (() => {
    const $ = cheerioLoad(html);
    const text = $("main, body").text();
    const m = text.match(/\b(20\d{2})\b/);
    return m ? Number(m[1]) : undefined;
  })();
  const rows: CalendarRow[] = [];
  for (const r of raw) {
    const range = parseDateRange(r.rawDate, yearGuess);
    if (!range) continue;
    rows.push({
      source,
      event: r.event.slice(0, 200),
      start: range[0],
      end: range[1],
      time: r.time,
      term: r.term,
      description: r.description?.slice(0, 500),
      source_url: CALENDAR_URLS[source],
      retrieved_at: retrievedAt,
    });
  }
  return rows;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd msstate-policies && npx tsx --test tests/parsers-date-table.test.ts`
Expected: PASS. If a test fails, inspect the fixture's actual structure and adjust the `extractUniversityHolidays` selectors. Do NOT relax the test assertions; a real holiday is missing only if the parser is wrong.

- [ ] **Step 7: Commit**

```bash
git add msstate-policies/tests/fixtures/calendars/hrm_holidays.html \
        msstate-policies/src/calendars/parsers/date_table.ts \
        msstate-policies/tests/parsers-date-table.test.ts
git commit -m "feat(calendars): parser scaffolding + Shape A holidays parser"
```

---

## Task 3: Add the 3 remaining Shape A parsers (academic_calendar, exam_schedule, grad_school_calendar)

**Files:**
- Create: `msstate-policies/tests/fixtures/calendars/registrar_academic.html`
- Create: `msstate-policies/tests/fixtures/calendars/registrar_exams.html`
- Create: `msstate-policies/tests/fixtures/calendars/grad_school.html`
- Modify: `msstate-policies/src/calendars/parsers/date_table.ts` (add 3 extractors, replace placeholder)
- Modify: `msstate-policies/tests/parsers-date-table.test.ts` (extend tests)

- [ ] **Step 1: Capture all three fixtures**

```bash
curl -sL -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.registrar.msstate.edu/calendars/academic-calendar" \
  -o msstate-policies/tests/fixtures/calendars/registrar_academic.html
curl -sL -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.registrar.msstate.edu/students/schedules/exam-schedule" \
  -o msstate-policies/tests/fixtures/calendars/registrar_exams.html
curl -sL -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.grad.msstate.edu/students/graduate-school-calendar" \
  -o msstate-policies/tests/fixtures/calendars/grad_school.html
```

Verify each is > 10 KB and does not contain `Just a moment...`:
```bash
for f in msstate-policies/tests/fixtures/calendars/registrar_academic.html \
         msstate-policies/tests/fixtures/calendars/registrar_exams.html \
         msstate-policies/tests/fixtures/calendars/grad_school.html; do
  wc -c "$f"
  grep -q "Just a moment" "$f" && echo "WAF: $f" || true
done
```

- [ ] **Step 2: Inspect each fixture to identify selectors**

For each fixture, run:
```bash
F=msstate-policies/tests/fixtures/calendars/registrar_academic.html
python3 -c "
import re
with open('$F') as f: raw = f.read()
m = re.search(r'id=[\"\\']main-content[^\"\\']*[\"\\']', raw)
body = raw[m.start():m.start()+12000] if m else raw
print(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body))[:2500])
"
```
Repeat for `registrar_exams.html` and `grad_school.html`. Identify the row wrapper (table row, definition-list, paragraph, repeating div) and any term-header element.

- [ ] **Step 3: Append the failing tests for the 3 new sources**

Append to `msstate-policies/tests/parsers-date-table.test.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd msstate-policies && npx tsx --test tests/parsers-date-table.test.ts`
Expected: the 4 new tests FAIL (placeholder returns empty array).

- [ ] **Step 5: Implement the 3 extractors**

In `msstate-policies/src/calendars/parsers/date_table.ts`, **replace** the placeholder `extractGenericRegistrarTable` with 3 real extractors and update the `EXTRACTORS` map:

```typescript
function extractAcademicCalendar(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  let currentTerm: string | undefined;
  $("h1, h2, h3, h4, table tr, dl > dt").each((_i, el) => {
    const tag = el.tagName?.toLowerCase() ?? "";
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt) return;
    if (/^h[1-4]$/.test(tag)) {
      const t = txt.match(/(Spring|Fall|Summer|Winter|Maymester)\s+\d{4}/i);
      if (t) currentTerm = t[0].replace(/\s+/g, " ");
      return;
    }
    if (tag === "tr") {
      const cells = $(el).find("td, th").map((_j, td) => $(td).text().trim()).get();
      if (cells.length >= 2) {
        out.push({ event: cells[0], rawDate: cells.slice(1).join(" "), term: currentTerm });
      }
      return;
    }
    if (tag === "dt") {
      const dd = $(el).next("dd");
      if (dd.length) {
        out.push({ event: txt, rawDate: dd.text().trim(), term: currentTerm });
      }
    }
  });
  return out;
}

function extractExamSchedule(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  let currentTerm: string | undefined;
  $("h1, h2, h3, h4, table tr").each((_i, el) => {
    const tag = el.tagName?.toLowerCase() ?? "";
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt) return;
    if (/^h[1-4]$/.test(tag)) {
      const t = txt.match(/(Spring|Fall|Summer|Winter)\s+\d{4}/i);
      if (t) currentTerm = t[0];
      return;
    }
    if (tag === "tr") {
      const cells = $(el).find("td, th").map((_j, td) => $(td).text().trim()).get();
      if (cells.length >= 2 && /\d{4}/.test(cells.join(" "))) {
        out.push({
          event: cells[0],
          rawDate: cells.slice(1).join(" "),
          term: currentTerm,
          time: cells[cells.length - 1].match(/\b\d{1,2}:\d{2}\s*[AaPp][Mm]\b/)?.[0],
        });
      }
    }
  });
  return out;
}

function extractGradSchool(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  let currentTerm: string | undefined;
  $("h1, h2, h3, h4, table tr, p, li").each((_i, el) => {
    const tag = el.tagName?.toLowerCase() ?? "";
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt) return;
    if (/^h[1-4]$/.test(tag)) {
      const t = txt.match(/(Spring|Fall|Summer|Winter)\s+\d{4}/i);
      if (t) currentTerm = t[0];
      return;
    }
    if (tag === "tr") {
      const cells = $(el).find("td, th").map((_j, td) => $(td).text().trim()).get();
      if (cells.length >= 2) {
        out.push({ event: cells[0], rawDate: cells.slice(1).join(" "), term: currentTerm });
      }
      return;
    }
    if (tag === "p" || tag === "li") {
      const m = txt.match(/^(.{2,120}?)[\s\-–—:]+(.+?\d{4}.*)$/);
      if (m) out.push({ event: m[1].trim(), rawDate: m[2].trim(), term: currentTerm });
    }
  });
  return out;
}

// Replace the EXTRACTORS map:
const EXTRACTORS: Record<DateTableSourceId, (html: string) => RawRow[]> = {
  university_holidays: extractUniversityHolidays,
  academic_calendar: extractAcademicCalendar,
  exam_schedule: extractExamSchedule,
  grad_school_calendar: extractGradSchool,
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/parsers-date-table.test.ts`
Expected: all 6 tests PASS. If an extractor returns 0 rows, the selectors don't match the fixture — inspect the fixture's actual structure (which element type wraps each row) and adjust the cheerio selector. Do not relax test assertions.

- [ ] **Step 7: Commit**

```bash
git add msstate-policies/tests/fixtures/calendars/registrar_academic.html \
        msstate-policies/tests/fixtures/calendars/registrar_exams.html \
        msstate-policies/tests/fixtures/calendars/grad_school.html \
        msstate-policies/src/calendars/parsers/date_table.ts \
        msstate-policies/tests/parsers-date-table.test.ts
git commit -m "feat(calendars): Shape A parsers for registrar academic/exams + grad school"
```

---

## Task 4: Shape B parser — SFA financial aid (index + per-term sub-pages)

**Files:**
- Create: `msstate-policies/tests/fixtures/calendars/sfa_index.html`
- Create: `msstate-policies/tests/fixtures/calendars/sfa_term_2026_fall.html`
- Create: `msstate-policies/src/calendars/parsers/term_index.ts`
- Create: `msstate-policies/tests/parsers-term-index.test.ts`

- [ ] **Step 1: Capture both fixtures**

```bash
curl -sL -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.sfa.msstate.edu/calendars/" \
  -o msstate-policies/tests/fixtures/calendars/sfa_index.html
curl -sL -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.sfa.msstate.edu/calendars/academic-calendar/2026/fall" \
  -o msstate-policies/tests/fixtures/calendars/sfa_term_2026_fall.html
```

Verify each is > 10 KB and not a WAF challenge.

- [ ] **Step 2: Write the failing test**

Create `msstate-policies/tests/parsers-term-index.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSfaIndex,
  parseSfaTermPage,
} from "../src/calendars/parsers/term_index.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "fixtures", "calendars", name), "utf8");
}

test("parseSfaIndex returns >= 10 term URLs scoped to /calendars/academic-calendar/", () => {
  const entries = parseSfaIndex(fixture("sfa_index.html"));
  assert.ok(entries.length >= 10, `expected >= 10 term entries; got ${entries.length}`);
  for (const e of entries) {
    assert.match(
      e.url,
      /^https:\/\/www\.sfa\.msstate\.edu\/calendars\/academic-calendar\/\d{4}\/[\w-]+$/,
      `URL must match SFA term pattern: ${e.url}`,
    );
    assert.match(e.term, /(Spring|Fall|Summer|Winter|Maymester)/i);
    assert.match(String(e.year), /^\d{4}$/);
  }
});

test("parseSfaTermPage extracts at least one dated row for 2026 Fall", () => {
  const rows = parseSfaTermPage(fixture("sfa_term_2026_fall.html"), {
    url: "https://www.sfa.msstate.edu/calendars/academic-calendar/2026/fall",
    term: "Fall",
    year: 2026,
  });
  assert.ok(rows.length > 0, "expected >= 1 row from a real term page");
  for (const r of rows) {
    assert.equal(r.source, "sfa_financial_aid");
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.term, "Fall 2026");
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/parsers-term-index.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `term_index.ts`**

Create `msstate-policies/src/calendars/parsers/term_index.ts`:

```typescript
/**
 * Shape B parser: SFA financial-aid index + per-term sub-pages.
 *
 * The SFA index at /calendars/ is just a hub; real dates live on
 * /calendars/academic-calendar/<year>/<term> sub-pages.
 *
 * Build pipeline calls parseSfaIndex once, then fetches + parses each
 * sub-page via parseSfaTermPage. URLs come from the index (corpus rule:
 * no URL construction from a template against external input).
 */
import { load as cheerioLoad } from "cheerio";
import { CALENDAR_URLS, type CalendarRow } from "../types.js";
import { parseDateRange } from "./date_table.js";

const SFA_TERM_URL_RE =
  /^\/calendars\/academic-calendar\/(\d{4})\/([\w-]+)$/;

export interface SfaTermEntry {
  url: string;          // absolute URL
  year: number;         // 4-digit
  term: string;         // human-readable, e.g. "Spring", "Spring Mini-Term One"
}

export function parseSfaIndex(html: string): SfaTermEntry[] {
  const $ = cheerioLoad(html);
  const out: SfaTermEntry[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const m = href.match(SFA_TERM_URL_RE);
    if (!m) return;
    const year = Number(m[1]);
    const term = $(el).text().trim().replace(/\s+/g, " ");
    if (!term) return;
    const abs = `https://www.sfa.msstate.edu${href}`;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, year, term });
  });
  return out;
}

export function parseSfaTermPage(
  html: string,
  entry: SfaTermEntry,
): CalendarRow[] {
  const $ = cheerioLoad(html);
  const retrievedAt = new Date().toISOString();
  const rows: CalendarRow[] = [];
  $("table tr").each((_i, el) => {
    const cells = $(el).find("td, th").map((_j, td) => $(td).text().trim()).get();
    if (cells.length < 2) return;
    const event = cells[0];
    const rawDate = cells.slice(1).join(" ");
    if (!event || !rawDate) return;
    const range = parseDateRange(rawDate, entry.year);
    if (!range) return;
    rows.push({
      source: "sfa_financial_aid",
      event: event.slice(0, 200),
      start: range[0],
      end: range[1],
      term: `${entry.term} ${entry.year}`,
      source_url: entry.url,
      retrieved_at: retrievedAt,
    });
  });
  $("dl").each((_i, dl) => {
    $(dl).find("dt").each((_j, dt) => {
      const event = $(dt).text().trim();
      const dd = $(dt).next("dd");
      if (!event || !dd.length) return;
      const rawDate = dd.text().trim();
      const range = parseDateRange(rawDate, entry.year);
      if (!range) return;
      rows.push({
        source: "sfa_financial_aid",
        event: event.slice(0, 200),
        start: range[0],
        end: range[1],
        term: `${entry.term} ${entry.year}`,
        source_url: entry.url,
        retrieved_at: retrievedAt,
      });
    });
  });
  return rows;
}

export const SFA_INDEX_URL = CALENDAR_URLS.sfa_financial_aid;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd msstate-policies && npx tsx --test tests/parsers-term-index.test.ts`
Expected: both tests PASS. If `parseSfaTermPage` returns 0 rows, the fixture uses a different markup; inspect with the same Python snippet from Task 3 step 2 and add selectors.

- [ ] **Step 6: Commit**

```bash
git add msstate-policies/tests/fixtures/calendars/sfa_index.html \
        msstate-policies/tests/fixtures/calendars/sfa_term_2026_fall.html \
        msstate-policies/src/calendars/parsers/term_index.ts \
        msstate-policies/tests/parsers-term-index.test.ts
git commit -m "feat(calendars): Shape B parser for SFA financial-aid term pages"
```

---

## Task 5: Shape C parser — housing event list

**Files:**
- Create: `msstate-policies/tests/fixtures/calendars/housing_events.html`
- Create: `msstate-policies/src/calendars/parsers/event_list.ts`
- Create: `msstate-policies/tests/parsers-event-list.test.ts`

- [ ] **Step 1: Capture the fixture**

```bash
curl -sL -A "msstate-policies-mcp/0.4.0-dev (fixture-capture)" \
  "https://www.housing.msstate.edu/events/" \
  -o msstate-policies/tests/fixtures/calendars/housing_events.html
```

Verify > 30 KB and not a WAF challenge.

- [ ] **Step 2: Write the failing test**

Create `msstate-policies/tests/parsers-event-list.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHousingEvents } from "../src/calendars/parsers/event_list.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "fixtures", "calendars", name), "utf8");
}

test("parseHousingEvents returns >= 3 events with ISO dates", () => {
  const rows = parseHousingEvents(fixture("housing_events.html"));
  assert.ok(rows.length >= 3, `expected >= 3 events; got ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.source, "housing");
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.end, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.event.length > 0);
    assert.equal(r.source_url.startsWith("https://www.housing.msstate.edu"), true);
  }
});

test("parseHousingEvents captures a recognizable housing-shaped event", () => {
  const rows = parseHousingEvents(fixture("housing_events.html"));
  const text = rows.map((r) => r.event.toLowerCase()).join(" | ");
  const hit = ["move-in", "move in", "halls close", "halls open", "holiday", "selection"].some(
    (k) => text.includes(k),
  );
  assert.ok(hit, `expected a housing-shaped event in: ${text}`);
});

test("parseHousingEvents handles date ranges (start !== end) when present", () => {
  const rows = parseHousingEvents(fixture("housing_events.html"));
  const ranged = rows.find((r) => r.start !== r.end);
  if (!ranged) {
    console.warn("parsers-event-list: no date-range row in fixture; skipping range-shape check");
    return;
  }
  assert.ok(ranged.start <= ranged.end, "range must be chronologically ordered");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/parsers-event-list.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `event_list.ts`**

Create `msstate-policies/src/calendars/parsers/event_list.ts`:

```typescript
/**
 * Shape C parser: paginated Drupal events list (housing).
 *
 * Each event renders as a card/row with a title + date(s) + description.
 * We walk page 1 only; deeper pages are deferred to a future round.
 */
import { load as cheerioLoad } from "cheerio";
import { CALENDAR_URLS, type CalendarRow } from "../types.js";
import { parseDateRange } from "./date_table.js";

export function parseHousingEvents(html: string): CalendarRow[] {
  const $ = cheerioLoad(html);
  const retrievedAt = new Date().toISOString();
  const rows: CalendarRow[] = [];
  const candidates = $(
    "article, div.views-row, div[class*='event'], li[class*='event'], .node--type-event",
  );
  const seen = new Set<string>();

  candidates.each((_i, el) => {
    const fullText = $(el).text().replace(/\s+/g, " ").trim();
    if (!fullText || !/\b20\d{2}\b/.test(fullText)) return;
    const key = fullText.slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);

    const title = $(el).find("h2, h3, h4, a").first().text().trim();
    if (!title) return;

    const timeEl = $(el).find("time").first();
    const rawDate = timeEl.length
      ? timeEl.text().trim() || timeEl.attr("datetime") || ""
      : extractDateLine(fullText, title);
    if (!rawDate) return;

    const range = parseDateRange(rawDate);
    if (!range) return;

    const timeMatch = fullText.match(/\b(\d{1,2}:\d{2}\s*[AaPp][Mm](?:\s*[A-Z]{2,4})?)\b/);

    const description = (() => {
      let d = fullText.replace(title, "").replace(/Read more.*$/, "").trim();
      d = d.replace(rawDate, "").trim();
      return d.slice(0, 500);
    })();

    rows.push({
      source: "housing",
      event: title.slice(0, 200),
      start: range[0],
      end: range[1],
      time: timeMatch?.[1],
      description: description.length > 0 ? description : undefined,
      source_url: CALENDAR_URLS.housing,
      retrieved_at: retrievedAt,
    });
  });
  return rows;
}

function extractDateLine(fullText: string, title: string): string {
  const tail = fullText.slice(fullText.indexOf(title) + title.length).slice(0, 400);
  const m = tail.match(
    /([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?(?:\s*(?:to|-|–|—)\s*[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)?)/,
  );
  return m ? m[1] : "";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd msstate-policies && npx tsx --test tests/parsers-event-list.test.ts`
Expected: all 3 tests PASS. If `candidates` finds 0 elements, inspect the fixture for the actual wrapper class and add it to the selector list.

- [ ] **Step 6: Commit**

```bash
git add msstate-policies/tests/fixtures/calendars/housing_events.html \
        msstate-policies/src/calendars/parsers/event_list.ts \
        msstate-policies/tests/parsers-event-list.test.ts
git commit -m "feat(calendars): Shape C parser for housing event list"
```

---

## Task 6: Scraper dispatcher with WAF detection

**Files:**
- Create: `msstate-policies/src/calendars/scraper.ts`
- Create: `msstate-policies/tests/calendar-scraper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/calendar-scraper.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scrapeCalendarFromHtml,
  detectCalendarWaf,
} from "../src/calendars/scraper.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "fixtures", "calendars", name), "utf8");
}

test("scrapeCalendarFromHtml dispatches by source id", () => {
  const result = scrapeCalendarFromHtml(
    "university_holidays",
    fixture("hrm_holidays.html"),
  );
  assert.equal(result.source, "university_holidays");
  assert.equal(result.error, null);
  assert.ok(result.rows.length > 0);
});

test("detectCalendarWaf flags Cloudflare interstitial body", () => {
  assert.equal(detectCalendarWaf("<html>Just a moment...</html>"), true);
  assert.equal(detectCalendarWaf("<html>cf-chl-bypass</html>"), true);
  assert.equal(detectCalendarWaf("<html><body>real content</body></html>"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/calendar-scraper.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scraper.ts`**

Create `msstate-policies/src/calendars/scraper.ts`:

```typescript
/**
 * Calendar scraper dispatcher.
 *
 * Fetches each source via the existing http.ts helper (concurrency-bounded,
 * WAF-aware) and dispatches HTML to the right parser. SFA is two-level:
 * fetch the index, then fan out to <=12 term sub-pages with concurrency 4.
 *
 * No network in tests — tests pass HTML in directly via scrapeCalendarFromHtml.
 * The live-fetch entry scrapeCalendar() is exercised by the build script and
 * by the local install's runtime path.
 */
import { httpGet } from "../http.js";
import { log } from "../log.js";
import {
  CALENDAR_URLS,
  CalendarWafError,
  type CalendarRow,
  type CalendarSource,
  type ScrapeResult,
} from "./types.js";
import { parseDateTable, type DateTableSourceId } from "./parsers/date_table.js";
import {
  parseSfaIndex,
  parseSfaTermPage,
  type SfaTermEntry,
} from "./parsers/term_index.js";
import { parseHousingEvents } from "./parsers/event_list.js";

const SFA_FETCH_CONCURRENCY = 4;
const PER_FETCH_TIMEOUT_MS = 15_000;

export function detectCalendarWaf(body: string): boolean {
  if (body.includes("Just a moment...")) return true;
  if (body.includes("cf-chl-bypass")) return true;
  if (/<meta\s+http-equiv=["']refresh["'][^>]+url=[^>]*token=/i.test(body)) return true;
  const antibot =
    /<form[^>]+class=["'][^"']*antibot/i.test(body) &&
    !/id=["']datatable["']/.test(body);
  return antibot;
}

export function scrapeCalendarFromHtml(
  source: CalendarSource,
  html: string,
  context?: { sfaTerm?: SfaTermEntry },
): ScrapeResult {
  if (detectCalendarWaf(html)) {
    return { source, rows: [], error: `WAF challenge for ${source}` };
  }
  try {
    let rows: CalendarRow[];
    switch (source) {
      case "academic_calendar":
      case "exam_schedule":
      case "university_holidays":
      case "grad_school_calendar":
        rows = parseDateTable(html, source as DateTableSourceId);
        break;
      case "sfa_financial_aid":
        rows = context?.sfaTerm ? parseSfaTermPage(html, context.sfaTerm) : [];
        break;
      case "housing":
        rows = parseHousingEvents(html);
        break;
    }
    return { source, rows, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("warn", "calendar parser threw", { source, err: message });
    return { source, rows: [], error: message };
  }
}

export async function scrapeCalendar(source: CalendarSource): Promise<ScrapeResult> {
  if (source === "sfa_financial_aid") return scrapeSfa();
  const url = CALENDAR_URLS[source];
  try {
    const res = await httpGet(url, { timeoutMs: PER_FETCH_TIMEOUT_MS });
    const body = typeof res.body === "string" ? res.body : res.body.toString("utf8");
    return scrapeCalendarFromHtml(source, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("warn", "calendar fetch failed", { source, err: message });
    return { source, rows: [], error: message };
  }
}

async function scrapeSfa(): Promise<ScrapeResult> {
  const indexUrl = CALENDAR_URLS.sfa_financial_aid;
  let indexBody: string;
  try {
    const res = await httpGet(indexUrl, { timeoutMs: PER_FETCH_TIMEOUT_MS });
    indexBody = typeof res.body === "string" ? res.body : res.body.toString("utf8");
  } catch (err) {
    return {
      source: "sfa_financial_aid",
      rows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (detectCalendarWaf(indexBody)) {
    return { source: "sfa_financial_aid", rows: [], error: "WAF challenge on SFA index" };
  }
  const entries = parseSfaIndex(indexBody);
  const rows: CalendarRow[] = [];
  let lastError: string | null = null;
  for (let i = 0; i < entries.length; i += SFA_FETCH_CONCURRENCY) {
    const batch = entries.slice(i, i + SFA_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const res = await httpGet(entry.url, { timeoutMs: PER_FETCH_TIMEOUT_MS });
          const body = typeof res.body === "string" ? res.body : res.body.toString("utf8");
          if (detectCalendarWaf(body)) throw new CalendarWafError("sfa_financial_aid", entry.url);
          return parseSfaTermPage(body, entry);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          log("warn", "SFA term fetch failed", { url: entry.url, err: lastError });
          return [] as CalendarRow[];
        }
      }),
    );
    for (const r of results) rows.push(...r);
  }
  return {
    source: "sfa_financial_aid",
    rows,
    error: rows.length === 0 ? lastError ?? "no rows extracted" : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/calendar-scraper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/calendars/scraper.ts \
        msstate-policies/tests/calendar-scraper.test.ts
git commit -m "feat(calendars): scraper dispatcher with WAF detection"
```

---

## Task 7: Calendar corpus + search (BM25 over event + description)

**Files:**
- Create: `msstate-policies/src/calendars/corpus.ts`
- Create: `msstate-policies/src/calendars/search.ts`
- Create: `msstate-policies/tests/calendar-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/calendar-search.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indexCalendarRows,
  searchCalendarRows,
} from "../src/calendars/search.js";
import type { CalendarRow } from "../src/calendars/types.js";

const SAMPLE: CalendarRow[] = [
  {
    source: "academic_calendar",
    event: "Spring Break",
    start: "2026-03-09",
    end: "2026-03-13",
    term: "Spring 2026",
    source_url: "https://www.registrar.msstate.edu/calendars/academic-calendar",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
  {
    source: "university_holidays",
    event: "Thanksgiving Break",
    start: "2026-11-25",
    end: "2026-11-27",
    source_url: "https://www.hrm.msstate.edu/benefits/holidays/",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
  {
    source: "housing",
    event: "Halls Close for Spring 2026",
    description: "Students must move out by 12:00 pm.",
    start: "2026-05-15",
    end: "2026-05-15",
    source_url: "https://www.housing.msstate.edu/events/",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
];

test("searchCalendarRows ranks event-title match above description match", () => {
  indexCalendarRows(SAMPLE);
  const hits = searchCalendarRows("spring break");
  assert.ok(hits.length > 0);
  assert.equal(hits[0].row.event, "Spring Break");
});

test("searchCalendarRows: description-only keyword still matches (weight 1)", () => {
  indexCalendarRows(SAMPLE);
  const hits = searchCalendarRows("move out");
  assert.ok(hits.length > 0, "expected description token to surface a hit");
  assert.equal(hits[0].row.source, "housing");
});

test("searchCalendarRows returns empty for non-matching query", () => {
  indexCalendarRows(SAMPLE);
  const hits = searchCalendarRows("zebra giraffe");
  assert.equal(hits.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/calendar-search.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `corpus.ts` and `search.ts`**

Create `msstate-policies/src/calendars/corpus.ts`:

```typescript
/**
 * Calendar corpus loader.
 *
 * - In Worker mode, rows come from a snapshot (the Worker imports them from
 *   corpus.json). The stdio server doesn't run inside the Worker, so this
 *   module's live-fetch path is what runs locally.
 * - In local-install mode, rows come from live scrape with a TTL cache:
 *   6h for housing (volatile), 24h for the 5 stable sources.
 */
import { log } from "../log.js";
import {
  CALENDAR_SOURCES,
  type CalendarRow,
  type CalendarSource,
  type ScrapeResult,
} from "./types.js";
import { scrapeCalendar } from "./scraper.js";

interface CacheEntry {
  rows: CalendarRow[];
  expiresAt: number;
  error: string | null;
}

const cache = new Map<CalendarSource, CacheEntry>();

function ttlMsFor(source: CalendarSource): number {
  return source === "housing" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export async function loadAllCalendarRows(): Promise<CalendarRow[]> {
  const all: CalendarRow[] = [];
  for (const source of CALENDAR_SOURCES) {
    const result = await loadCalendarSource(source);
    all.push(...result.rows);
  }
  return all;
}

export async function loadCalendarSource(source: CalendarSource): Promise<ScrapeResult> {
  const now = Date.now();
  const hit = cache.get(source);
  if (hit && hit.expiresAt > now) {
    return { source, rows: hit.rows, error: hit.error };
  }
  const result = await scrapeCalendar(source);
  cache.set(source, {
    rows: result.rows,
    error: result.error,
    expiresAt: now + ttlMsFor(source),
  });
  if (result.error) {
    log("warn", "calendar source scrape error", { source, error: result.error });
  }
  return result;
}

export function getCalendarsCorpusHealth(): {
  per_source: Record<string, { row_count: number; error: string | null }>;
} {
  const per_source: Record<string, { row_count: number; error: string | null }> = {};
  for (const source of CALENDAR_SOURCES) {
    const entry = cache.get(source);
    per_source[source] = {
      row_count: entry?.rows.length ?? 0,
      error: entry?.error ?? null,
    };
  }
  return { per_source };
}
```

Create `msstate-policies/src/calendars/search.ts`:

```typescript
/**
 * BM25 search over calendar rows.
 *
 * Fields indexed (weighted):
 *   event       — weight 3 (most semantic)
 *   description — weight 1
 *   term        — weight 1
 *
 * Returns up to `limit` hits, sorted by score desc.
 */
import type { CalendarRow } from "./types.js";

const TOKEN_SPLIT = /[\s\-_/.,;:()\[\]{}!?"'`<>|@#$%^&*=+]+/;

function tokenize(input: string): string[] {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((t) => t.length > 0);
}

interface IndexedDoc {
  row: CalendarRow;
  eventTokens: string[];
  descriptionTokens: string[];
  termTokens: string[];
  dl: number;
}

const FIELD_WEIGHTS = { event: 3, description: 1, term: 1 } as const;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

let docs: IndexedDoc[] = [];
let df = new Map<string, number>();
let avgLen = 0;

export function indexCalendarRows(rows: CalendarRow[]): void {
  docs = rows.map((r) => {
    const eventTokens = tokenize(r.event);
    const descriptionTokens = tokenize(r.description ?? "");
    const termTokens = tokenize(r.term ?? "");
    return {
      row: r,
      eventTokens,
      descriptionTokens,
      termTokens,
      dl: eventTokens.length + descriptionTokens.length + termTokens.length,
    };
  });
  df = new Map();
  let total = 0;
  for (const d of docs) {
    total += d.dl;
    const seen = new Set<string>();
    for (const t of [...d.eventTokens, ...d.descriptionTokens, ...d.termTokens]) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  avgLen = docs.length > 0 ? total / docs.length : 0;
}

function idf(token: string): number {
  const n = docs.length;
  const dfi = df.get(token) ?? 0;
  if (dfi === 0 || n === 0) return 0;
  return Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5));
}

function countOf(token: string, arr: string[]): number {
  let c = 0;
  for (const t of arr) if (t === token) c++;
  return c;
}

function bm25Term(tf: number, dl: number, idfV: number): number {
  if (tf <= 0) return 0;
  const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / (avgLen || 1));
  return idfV * ((tf * (BM25_K1 + 1)) / denom);
}

export interface CalendarHit {
  row: CalendarRow;
  score: number;
}

export function searchCalendarRows(query: string, limit = 10): CalendarHit[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const out: CalendarHit[] = [];
  for (const d of docs) {
    let s = 0;
    for (const q of qTokens) {
      const idfQ = idf(q);
      if (idfQ === 0) continue;
      s += FIELD_WEIGHTS.event * bm25Term(countOf(q, d.eventTokens), d.dl, idfQ);
      s += FIELD_WEIGHTS.description * bm25Term(countOf(q, d.descriptionTokens), d.dl, idfQ);
      s += FIELD_WEIGHTS.term * bm25Term(countOf(q, d.termTokens), d.dl, idfQ);
    }
    if (s > 0) out.push({ row: d.row, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/calendar-search.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/calendars/corpus.ts \
        msstate-policies/src/calendars/search.ts \
        msstate-policies/tests/calendar-search.test.ts
git commit -m "feat(calendars): corpus loader + BM25 search"
```

---

## Task 8: Tool `find_msu_date` (chain tool)

**Files:**
- Create: `msstate-policies/src/tools/find_msu_date.ts`
- Create: `msstate-policies/tests/tool-find-msu-date.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/tool-find-msu-date.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexCalendarRows } from "../src/calendars/search.js";
import { find_msu_date } from "../src/tools/find_msu_date.js";
import type { CalendarRow } from "../src/calendars/types.js";

const SAMPLE: CalendarRow[] = [
  {
    source: "academic_calendar",
    event: "Spring Break",
    start: "2026-03-09",
    end: "2026-03-13",
    term: "Spring 2026",
    source_url: "https://www.registrar.msstate.edu/calendars/academic-calendar",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
  {
    source: "university_holidays",
    event: "Thanksgiving Break",
    start: "2026-11-25",
    end: "2026-11-27",
    source_url: "https://www.hrm.msstate.edu/benefits/holidays/",
    retrieved_at: "2026-05-11T00:00:00Z",
  },
];

test("find_msu_date returns shaped result on a hit", async () => {
  indexCalendarRows(SAMPLE);
  const res = await find_msu_date.handler({ q: "when is spring break" });
  const payload = JSON.parse(res.content[0].text);
  assert.ok(Array.isArray(payload.matches));
  assert.ok(payload.matches.length >= 1);
  assert.equal(payload.matches[0].event, "Spring Break");
  assert.equal(payload.matches[0].source, "academic_calendar");
  assert.match(payload.matches[0].start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof payload.notes, "string");
});

test("find_msu_date returns empty matches with notes on no-hit", async () => {
  indexCalendarRows(SAMPLE);
  const res = await find_msu_date.handler({ q: "zebra giraffe rhinoceros" });
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.matches.length, 0);
  assert.ok(payload.notes.length > 0);
});

test("find_msu_date rejects empty query via zod schema", async () => {
  await assert.rejects(() => find_msu_date.handler({ q: "" }));
});

test("find_msu_date rejects oversize query", async () => {
  const big = "x".repeat(5000);
  await assert.rejects(() => find_msu_date.handler({ q: big }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/tool-find-msu-date.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `find_msu_date.ts`**

Create `msstate-policies/src/tools/find_msu_date.ts`:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { searchCalendarRows } from "../calendars/search.js";

const FindMsuDateInput = z
  .object({
    q: z
      .string()
      .min(1, "q is required")
      .max(4096, "q too long (max 4096 chars)")
      .describe("Natural-language MSU date question, e.g. 'when does spring break start?'"),
  })
  .strict();

export const find_msu_date = {
  name: "find_msu_date",
  description:
    "Answer natural-language questions about Mississippi State University academic dates, financial-aid deadlines, university holidays, and residence-life milestones. Returns up to 5 matching calendar rows ranked by relevance, each with start/end dates, the source calendar, and the canonical msstate.edu URL. RULES for answering: (1) Use ONLY the returned rows — do not draw on outside knowledge. (2) Quote the date verbatim and cite the `source_url`. (3) If `matches` is empty or no row clearly answers the question, say so plainly and recommend the source URL or contacting the responsible MSU office. (4) Surface the row's `retrieved_at` (and `corpus_built_at` when present) so users can verify freshness.",
  inputSchema: zodToJsonSchema(FindMsuDateInput, { target: "openApi3" }),
  zodSchema: FindMsuDateInput,
  async handler(rawInput: unknown) {
    const input = FindMsuDateInput.parse(rawInput);
    const hits = searchCalendarRows(input.q, 5);
    const matches = hits.map((h) => ({
      source: h.row.source,
      event: h.row.event,
      start: h.row.start,
      end: h.row.end,
      time: h.row.time,
      term: h.row.term,
      description: h.row.description,
      source_url: h.row.source_url,
      retrieved_at: h.row.retrieved_at,
      score: Number(h.score.toFixed(6)),
    }));
    const notes = ambiguityNote(matches);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { q: input.q, matches, notes, corpus_built_at: null },
            null,
            2,
          ),
        },
      ],
    };
  },
};

function ambiguityNote(matches: Array<{ event: string }>): string {
  if (matches.length === 0) {
    return "No MSU calendar row matched this query. If the question is about an MSU date or deadline, try a more specific phrasing or check the source calendar directly.";
  }
  const stems = new Set(matches.map((m) => firstSignificantWord(m.event).toLowerCase()));
  if (stems.size === 1 && matches.length > 1) {
    const events = matches.map((m) => m.event).join(", ");
    return `Multiple events matched '${firstSignificantWord(matches[0].event)}': ${events}. Disambiguate by term or year if needed.`;
  }
  return "";
}

function firstSignificantWord(s: string): string {
  const words = s.split(/\s+/).filter((w) => !/^(the|a|an|of|for|to|in|on|at)$/i.test(w));
  return words[0] ?? s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/tool-find-msu-date.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/find_msu_date.ts \
        msstate-policies/tests/tool-find-msu-date.test.ts
git commit -m "feat(tools): add find_msu_date chain tool"
```

---

## Task 9: Tool `get_msu_calendar` (raw getter)

**Files:**
- Create: `msstate-policies/src/tools/get_msu_calendar.ts`
- Create: `msstate-policies/tests/tool-get-msu-calendar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/tool-get-msu-calendar.test.ts`:

```typescript
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

test("get_msu_calendar rejects unknown source via zod", async () => {
  await assert.rejects(() => get_msu_calendar.handler({ source: "athletics" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/tool-get-msu-calendar.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `get_msu_calendar.ts`**

Create `msstate-policies/src/tools/get_msu_calendar.ts`:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CALENDAR_SOURCES, CALENDAR_URLS, type CalendarRow } from "../calendars/types.js";

const GetMsuCalendarInput = z
  .object({
    source: z.enum(CALENDAR_SOURCES as unknown as [string, ...string[]]),
    term: z.string().min(1).max(64).optional(),
  })
  .strict();

let allRows: CalendarRow[] = [];

/** Test seam: the getter reads from a module-scoped row list. In production
 *  this list is populated by the server's startup wiring (Task 10). Tests
 *  call this to seed sample data. */
export function indexCalendarRowsForGetter(rows: CalendarRow[]): void {
  allRows = rows;
}

export const get_msu_calendar = {
  name: "get_msu_calendar",
  description:
    "Return the raw rows for one MSU calendar source. Useful for power-user lookups when you want the full date table rather than a ranked match. `source` is one of: academic_calendar, exam_schedule, university_holidays, grad_school_calendar, sfa_financial_aid, housing. Optional `term` filter matches the row's `term` field via case-insensitive substring (e.g. 'Fall 2026', '2026', 'fall').",
  inputSchema: zodToJsonSchema(GetMsuCalendarInput, { target: "openApi3" }),
  zodSchema: GetMsuCalendarInput,
  async handler(rawInput: unknown) {
    const input = GetMsuCalendarInput.parse(rawInput);
    const filter = input.term?.toLowerCase();
    const rows = allRows
      .filter((r) => r.source === input.source)
      .filter((r) => !filter || (r.term ?? "").toLowerCase().includes(filter));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              source: input.source,
              term: input.term ?? null,
              rows,
              source_url: CALENDAR_URLS[input.source as keyof typeof CALENDAR_URLS],
              corpus_built_at: null,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/tool-get-msu-calendar.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/get_msu_calendar.ts \
        msstate-policies/tests/tool-get-msu-calendar.test.ts
git commit -m "feat(tools): add get_msu_calendar raw-getter tool"
```

---

## Task 10: Register tools + wire calendar index on startup + extend health_check

**Files:**
- Modify: `msstate-policies/src/index.ts`
- Modify: `msstate-policies/src/tools/health_check.ts`

- [ ] **Step 1: Modify `src/index.ts` to register the new tools + background-warm calendars**

In `msstate-policies/src/index.ts`:

1. Add imports near the other tool imports:
```typescript
import { find_msu_date } from "./tools/find_msu_date.js";
import { get_msu_calendar, indexCalendarRowsForGetter } from "./tools/get_msu_calendar.js";
import { loadAllCalendarRows } from "./calendars/corpus.js";
import { indexCalendarRows } from "./calendars/search.js";
```

2. Update the `TOOLS` array to include both new tools (preserving deterministic order):
```typescript
const TOOLS = [
  search_policies,
  get_policy,
  chain_find_relevant_policies,
  cite_policy,
  find_msu_date,
  get_msu_calendar,
  health_check,
] as const;
```

3. After the existing policy background-warm (`fetchIndex().then(...)`), add a calendar background-warm:
```typescript
  loadAllCalendarRows()
    .then((rows) => {
      indexCalendarRows(rows);
      indexCalendarRowsForGetter(rows);
      log("info", "calendar background warm done", { rows: rows.length });
    })
    .catch((err) => {
      log("warn", "calendar background warm failed; will retry on first request", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
```

- [ ] **Step 2: Modify `src/tools/health_check.ts` to report calendar status**

In `msstate-policies/src/tools/health_check.ts`:

1. Add import:
```typescript
import { getCalendarsCorpusHealth } from "../calendars/corpus.js";
```

2. Inside the `handler`, after computing `co = getCorpusHealth()`, add:
```typescript
    const cal = getCalendarsCorpusHealth();
    const calendarsRowCount = Object.values(cal.per_source).reduce(
      (acc, x) => acc + x.row_count,
      0,
    );
    const calendarsLastError = Object.fromEntries(
      Object.entries(cal.per_source).map(([k, v]) => [k, v.error]),
    );
```

3. Add the new fields to the `state` object that gets returned:
```typescript
    const state = {
      // ...keep existing fields...
      calendars_row_count: calendarsRowCount,
      calendars_per_source: cal.per_source,
      calendars_last_error: calendarsLastError,
    };
```

If `HealthState` in `src/types.ts` is a strict interface, extend it with these 3 optional fields:
```typescript
  calendars_row_count?: number;
  calendars_per_source?: Record<string, { row_count: number; error: string | null }>;
  calendars_last_error?: Record<string, string | null>;
```

- [ ] **Step 3: Run the full test suite**

Run: `cd msstate-policies && npm test`
Expected: all tests PASS. The new tools are registered; existing policy tests still pass.

- [ ] **Step 4: Run typecheck**

Run: `cd msstate-policies && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/index.ts \
        msstate-policies/src/tools/health_check.ts \
        msstate-policies/src/types.ts
git commit -m "feat(server): register find_msu_date + get_msu_calendar; warm calendar index"
```

---

## Task 11: Extend `scripts/build-worker-corpus.mjs` to populate the `academic_calendar` block

**Files:**
- Modify: `scripts/build-worker-corpus.mjs`
- Create: `scripts/_scrape-calendars.mjs`

- [ ] **Step 1: Create the subprocess scraper**

Create `scripts/_scrape-calendars.mjs`:

```javascript
#!/usr/bin/env node
/**
 * One-shot calendar scrape that writes a single JSON blob to stdout.
 * Run via `node --import tsx scripts/_scrape-calendars.mjs` from repo root.
 *
 * Uses the same parsers + scraper as the runtime stdio server, so corpus
 * rows have identical shape and identical normalization.
 */
import { CALENDAR_SOURCES } from "../msstate-policies/src/calendars/types.ts";
import { scrapeCalendar } from "../msstate-policies/src/calendars/scraper.ts";

const rows = [];
const per_source = {};
let anyError = false;
for (const source of CALENDAR_SOURCES) {
  const r = await scrapeCalendar(source);
  per_source[source] = { row_count: r.rows.length, error: r.error };
  if (r.error) anyError = true;
  for (const row of r.rows) rows.push(row);
}
const out = { rows, per_source, anyError };
process.stdout.write(JSON.stringify(out));
```

- [ ] **Step 2: Extend `build-worker-corpus.mjs`**

In `scripts/build-worker-corpus.mjs`:

1. Add a top-level constant after the existing `BASE`/`UA` constants:

```javascript
const CAL_BASE_URLS = {
  academic_calendar: "https://www.registrar.msstate.edu/calendars/academic-calendar",
  exam_schedule: "https://www.registrar.msstate.edu/students/schedules/exam-schedule",
  university_holidays: "https://www.hrm.msstate.edu/benefits/holidays/",
  grad_school_calendar: "https://www.grad.msstate.edu/students/graduate-school-calendar",
  sfa_financial_aid: "https://www.sfa.msstate.edu/calendars/",
  housing: "https://www.housing.msstate.edu/events/",
};
```

2. Add an async helper near the bottom of the file, above `main()`:

```javascript
async function scrapeCalendarsViaSubprocess() {
  const { execFileSync } = await import("node:child_process");
  console.error("[build-worker-corpus] scraping calendars…");
  const out = execFileSync(
    "node",
    ["--no-warnings", "--import", "tsx", "scripts/_scrape-calendars.mjs"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const payload = JSON.parse(out.toString("utf8"));
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error("calendar scrape: malformed payload — refusing to ship a poisoned calendar corpus");
  }
  if (payload.rows.length === 0) {
    throw new Error("calendar scrape returned 0 rows — refusing to ship a poisoned calendar corpus");
  }
  for (const [source, info] of Object.entries(payload.per_source)) {
    if (info.error) {
      throw new Error(`calendar scrape: ${source} failed with: ${info.error} — refusing to ship a poisoned calendar corpus`);
    }
  }
  return payload;
}
```

3. Inside `main()`, before the existing `writeFileSync(corpusPath, ...)`, call the helper and merge into the corpus object:

```javascript
  const calendarPayload = await scrapeCalendarsViaSubprocess();
  // The existing code builds an object like:
  //   const corpus = { builtAt, source: BASE, indexRowCount: ..., policies: [...] };
  // Add the new key onto it.
  corpus.academic_calendar = {
    rows: calendarPayload.rows,
    per_source: calendarPayload.per_source,
    built_at: builtAt,
  };
```

(If the existing code uses a different variable name than `corpus`, locate it and extend the same way.)

- [ ] **Step 3: Run the build end-to-end**

```bash
node scripts/build-worker-corpus.mjs
```

Expected: build completes; `worker/corpus.json` exists. Verify:

```bash
node -e "const c = require('./worker/corpus.json'); console.log({
  policies: c.policies?.length,
  cal_rows: c.academic_calendar?.rows?.length,
  per_source: c.academic_calendar?.per_source,
});"
```
Expected: `cal_rows` > 30; every `per_source.<source>.error` is `null`.

If any source errors out, fix the underlying parser/fetch issue. **Do not commit a corpus.json with empty calendar rows or per-source errors.**

- [ ] **Step 4: Commit**

```bash
git add scripts/build-worker-corpus.mjs scripts/_scrape-calendars.mjs worker/corpus.json
git commit -m "feat(build): add academic_calendar block to worker corpus"
```

---

## Task 12: Add calendar tools + handlers to the Worker

**Files:**
- Modify: `worker/src/index.ts`

The Worker is a standalone module — it does NOT import from the policy bundle. We duplicate the tool definitions, the BM25 search, and the handler logic, reading rows from `corpus.academic_calendar.rows`.

- [ ] **Step 1: Extend Corpus type + load calendar rows**

Near the top of `worker/src/index.ts`, after the existing `interface Corpus`, add:

```typescript
interface CalendarRow {
  source: string;
  event: string;
  start: string;
  end: string;
  time?: string;
  term?: string;
  description?: string;
  source_url: string;
  retrieved_at: string;
}

interface CalendarBlock {
  rows: CalendarRow[];
  per_source: Record<string, { row_count: number; error: string | null }>;
  built_at: string;
}
```

Extend the existing `Corpus` interface with one new optional field:
```typescript
interface Corpus {
  builtAt: string;
  source: string;
  indexRowCount: number;
  policies: Policy[];
  academic_calendar?: CalendarBlock;
}
```

Add module-level constants after `const POLICIES = corpus.policies`:

```typescript
const CAL_ROWS: CalendarRow[] = corpus.academic_calendar?.rows ?? [];
const CAL_BUILT_AT = corpus.academic_calendar?.built_at ?? corpus.builtAt;
const CAL_PER_SOURCE = corpus.academic_calendar?.per_source ?? {};

const CAL_SOURCES = [
  "academic_calendar",
  "exam_schedule",
  "university_holidays",
  "grad_school_calendar",
  "sfa_financial_aid",
  "housing",
] as const;
```

- [ ] **Step 2: Add calendar BM25 indexing**

After the existing policy `bm25Search`, add a parallel section for calendars:

```typescript
interface CalDoc {
  row: CalendarRow;
  eventTokens: string[];
  descriptionTokens: string[];
  termTokens: string[];
  dl: number;
}

const calDocs: CalDoc[] = CAL_ROWS.map((r) => {
  const eventTokens = tokenize(r.event);
  const descriptionTokens = tokenize(r.description ?? "");
  const termTokens = tokenize(r.term ?? "");
  return {
    row: r,
    eventTokens,
    descriptionTokens,
    termTokens,
    dl: eventTokens.length + descriptionTokens.length + termTokens.length,
  };
});
const calDf = new Map<string, number>();
let calTotalLen = 0;
for (const d of calDocs) {
  calTotalLen += d.dl;
  const seen = new Set<string>();
  for (const t of [...d.eventTokens, ...d.descriptionTokens, ...d.termTokens]) {
    if (seen.has(t)) continue;
    seen.add(t);
    calDf.set(t, (calDf.get(t) ?? 0) + 1);
  }
}
const calAvgLen = calDocs.length > 0 ? calTotalLen / calDocs.length : 0;

function calIdf(token: string): number {
  const n = calDocs.length;
  const dfi = calDf.get(token) ?? 0;
  if (dfi === 0 || n === 0) return 0;
  return Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5));
}

const CAL_FIELD_WEIGHTS = { event: 3, description: 1, term: 1 } as const;

function bm25TermScoreCal(tf: number, dl: number, idfV: number): number {
  if (tf <= 0) return 0;
  const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / (calAvgLen || 1));
  return idfV * ((tf * (BM25_K1 + 1)) / denom);
}

function bm25SearchCalendars(query: string, limit = 5): { row: CalendarRow; score: number }[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const out: { row: CalendarRow; score: number }[] = [];
  for (const d of calDocs) {
    let s = 0;
    for (const q of qTokens) {
      const idfQ = calIdf(q);
      if (idfQ === 0) continue;
      const tfE = countOf(q, d.eventTokens);
      const tfD = countOf(q, d.descriptionTokens);
      const tfT = countOf(q, d.termTokens);
      s += CAL_FIELD_WEIGHTS.event * bm25TermScoreCal(tfE, d.dl, idfQ);
      s += CAL_FIELD_WEIGHTS.description * bm25TermScoreCal(tfD, d.dl, idfQ);
      s += CAL_FIELD_WEIGHTS.term * bm25TermScoreCal(tfT, d.dl, idfQ);
    }
    if (s > 0) out.push({ row: d.row, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
```

- [ ] **Step 3: Add tool descriptors to the `TOOLS` array**

Insert two new entries between `cite_policy` and `health_check` (preserves stdio order):

```typescript
  {
    name: "find_msu_date",
    description:
      "Answer natural-language questions about Mississippi State University academic dates, financial-aid deadlines, university holidays, and residence-life milestones. Returns up to 5 matching calendar rows ranked by relevance, each with start/end dates, the source calendar, and the canonical msstate.edu URL. RULES for answering: (1) Use ONLY the returned rows — do not draw on outside knowledge. (2) Quote the date verbatim and cite the `source_url`. (3) If `matches` is empty or no row clearly answers the question, say so plainly and recommend the source URL or contacting the responsible MSU office. (4) Surface the row's `retrieved_at` and `corpus_built_at` so users can verify freshness.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Natural-language MSU date question." },
      },
      required: ["q"],
    },
  },
  {
    name: "get_msu_calendar",
    description:
      "Return the raw rows for one MSU calendar source. `source` is one of: academic_calendar, exam_schedule, university_holidays, grad_school_calendar, sfa_financial_aid, housing. Optional `term` filter matches via case-insensitive substring (e.g. 'Fall 2026', '2026', 'fall').",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: [
            "academic_calendar",
            "exam_schedule",
            "university_holidays",
            "grad_school_calendar",
            "sfa_financial_aid",
            "housing",
          ],
        },
        term: { type: "string", description: "Optional term filter." },
      },
      required: ["source"],
    },
  },
```

- [ ] **Step 4: Add handler cases inside `callTool`**

In the `switch (name)` block, before the `default` case, add:

```typescript
    case "find_msu_date": {
      const q = String(args.q ?? "");
      if (q.length === 0) return errorContent("q is required.");
      if (q.length > MAX_QUERY_CHARS) return tooLong("q", q);
      const hits = bm25SearchCalendars(q, 5);
      const matches = hits.map((h) => ({
        source: h.row.source,
        event: h.row.event,
        start: h.row.start,
        end: h.row.end,
        time: h.row.time,
        term: h.row.term,
        description: h.row.description,
        source_url: h.row.source_url,
        retrieved_at: h.row.retrieved_at,
        score: Number(h.score.toFixed(6)),
      }));
      const notes =
        matches.length === 0
          ? "No MSU calendar row matched this query. Try a more specific phrasing or check the source calendar directly."
          : "";
      return jsonContent({
        q,
        matches,
        notes,
        corpus_built_at: CAL_BUILT_AT,
      });
    }

    case "get_msu_calendar": {
      const source = String(args.source ?? "");
      if (!CAL_SOURCES.includes(source as (typeof CAL_SOURCES)[number])) {
        return errorContent(
          `Unknown source: ${source}. Must be one of: ${CAL_SOURCES.join(", ")}.`,
        );
      }
      const term = args.term ? String(args.term).toLowerCase() : null;
      if (term && term.length > 64) return errorContent("term filter too long (max 64 chars).");
      const rows = CAL_ROWS.filter((r) => r.source === source).filter(
        (r) => !term || (r.term ?? "").toLowerCase().includes(term),
      );
      const sourceUrl = rows[0]?.source_url ?? "";
      return jsonContent({
        source,
        term: args.term ?? null,
        rows,
        source_url: sourceUrl,
        corpus_built_at: CAL_BUILT_AT,
      });
    }
```

- [ ] **Step 5: Extend the `health_check` Worker case + bump version literals**

Inside the `case "health_check"` branch of `callTool`, replace the returned object with:

```typescript
    case "health_check": {
      return jsonContent({
        runtime: "cloudflare-workers",
        version: "0.4.0",
        index_row_count: corpus.indexRowCount,
        policies_in_corpus: POLICIES.length,
        corpus_built_at: corpus.builtAt,
        corpus_source: corpus.source,
        bm25_corpus_stats: { N, avg_doc_length: Math.round(avgLen) },
        calendars_row_count: CAL_ROWS.length,
        calendars_built_at: CAL_BUILT_AT,
        calendars_per_source: CAL_PER_SOURCE,
        note: "This is the Cloudflare Workers variant. Corpus is a pre-extracted snapshot; rebuild via scripts/build-worker-corpus.mjs to refresh.",
      });
    }
```

Also update every `"0.3.0"` literal in `worker/src/index.ts` to `"0.4.0"` (the `/info` GET, the `serverInfo` block in `initialize`, and the health_check return).

- [ ] **Step 6: Manually invoke the Worker locally to smoke-test**

```bash
cd worker && npx wrangler dev --local --port 8788 &
DEV_PID=$!
sleep 5
curl -s -X POST http://localhost:8788/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print([t['name'] for t in d['result']['tools']])"
curl -s -X POST http://localhost:8788/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_msu_date","arguments":{"q":"when is spring break"}}}' \
  | python3 -m json.tool | head -30
kill $DEV_PID
```

Expected: `tools/list` returns 7 entries including `find_msu_date` and `get_msu_calendar`; `find_msu_date` returns a `matches` array with at least one Spring-Break-shaped row.

- [ ] **Step 7: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): add find_msu_date + get_msu_calendar tools"
```

---

## Task 13: CORPUS RULE addendum + security-checklist greps

**Files:**
- Modify: `CLAUDE.md`
- Modify: `tools/security-checklist.sh`

- [ ] **Step 1: Add the corpus rule addendum to CLAUDE.md**

Find the existing CORPUS RULE section in `CLAUDE.md` (starts with `## CORPUS RULE — No trained knowledge, no web searches`). Append a new subsection at the end of that section (before the next `##` heading):

```markdown
### Corpus extension (2026-05-11) — academic dates

The corpus also includes six named pages on msstate.edu subdomains:

1. `https://www.registrar.msstate.edu/calendars/academic-calendar`
2. `https://www.registrar.msstate.edu/students/schedules/exam-schedule`
3. `https://www.hrm.msstate.edu/benefits/holidays/`
4. `https://www.grad.msstate.edu/students/graduate-school-calendar`
5. `https://www.sfa.msstate.edu/calendars/` and its `/calendars/academic-calendar/<year>/<term>` sub-pages (sub-page URLs are extracted from the SFA index at runtime, never constructed from a template)
6. `https://www.housing.msstate.edu/events/` and its event-detail sub-pages

All other corpus-rule prohibitions apply unchanged: no training-data fallback, no third-party mirrors, no fetches against non-msstate.edu hosts, no `WebSearch` on these topics. Adding a seventh URL requires a new spec and a new addendum entry — this list is exhaustive.
```

- [ ] **Step 2: Add new security-checklist checks (24 pts)**

In `tools/security-checklist.sh`, append four new checks at the end of the file, immediately before any final summary/print line:

```bash
# ---- CAL1: Calendar corpus URLs are hardcoded in types.ts -------------------
if grep -qF 'CALENDAR_URLS' msstate-policies/src/calendars/types.ts 2>/dev/null \
   && grep -qE 'https://www\.registrar\.msstate\.edu' msstate-policies/src/calendars/types.ts \
   && grep -qE 'https://www\.hrm\.msstate\.edu' msstate-policies/src/calendars/types.ts \
   && grep -qE 'https://www\.grad\.msstate\.edu' msstate-policies/src/calendars/types.ts \
   && grep -qE 'https://www\.sfa\.msstate\.edu' msstate-policies/src/calendars/types.ts \
   && grep -qE 'https://www\.housing\.msstate\.edu' msstate-policies/src/calendars/types.ts; then
  score=$((score + 8))
  note "PASS" "CAL1 calendar URLs hardcoded in types.ts" 8
else
  note "FAIL" "CAL1 calendar URLs hardcoded in types.ts" 8
fi

# ---- CAL2: Calendar parsers never touch non-msstate.edu hosts ---------------
if find msstate-policies/src/calendars -type f -name '*.ts' -print0 2>/dev/null \
   | xargs -0 grep -hE 'https?://[^"'"'"' )]+' 2>/dev/null \
   | grep -vE 'https?://(www\.)?(registrar|hrm|grad|sfa|housing|policies)\.msstate\.edu' \
   | grep -qE 'https?://'; then
  note "FAIL" "CAL2 calendar code touches non-msstate.edu URLs" 8
else
  score=$((score + 8))
  note "PASS" "CAL2 calendar code stays on msstate.edu" 8
fi

# ---- CAL3: Worker calendar handler caps q length before tokenize() ----------
if grep -qE 'find_msu_date' worker/src/index.ts \
   && grep -qE 'q\.length\s*>\s*MAX_QUERY_CHARS' worker/src/index.ts; then
  score=$((score + 4))
  note "PASS" "CAL3 Worker caps find_msu_date q length" 4
else
  note "FAIL" "CAL3 Worker caps find_msu_date q length" 4
fi

# ---- CAL4: Build aborts on WAF challenge / empty calendar scrape ------------
if grep -qF "refusing to ship a poisoned calendar corpus" scripts/build-worker-corpus.mjs; then
  score=$((score + 4))
  note "PASS" "CAL4 build aborts on calendar WAF/empty" 4
else
  note "FAIL" "CAL4 build aborts on calendar WAF/empty" 4
fi
```

These four checks add 24 points total. The existing checklist totals 192. To preserve the 192 ceiling, decrement four of the existing pre-extension checks proportionally:

Edit these specific lines in `tools/security-checklist.sh`:
- `H3a` block: change `score=$((score + 10))` to `score=$((score + 8))` and update the `note ... 10` to `note ... 8`.
- `H3b` block: same change (10 → 8).
- `N3` block: change `score=$((score + 8))` to `score=$((score + 4))` and update the note count similarly.
- `N6` block: change `score=$((score + 12))` to `score=$((score + 4))` and update the note count.

Total adjustment: −2 −2 −4 −8 = −16 from existing checks, +24 from new = **+8 net**. Target total: **200**. **Update the CLAUDE.md "Security notes" section accordingly** (search for `192` and replace with `200`, both inline and in the round-2-closure paragraph), and update CI thresholds if any reference the 192 number explicitly.

(If the maintainer prefers to keep the 192 ceiling exactly, instead reduce the new checks: cut CAL3 + CAL4 from 4 → 2 each, and CAL1 + CAL2 from 8 → 6 each; total +16. Combined with the −16 from existing checks, net 0; total stays 192.)

- [ ] **Step 3: Verify the score**

Run:
```bash
bash tools/security-checklist.sh | tail -1
```
Expected: the new total (either 200 or 192, depending on which adjustment path was taken). Whichever target you picked, it must match.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md tools/security-checklist.sh
git commit -m "docs+security: corpus rule addendum for calendars + new checklist checks"
```

---

## Task 14: Eval set + README + BUILD.md + release prep

**Files:**
- Create: `msstate-policies/eval/eval-calendars-2026-05-11.json`
- Modify: `README.md`
- Modify: `docs/BUILD.md`
- Modify: `msstate-policies/package.json` (version 0.3.0 → 0.4.0)

- [ ] **Step 1: Write the eval set with real dates from the freshly-built corpus**

Create `msstate-policies/eval/eval-calendars-2026-05-11.json` with this scaffold. **Before committing, populate every `expected_start_date` by reading the freshly-built `worker/corpus.json`** — do not type any date from memory.

```json
{
  "built_at": "2026-05-11",
  "judge": "claude-sonnet-4-6",
  "tool": "find_msu_date",
  "questions": [
    { "q": "When does spring break begin in spring 2026?", "expected_source": "academic_calendar", "expected_event_substring": "Spring Break", "expected_start_date": null, "tags": ["academic", "registrar", "break"] },
    { "q": "When does fall 2026 semester start?", "expected_source": "academic_calendar", "expected_event_substring": "Classes Begin", "expected_start_date": null, "tags": ["academic", "registrar", "term-start"] },
    { "q": "What is the last day to drop a class with a W in fall 2026?", "expected_source": "academic_calendar", "expected_event_substring": "Drop", "expected_start_date": null, "tags": ["academic", "registrar", "deadline"] },
    { "q": "When is finals week for fall 2026?", "expected_source": "exam_schedule", "expected_event_substring": "Final", "expected_start_date": null, "tags": ["academic", "registrar", "exams"] },
    { "q": "What time is the math final exam in fall 2026?", "expected_source": "exam_schedule", "expected_event_substring": "Math", "expected_start_date": null, "tags": ["academic", "registrar", "exams", "course-specific"] },
    { "q": "When is Thanksgiving break in 2026?", "expected_source": "university_holidays", "expected_event_substring": "Thanksgiving", "expected_start_date": null, "tags": ["holidays", "hrm"] },
    { "q": "Is MSU closed on Memorial Day 2026?", "expected_source": "university_holidays", "expected_event_substring": "Memorial Day", "expected_start_date": null, "tags": ["holidays", "hrm"] },
    { "q": "When is Independence Day observed by MSU?", "expected_source": "university_holidays", "expected_event_substring": "Independence", "expected_start_date": null, "tags": ["holidays", "hrm"] },
    { "q": "When are graduate theses due for fall 2026?", "expected_source": "grad_school_calendar", "expected_event_substring": "Thesis", "expected_start_date": null, "tags": ["grad", "deadline"] },
    { "q": "When is the deadline to apply to graduate for spring 2026?", "expected_source": "grad_school_calendar", "expected_event_substring": "Apply", "expected_start_date": null, "tags": ["grad", "deadline"] },
    { "q": "When is FAFSA due for fall 2026?", "expected_source": "sfa_financial_aid", "expected_event_substring": "FAFSA", "expected_start_date": null, "tags": ["financial-aid", "deadline"] },
    { "q": "When are financial aid disbursements for spring 2026?", "expected_source": "sfa_financial_aid", "expected_event_substring": "Disbursement", "expected_start_date": null, "tags": ["financial-aid", "money"] },
    { "q": "When do residence halls close for spring 2026?", "expected_source": "housing", "expected_event_substring": "Halls Close", "expected_start_date": null, "tags": ["housing", "move-out"] },
    { "q": "When is fall 2026 move-in?", "expected_source": "housing", "expected_event_substring": "Move-In", "expected_start_date": null, "tags": ["housing", "move-in"] },
    { "q": "When does online room selection happen?", "expected_source": "housing", "expected_event_substring": "Room Selection", "expected_start_date": null, "tags": ["housing"] },
    { "q": "What's the weather forecast for Friday?", "expected_source": null, "expected_event_substring": null, "expected_start_date": null, "tags": ["refusal", "out-of-scope"] }
  ]
}
```

Populate each `expected_start_date` using the corpus:
```bash
node -e "
const c = require('./worker/corpus.json');
const find = (needle) => c.academic_calendar.rows
  .filter(r => r.event.toLowerCase().includes(needle.toLowerCase()))
  .map(r => ({ event: r.event, start: r.start, source: r.source, term: r.term }));
console.log(JSON.stringify(find('Spring Break'), null, 2));
console.log(JSON.stringify(find('Classes Begin'), null, 2));
// ...etc for each expected_event_substring
"
```

Patch each entry's `expected_start_date` with the actual ISO date the corpus produced. If a question has no matching row in the corpus (e.g. a deeply-specific course-finals time), set `expected_start_date` to `null` and add the tag `"corpus-miss"` so the eval-runner knows to expect a graceful refusal.

- [ ] **Step 2: Update README.md**

Modify `README.md`:

1. Change every reference to "5 tools" to "7 tools" (search the file with `grep -n "5 tools\|5 \*\*tools" README.md` first to find them all).
2. After the opening summary paragraph, add a new sentence:
   > The server also covers MSU academic dates — the registrar's academic and exam calendars, university holidays, the graduate-school calendar, financial-aid important dates, and residence-life milestones — using the same grounding rules (cite the source MSU page).
3. In the "You can ask things like:" list, append two bullets:
   ```markdown
   - *"When does spring break start in spring 2026?"*
   - *"When is fall move-in?"*
   ```

- [ ] **Step 3: Update docs/BUILD.md**

Add a new subsection (place it in the architecture area, near the existing scraper notes):

```markdown
### Calendar tools (v0.4.0, 2026-05-11)

Two tools (`find_msu_date`, `get_msu_calendar`) cover six msstate.edu calendar sources via three parser shapes:

- **Shape A** (single-page date table): registrar academic calendar, registrar exam schedule, HRM university holidays, grad school. One fetch per source.
- **Shape B** (term-index + per-term sub-pages): SFA financial aid. Index lists ~10–12 sub-pages per academic year; bounded concurrency 4 with 15s per-fetch timeout.
- **Shape C** (paginated Drupal event list): housing. Page 1 only.

Worker reads from `worker/corpus.json`'s `academic_calendar` block; local install live-scrapes with TTL cache (6h housing, 24h others). WAF detection mirrors the policy build — any challenge aborts the calendar block of the build.

Corpus rule addendum in `CLAUDE.md` lists all six URL bases; `tools/security-checklist.sh` enforces that calendar code never touches non-msstate.edu hosts and that the build aborts on WAF/empty.
```

- [ ] **Step 4: Version bump**

In `msstate-policies/package.json`, change `"version": "0.3.0"` to `"version": "0.4.0"`. Then run the version-sync script so any other places (Worker version literals, etc.) update consistently:

```bash
node scripts/sync-version.mjs
```

If `sync-version.mjs` doesn't update `worker/src/index.ts`, do it by hand: any remaining `"0.3.0"` literals → `"0.4.0"`.

- [ ] **Step 5: Final full-build + test + checklist**

```bash
cd msstate-policies && npm test && npm run typecheck && npm run build && cd ..
node scripts/build-worker-corpus.mjs
bash tools/security-checklist.sh | tail -1
```

Expected:
- All tests PASS.
- typecheck clean.
- esbuild produces `msstate-policies/dist/index.js` with a banner naming version 0.4.0 + the current git SHA.
- `worker/corpus.json` rebuilt with calendar rows.
- Security checklist score: the new total agreed in Task 13 Step 2 (192 or 200).

- [ ] **Step 6: Commit + final summary**

```bash
git add msstate-policies/eval/eval-calendars-2026-05-11.json \
        README.md docs/BUILD.md \
        msstate-policies/package.json msstate-policies/dist/index.js \
        worker/corpus.json \
        worker/src/index.ts
git commit -m "feat: release v0.4.0 — MSU calendars (academic dates)

- 6 msstate.edu sources, 3 parser shapes
- 2 new MCP tools (find_msu_date, get_msu_calendar); tool count 5 -> 7
- Worker corpus extended with academic_calendar block
- Eval set + README + docs/BUILD.md updated
- CLAUDE.md corpus rule addendum

Spec: .dev/specs/2026-05-11-msu-calendars-design.md
Plan: .dev/plans/2026-05-11-msu-calendars.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

After Task 14:
- 7 tools list correctly across all clients (Claude Code plugin, claude.ai connector, ChatGPT Plus connector, Claude Desktop, OpenAI API path).
- All parser tests + tool tests + the existing policy tests pass.
- Worker bundle ready for `wrangler deploy` from `worker/` (manual).
- npm `msstate-policies-mcp` ready for `npm publish` from `msstate-policies/` (manual).
- Eval is structured; running it end-to-end against the live tool is out of scope for this plan (separate harness extension).
