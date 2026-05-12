/**
 * One-shot catalog scrape. Run by build-worker-corpus.mjs via:
 *   npx tsx scripts/_scrape-catalog.ts
 *
 * Emits a single JSON blob to stdout (consumed by parent), all logs to stderr.
 * Mirrors scripts/_scrape-calendars.ts.
 *
 * Corpus rule: all data comes exclusively from catalog.msstate.edu.
 */

// Some upstream deps (cheerio plugins, future pdf-parse) may use console.log.
// Redirect to stderr so stdout stays clean JSON.
// eslint-disable-next-line no-console
console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

import { scrapeAllCourses } from "../msstate-policies/src/courses/scraper.js";

async function main(): Promise<void> {
  process.stderr.write("[scrape-catalog] starting full scrape\n");
  const result = await scrapeAllCourses();
  process.stderr.write(
    `[scrape-catalog] ${Object.keys(result.records).length} courses, ` +
    `${Object.keys(result.forward_dag).length} forward roots, ` +
    `${Object.keys(result.reverse_dag).length} reverse roots\n`,
  );
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stderr.write(
    `[scrape-catalog] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
