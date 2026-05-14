/**
 * Type definitions + frozen constants for the dining module.
 *
 * Corpus rule expansion (v1.1.0): MSU-authoritative includes msstate.edu
 * and any domain *.msstate.edu officially 200-redirects to. Today the only
 * domain admitted under the second clause is msstatedining.mydininghub.com
 * (Compass Group Touchpoint platform, which dining.msstate.edu redirects to).
 */

/** Frozen allowlist of dining-module root URLs. */
export const DINING_ROOTS = Object.freeze([
  "https://dining.msstate.edu/",
  "https://msstatedining.mydininghub.com/",
] as const);

/** URL-safe slug. Must start with alphanumeric, end with alphanumeric, contain only [a-z0-9-]. */
export const LOCATION_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** Hard cap on free-text input lengths before parse. Mirrors other modules. */
export const MAX_QUERY_CHARS = 4096;

/**
 * Constant disclaimer carried on every dining tool response.
 * Stdio/plugin users explicitly addressed since their snapshot can be
 * weeks-to-months old between quarterly npm releases.
 */
export const DINING_DISCLAIMER =
  "MSU dining locations and hours change frequently. The web/mobile connector " +
  "refreshes this data daily; if you're using the local npx or Claude Code " +
  "plugin install, this snapshot may be days-months old - verify against " +
  "https://dining.msstate.edu/ before going to a closed venue.";

/** Touchpoint occasionally serves a WAF challenge instead of real HTML. */
export class DiningWafError extends Error {
  url: string;
  constructor(url: string) {
    super(`WAF challenge detected at ${url}`);
    this.name = "DiningWafError";
    this.url = url;
  }
}

/** A single time period within a day, e.g., "11:00-14:00 Lunch". */
export interface DiningMealPeriod {
  open: string;  // "HH:MM" 24-hour
  close: string; // "HH:MM"
  label: string | null; // "Breakfast" | "Lunch" | "Dinner" | null
}

/** Hours for one day. closed=true means closed all day; periods empty in that case. */
export interface DiningHoursDay {
  day_of_week:
    | "monday" | "tuesday" | "wednesday" | "thursday"
    | "friday" | "saturday" | "sunday";
  closed: boolean;
  periods: DiningMealPeriod[];
  raw_text: string;
}

/** Parser warnings emitted per location row. */
export type DiningParseWarning =
  | "no_hours_extracted"
  | "hours_format_unrecognized"
  | "page_timeout";

/** Computed "now" status for a location. */
export type DiningStatus =
  | "open"
  | "closed"
  | { status: "opens_at"; at: string }   // "HH:MM" today or tomorrow
  | { status: "closes_at"; at: string }
  | "unknown";

/** One dining venue. */
export interface DiningLocation {
  slug: string;
  name: string;
  url: string;
  hours_by_day: DiningHoursDay[]; // length 0 or 7 (one per weekday)
  hours_today: DiningHoursDay | null;
  hours_raw_text: string;
  meal_periods_today: DiningMealPeriod[];
  parse_warnings: DiningParseWarning[];
  retrieved_at: string;
}

/** Lightweight index entry returned by parseSitemapLocations. */
export interface DiningIndexEntry {
  slug: string;
  name: string;
  url: string;
}

/** The full dining corpus baked into worker/corpus.json and dist/index.js. */
export interface DiningCorpus {
  builtAt: string;
  source: string; // "https://msstatedining.mydininghub.com/"
  locations: DiningLocation[];
}
