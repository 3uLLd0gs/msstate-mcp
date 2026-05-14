/**
 * Dining HTML parsers.
 *
 * Two parsers:
 *   parseSitemapLocations - cheerio against /en/sitemap (server-rendered HTML)
 *   parseLocationHoursDom - cheerio against POST-Playwright DOM string (NOT raw shell)
 */
import { load as cheerioLoad } from "cheerio";
import {
  LOCATION_SLUG_RE,
  type DiningIndexEntry,
} from "./types.js";

const LOCATION_HREF_RE = /^\/en\/location\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i;

/**
 * Extract location index entries from the Touchpoint sitemap.
 *
 * The page renders a flat list of <a href="/en/location/<slug>"> elements.
 * We dedupe by slug and skip the "Locations & Menus" parent link.
 */
export function parseSitemapLocations(
  html: string,
  _pageUrl: string,
): DiningIndexEntry[] {
  const $ = cheerioLoad(html);
  const out: DiningIndexEntry[] = [];
  const seen = new Set<string>();

  $("a[href^='/en/location/']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(LOCATION_HREF_RE);
    if (!m) return;
    const slug = m[1];
    if (!LOCATION_SLUG_RE.test(slug)) return;
    if (seen.has(slug)) return;

    const name = $(a).text().replace(/\s+/g, " ").trim();
    if (name.length === 0) return;

    seen.add(slug);
    out.push({
      slug,
      name,
      url: `https://msstatedining.mydininghub.com/en/location/${slug}`,
    });
  });

  return out;
}
