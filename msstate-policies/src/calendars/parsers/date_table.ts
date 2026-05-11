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
 *   "December 23, 2026, through January 1, 2027"
 */
export function parseDateRange(
  raw: string,
  fallbackYear?: number,
): [string, string] | null {
  const clean = raw.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

  // Two-month range: "Month D, YYYY - Month D, YYYY" or "Month D, YYYY, through Month D, YYYY"
  const twoMonth = clean.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?(?:,)?\s*(?:-|through)\s*([A-Za-z]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?/,
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

/**
 * Extractor for https://www.hrm.msstate.edu/benefits/holidays/
 *
 * The page has multiple calendar-year sections, each with a 4-column table:
 *   col[0] = event name  (e.g. "Memorial Day")
 *   col[1] = day-of-week (e.g. "Monday")  — ignored
 *   col[2] = day count   (e.g. "1")       — ignored
 *   col[3] = date string (e.g. "May 25, 2026" or "December 23, 2026, through January 1, 2027")
 *
 * Rows where col[0] is blank/whitespace-only (e.g. "Last Day Worked" rows,
 * "Total Calendar … Holidays" summary rows) are skipped because they don't
 * represent actual holiday events.
 */
function extractUniversityHolidays(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];

  $("table.table tr").each((_i, el) => {
    const cells = $(el).find("td").map((_j, td) => $(td).text().replace(/ /g, " ").trim()).get();
    if (cells.length < 4) return;

    const event = cells[0];
    const rawDate = cells[3];

    // Skip blank event names (summary/annotation rows)
    if (!event) return;
    // Skip summary rows like "Total Calendar 2026 Holidays"
    if (/total\s+calendar/i.test(event)) return;

    out.push({ event, rawDate });
  });

  return out;
}

/**
 * Extractor for registrar.msstate.edu academic calendar term sub-pages.
 *
 * Each term page (e.g. /calendars/academic-calendar/2026/spring) uses a
 * Bootstrap grid layout:
 *   <h2>2026 - Spring</h2>
 *   <div class="row g-0 border-bottom">
 *     <div class="col col-md-4">
 *       <time datetime="2026-01-14T12:00:00Z">January 14</time>
 *       [optional: to</br><time datetime="2026-01-16T12:00:00Z">...]
 *     </div>
 *     <div class="col col-md-8">Event description text</div>
 *   </div>
 *
 * The fixture (registrar_academic.html) is a combined page with spring +
 * fall 2026 content. Term is parsed from the preceding <h2> element.
 */
function extractAcademicCalendar(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  let currentTerm: string | undefined;

  // Walk every element in document order; track h2 for term changes,
  // then collect each Bootstrap grid row.
  $("h2, h3, h4, .row.g-0.border-bottom, div.row").each((_i, el) => {
    const tag = ((el as { tagName?: string }).tagName ?? "").toLowerCase();
    const cls = $(el).attr("class") ?? "";

    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      // Match "2026 - Spring", "2026 - Fall", etc.
      const t = txt.match(/(\d{4})\s*[-–]\s*(Spring|Fall|Summer|Winter|Maymester)/i);
      if (t) currentTerm = `${t[2].charAt(0).toUpperCase()}${t[2].slice(1).toLowerCase()} ${t[1]}`;
      return;
    }

    // Only process grid rows that have border-bottom (event rows)
    if (!cls.includes("border-bottom")) return;

    // Date column: first time element = start, second time element = end
    const times = $(el).find("time");
    if (times.length === 0) return;

    // Extract year from datetime attribute (e.g. "2026-01-14T12:00:00Z" → "2026")
    const startAttr = $(times[0]).attr("datetime") ?? "";
    const yearFromAttr = startAttr.match(/^(\d{4})-/)?.[1] ?? "";

    // Use visible text content for rawDate (e.g. "January 14", "March 9")
    // because parseDateRange handles month-name format. Append year from the
    // datetime attribute so parseDateRange doesn't need the fallbackYear.
    const startText = $(times[0]).text().trim();
    let rawDate: string;
    if (times.length > 1) {
      const endText = $(times[times.length - 1]).text().trim();
      const endAttr = $(times[times.length - 1]).attr("datetime") ?? "";
      const endYear = endAttr.match(/^(\d{4})-/)?.[1] ?? yearFromAttr;
      // "March 9, 2026 - March 13, 2026" style
      rawDate = startText + (yearFromAttr ? `, ${yearFromAttr}` : "") + " - " + endText + (endYear ? `, ${endYear}` : "");
    } else {
      rawDate = startText + (yearFromAttr ? `, ${yearFromAttr}` : "");
    }

    // Event text: second column (col-md-8), or all text minus the date column
    const cols = $(el).find("[class*='col']");
    const eventText = cols.length >= 2
      ? $(cols[1]).text().replace(/\s+/g, " ").trim()
      : $(el).text().replace(/\s+/g, " ").trim();

    if (!eventText || !rawDate) return;

    out.push({ event: eventText, rawDate, term: currentTerm });
  });

  return out;
}

/**
 * Extractor for registrar.msstate.edu exam schedule term sub-pages.
 *
 * Same Bootstrap grid layout as the academic calendar. Each row has 4 columns:
 *   col[0] = class start time (e.g. "8:00 AM")
 *   col[1] = days pattern (e.g. "MWF")
 *   col[2] = exam date (<time datetime="...">Day, Month D</time>)
 *   col[3] = exam time range (two <time> elements)
 *
 * The date for the CalendarRow comes from col[2]'s datetime attribute.
 */
function extractExamSchedule(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  let currentTerm: string | undefined;

  $("h2, h3, .row.g-0.card-body").each((_i, el) => {
    const tag = ((el as { tagName?: string }).tagName ?? "").toLowerCase();
    const cls = $(el).attr("class") ?? "";

    if (tag === "h2" || tag === "h3") {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      const t = txt.match(/(\d{4})\s*[-–]\s*(Spring|Fall|Summer|Winter|Maymester)/i);
      if (t) currentTerm = `${t[2].charAt(0).toUpperCase()}${t[2].slice(1).toLowerCase()} ${t[1]}`;
      return;
    }

    // Only process card-body rows
    if (!cls.includes("card-body")) return;

    // Skip the header row (fw-bold)
    if ($(el).find(".fw-bold").length > 0) return;

    const cols = $(el).find("[class*='col']");
    if (cols.length < 3) return;

    // col[0] = class time, col[1] = days, col[2] = exam date time element, col[3] = exam time
    const classTime = $(cols[0]).text().replace(/\s+/g, " ").trim();
    const days = $(cols[1]).text().replace(/\s+/g, " ").trim();
    const examDateEl = $(cols[2]).find("time");
    const examTimeText = $(cols[3]).text().replace(/\s+/g, " ").trim();

    if (examDateEl.length === 0) return;

    // Use visible text + year from datetime attribute for parseDateRange compatibility
    const dateAttr = examDateEl.attr("datetime") ?? "";
    const yearFromAttr = dateAttr.match(/^(\d{4})-/)?.[1] ?? "";
    const dateText = examDateEl.text().replace(/\s+/g, " ").trim();
    const rawDate = dateText + (yearFromAttr ? `, ${yearFromAttr}` : "");

    // Event name = "class time days — exam" e.g. "8:00 AM MWF exam"
    const event = `${classTime} ${days}`.trim();
    if (!event || !rawDate) return;

    out.push({
      event,
      rawDate,
      term: currentTerm,
      time: examTimeText || undefined,
    });
  });

  return out;
}

/**
 * Extractor for grad.msstate.edu graduate school calendar.
 *
 * The fixture (grad_school.html) is built from the PDF content, rendered as a
 * simple HTML table with two columns: Date and Description.
 *
 * Also handles common MSU list-item patterns as a fallback.
 */
function extractGradSchool(html: string): RawRow[] {
  const $ = cheerioLoad(html);
  const out: RawRow[] = [];
  let currentTerm: string | undefined;

  $("h2, h3, h4, table tr, p, li").each((_i, el) => {
    const tag = ((el as { tagName?: string }).tagName ?? "").toLowerCase();
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt) return;

    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const t = txt.match(/(Spring|Fall|Summer|Winter|Maymester)\s+\d{4}/i);
      if (t) currentTerm = t[0].replace(/\s+/g, " ");
      return;
    }

    if (tag === "tr") {
      const cells = $(el).find("td, th").map((_j, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
      if (cells.length >= 2 && cells[0] && cells[1]) {
        // Skip header rows
        if (/^date$/i.test(cells[0]) || /^description$/i.test(cells[0])) return;
        out.push({ event: cells[1], rawDate: cells[0], term: currentTerm });
      }
      return;
    }

    if (tag === "p" || tag === "li") {
      // Pattern: "Month D – D Description" or "Month D Description"
      const m = txt.match(/^((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+.{1,30}?)\s{2,}(.+)$/);
      if (m) {
        out.push({ event: m[2].trim(), rawDate: m[1].trim(), term: currentTerm });
      }
    }
  });

  return out;
}

const EXTRACTORS: Record<DateTableSourceId, (html: string) => RawRow[]> = {
  university_holidays: extractUniversityHolidays,
  academic_calendar: extractAcademicCalendar,
  exam_schedule: extractExamSchedule,
  grad_school_calendar: extractGradSchool,
};

// ---- Public entry ----------------------------------------------------------

export function parseDateTable(html: string, source: DateTableSourceId): CalendarRow[] {
  const extractor = EXTRACTORS[source];
  const raw = extractor(html);
  const retrievedAt = new Date().toISOString();
  // Infer a fallback year from the first 4-digit year on the page (per-page,
  // not training-data).
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
