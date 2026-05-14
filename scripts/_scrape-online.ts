/**
 * One-shot online-site scrape that writes a single JSON blob to stdout.
 * Run via `npx tsx scripts/_scrape-online.ts` from repo root.
 *
 * Mirrors scripts/_scrape-tuition.ts pattern: stdout-only JSON output,
 * stderr-only logging, defensive console.log redirect at the top.
 */

console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

import { scrapeAllOnline } from "../msstate-policies/src/online/scraper.js";

async function main(): Promise<void> {
  process.stderr.write("[scrape-online] starting two-pass scrape...\n");
  const r = await scrapeAllOnline();
  process.stderr.write(
    `[scrape-online]   ${r.programs.length} programs, ${r.staff.length} staff, ${r.info_pages.length} info pages, anyError=${r.anyError}\n`,
  );
  const programWithWarnings = r.programs.filter((p) => p.parse_warnings.length > 0).length;
  process.stderr.write(`[scrape-online]   ${programWithWarnings} programs have parse_warnings\n`);
  for (const [src, info] of Object.entries(r.per_source)) {
    if (!info.ok) process.stderr.write(`[scrape-online]   FAIL ${src}: ${info.error}\n`);
  }
  process.stdout.write(
    JSON.stringify({
      programs: r.programs,
      admissions_process: r.admissions_process,
      staff: r.staff,
      info_pages: r.info_pages,
      per_source: r.per_source,
      anyError: r.anyError,
    }),
  );
}

main().catch((err) => {
  process.stderr.write(`[scrape-online] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
