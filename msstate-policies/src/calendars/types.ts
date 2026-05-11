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
