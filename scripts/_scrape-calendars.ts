/**
 * One-shot calendar scrape that writes a single JSON blob to stdout.
 * Run via `npx tsx scripts/_scrape-calendars.ts` from repo root.
 *
 * Uses the same parsers + scraper as the runtime stdio server, so corpus
 * rows have identical shape and identical normalization.
 *
 * Corpus rule: all data comes exclusively from msstate.edu sites.
 */

// pdf-parse uses console.log() for warnings like "Warning: TT: undefined function".
// Redirect console.log → stderr so stdout stays clean JSON.
// eslint-disable-next-line no-console
console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

import { CALENDAR_SOURCES } from "../msstate-policies/src/calendars/types.js";
import { scrapeCalendar } from "../msstate-policies/src/calendars/scraper.js";
import type { CalendarRow, CalendarSource } from "../msstate-policies/src/calendars/types.js";

interface PerSourceInfo {
  row_count: number;
  error: string | null;
}

interface ScrapeOutput {
  rows: CalendarRow[];
  per_source: Record<CalendarSource, PerSourceInfo>;
  anyError: boolean;
}

async function main(): Promise<void> {
  const rows: CalendarRow[] = [];
  const per_source = {} as Record<CalendarSource, PerSourceInfo>;
  let anyError = false;

  for (const source of CALENDAR_SOURCES) {
    process.stderr.write(`[scrape-calendars] ${source}...\n`);
    const r = await scrapeCalendar(source);
    per_source[source] = { row_count: r.rows.length, error: r.error };
    if (r.error) anyError = true;
    process.stderr.write(
      `[scrape-calendars]   ${r.rows.length} rows, error=${r.error ?? "null"}\n`,
    );
    for (const row of r.rows) rows.push(row);
  }

  const out: ScrapeOutput = { rows, per_source, anyError };
  process.stdout.write(JSON.stringify(out));
}

main().catch((err) => {
  process.stderr.write(`[scrape-calendars] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
