#!/usr/bin/env node
/**
 * One-time fixture capture for dining-parser tests.
 *
 * Run: `node scripts/_capture-dining-fixtures.mjs`
 *
 * Launches real Playwright (chromium), navigates Touchpoint pages, and writes
 * the post-render DOM to msstate-policies/tests/fixtures/dining/. Re-run only
 * when MSU/Touchpoint structurally changes the page and parser tests start
 * failing against the live data.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const FIXTURES = resolve(process.cwd(), "msstate-policies/tests/fixtures/dining");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function capture(page, url, filename) {
  console.error(`[capture] ${url} -> ${filename}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) {
      window.scrollBy(0, 600);
      await new Promise((r) => setTimeout(r, 300));
    }
  });
  await page.waitForTimeout(800);
  const html = await page.content();
  writeFileSync(resolve(FIXTURES, filename), html, "utf8");
  console.error(`[capture]   wrote ${html.length} bytes`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      extraHTTPHeaders: { "X-Source": "msstate-policies-mcp/fixture-capture" },
    });
    const page = await ctx.newPage();

    await capture(
      page,
      "https://msstatedining.mydininghub.com/en/sitemap",
      "en-sitemap.html",
    );

    await capture(
      page,
      "https://msstatedining.mydininghub.com/en/location/perry-cafeteria",
      "rendered-perry.html",
    );
    await capture(
      page,
      "https://msstatedining.mydininghub.com/en/location/chick-fil-a",
      "rendered-chickfila.html",
    );
    await capture(
      page,
      "https://msstatedining.mydininghub.com/en/location/bento-sushi",
      "rendered-no-hours.html",
    );

    await ctx.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[capture] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
