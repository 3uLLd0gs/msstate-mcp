/**
 * One-shot dining scrape that writes a single JSON blob to stdout.
 * Run via `npx tsx scripts/_scrape-dining.ts` from repo root.
 *
 * Imports playwright at runtime (devDep) and passes it into scrapeAllDining.
 * stderr-only logging; stdout reserved for the JSON envelope.
 */

console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

import { chromium } from "playwright";
import { scrapeAllDining, type PlaywrightLike } from "../msstate-policies/src/dining/scraper.js";

async function main(): Promise<void> {
  process.stderr.write("[scrape-dining] starting two-pass scrape...\n");
  const playwright: PlaywrightLike = { chromium };
  const r = await scrapeAllDining({ playwright });
  process.stderr.write(
    `[scrape-dining]   ${r.locations.length} locations, anyError=${r.anyError}\n`,
  );
  const warnings = r.locations.filter((l) => l.parse_warnings.length > 0).length;
  process.stderr.write(`[scrape-dining]   ${warnings} locations with parse_warnings\n`);
  for (const [src, info] of Object.entries(r.per_source)) {
    if (!info.ok) process.stderr.write(`[scrape-dining]   FAIL ${src}: ${info.error}\n`);
  }
  process.stdout.write(
    JSON.stringify({
      locations: r.locations,
      per_source: r.per_source,
      anyError: r.anyError,
    }),
  );
}

main().catch((err) => {
  process.stderr.write(`[scrape-dining] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
