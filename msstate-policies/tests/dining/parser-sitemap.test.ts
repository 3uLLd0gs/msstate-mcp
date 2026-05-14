import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSitemapLocations } from "../../src/dining/parser.js";
import { LOCATION_SLUG_RE } from "../../src/dining/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, "..", "fixtures", "dining", "en-sitemap.html"),
  "utf8",
);
const PAGE_URL = "https://msstatedining.mydininghub.com/en/sitemap";

describe("parseSitemapLocations", () => {
  test("extracts at least 20 location entries (live baseline ~30)", () => {
    const entries = parseSitemapLocations(FIXTURE, PAGE_URL);
    assert.ok(entries.length >= 20, `got ${entries.length} entries`);
  });

  test("each entry has slug + name + url, slug matches LOCATION_SLUG_RE", () => {
    const entries = parseSitemapLocations(FIXTURE, PAGE_URL);
    for (const e of entries) {
      assert.match(e.slug, LOCATION_SLUG_RE, `bad slug: ${e.slug}`);
      assert.ok(e.name.length > 0, `empty name for ${e.slug}`);
      assert.equal(
        e.url,
        `https://msstatedining.mydininghub.com/en/location/${e.slug}`,
      );
    }
  });

  test("slugs are unique", () => {
    const entries = parseSitemapLocations(FIXTURE, PAGE_URL);
    const seen = new Set<string>();
    for (const e of entries) {
      assert.ok(!seen.has(e.slug), `duplicate slug: ${e.slug}`);
      seen.add(e.slug);
    }
  });

  test("includes well-known venues (Chick-fil-A and one Maroon Market)", () => {
    const entries = parseSitemapLocations(FIXTURE, PAGE_URL);
    const slugs = new Set(entries.map((e) => e.slug));
    assert.ok(slugs.has("chick-fil-a"), "missing chick-fil-a");
    assert.ok([...slugs].some((s) => s.startsWith("maroon-market")), "missing any maroon-market-*");
  });

  test("returns [] on input with no <a href=/en/location/...> links", () => {
    const empty = parseSitemapLocations(
      "<html><body><p>nothing here</p></body></html>",
      PAGE_URL,
    );
    assert.deepEqual(empty, []);
  });
});
