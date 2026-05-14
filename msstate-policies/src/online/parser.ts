/**
 * Online module — HTML parsers.
 *
 * Each function returns verbatim text from online.msstate.edu pages. The
 * scraper attaches `retrieved_at` and `url` after parsing.
 *
 * Selector strategy for parseAcademicProgramsIndex:
 *   The /academic-programs fixture is a flat Drupal Views grid — all programs
 *   are rendered as `.Prg-card` elements with no section headings separating
 *   degree levels. The slug comes from the `prg-card-top` anchor href, the
 *   name from `.Prg-card-title h2`, and the degree level is inferred from the
 *   name text itself using LEVEL_NAME_MAP. This differs from the plan's
 *   starter-code assumption of "h2/h3 headings + anchors in document order".
 */
import { load as cheerioLoad } from "cheerio";
import type { DegreeLevel } from "./types.js";

/** Ordered rules: program name text → DegreeLevel. */
const LEVEL_NAME_MAP: Array<[RegExp, DegreeLevel]> = [
  [/\bDoctor\b/i, "doctoral"],
  [/\bEducational Specialist\b/i, "specialist"],
  [/\bMaster\b/i, "master"],
  [/\bBachelor\b/i, "bachelor"],
  [/\bEndorsement\b/i, "endorsement"],
  [/\bCertificate\b/i, "certificate"],
];

export interface ProgramIndexEntry {
  slug: string;
  name: string;
  degree_level: DegreeLevel;
}

/**
 * Parse /academic-programs into a list of { slug, name, degree_level } entries.
 *
 * The page renders all programs in a single flat Drupal Views grid. Each
 * program card (`div.Prg-card`) contains:
 *   - `div.prg-card-top > a[href]` — the canonical slug link, e.g. `/mba`
 *   - `div.Prg-card-title h2` — the full program name
 *
 * Degree level is inferred from the name text using LEVEL_NAME_MAP above;
 * cards whose names do not match any rule are skipped with no error.
 */
export function parseAcademicProgramsIndex(
  html: string,
  _pageUrl: string,
): ProgramIndexEntry[] {
  const $ = cheerioLoad(html);
  const out: ProgramIndexEntry[] = [];
  const seenSlugs = new Set<string>();

  $("div.Prg-card").each((_, card) => {
    const $card = $(card);

    // Slug: from the top anchor href — must be a simple /slug path
    const topHref = $card.find("div.prg-card-top a[href]").first().attr("href") ?? "";
    const slugMatch = topHref.match(/^\/([a-z][a-z0-9-]*)$/i);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    if (seenSlugs.has(slug)) return;

    // Name: from the Prg-card-title h2, decode HTML entities via cheerio text()
    const name = $card.find("div.Prg-card-title h2").text().replace(/\s+/g, " ").trim();
    if (name.length === 0) return;

    // Degree level: inferred from the name
    let degree_level: DegreeLevel | null = null;
    for (const [re, level] of LEVEL_NAME_MAP) {
      if (re.test(name)) {
        degree_level = level;
        break;
      }
    }
    if (degree_level === null) return;

    seenSlugs.add(slug);
    out.push({ slug, name, degree_level });
  });

  return out;
}
