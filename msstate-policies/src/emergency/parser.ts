/**
 * Emergency-site HTML → structured rows.
 *
 * Three parsers exposed:
 *  - parseGuidelineHtml(html, slug)   → guideline body
 *  - parseRefugeHtml(html)            → refuge table  (stub here; filled in Task 3)
 *  - parseContactsHtml(html)          → contacts list (stub here; filled in Task 4)
 *
 * Each parser returns rows without retrieved_at / aliases / source_url. The
 * scraper attaches those.
 */
import { load as cheerioLoad } from "cheerio";
import type { Element } from "domhandler";
import type { GuidelineRow, RefugeRow, ContactRow } from "./types.js";

const EMERGENCY_HOST = "https://www.emergency.msstate.edu";

type CheerioAPI = ReturnType<typeof cheerioLoad>;

/** Walk a single element to a 1-N markdown line block. Headings -> "## H";
 *  <ul>/<ol> -> "- item" lines; <p> and other -> plain text line(s). */
function nodeToMarkdown($: CheerioAPI, el: Element): string[] {
  const tag = (el.tagName ?? "").toLowerCase();
  const text = $(el).text().trim().replace(/\s+/g, " ");
  if (!text && tag !== "ul" && tag !== "ol") return [];
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag.slice(1), 10);
    return [`${"#".repeat(level)} ${text}`];
  }
  if (tag === "p") return [text];
  if (tag === "ul" || tag === "ol") {
    const items: string[] = [];
    $(el).find("> li").each((_, li) => {
      const liText = $(li).text().trim().replace(/\s+/g, " ");
      if (liText) items.push(`- ${liText}`);
    });
    return items;
  }
  return text ? [text] : [];
}

export function parseGuidelineHtml(
  html: string,
  slug: string,
): Omit<GuidelineRow, "retrieved_at" | "aliases"> | null {
  const $ = cheerioLoad(html);
  const main = $("main").first();
  if (main.length === 0) return null;

  const title =
    main.find("h1.page-title").first().text().trim().replace(/\s+/g, " ") ||
    main.find("h1").first().text().trim().replace(/\s+/g, " ");
  if (!title) return null;

  const blocks: string[] = [];
  main.find("> *, > div > *").each((_, el) => {
    const t = ((el as Element).tagName ?? "").toLowerCase();
    if (t === "h1") return; // title already captured
    const md = nodeToMarkdown($, el);
    for (const line of md) blocks.push(line);
  });
  const body_markdown = blocks.join("\n\n").trim();

  return {
    slug,
    title,
    url: `${EMERGENCY_HOST}/guidelines/${slug}`,
    body_markdown,
  };
}

export function parseRefugeHtml(html: string): Omit<RefugeRow, "retrieved_at" | "source_url">[] {
  const $ = cheerioLoad(html);
  const main = $("main").first();
  if (main.length === 0) return [];
  const table = main.find("table").first();
  if (table.length === 0) return [];

  // Build a glyph → legend-text map by scanning paragraphs for "<glyph> <text>" patterns.
  // Only single non-alphanumeric leading glyphs are recognised (*, †, ‡, §).
  const legend = new Map<string, string>();
  main.find("p").each((_, p) => {
    const text = $(p).text().trim().replace(/\s+/g, " ");
    const m = text.match(/^(?:Buildings?\s+marked\s+with\s+)?([*†‡§])\s+(?:are\s+|=\s*)?(.+)$/i);
    if (m) {
      const note = m[2].replace(/[.\s]+$/, "");
      legend.set(m[1], note.charAt(0).toUpperCase() + note.slice(1) + ".");
    }
  });

  const rows: Omit<RefugeRow, "retrieved_at" | "source_url">[] = [];
  table.find("tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    const rawBuilding = $(cells.get(0)).text().trim().replace(/\s+/g, " ");
    const area = $(cells.get(1)).text().trim().replace(/\s+/g, " ");
    if (!rawBuilding || !area) return;
    const glyphMatch = rawBuilding.match(/^(.*?)([*†‡§])$/);
    if (glyphMatch) {
      const cleanBuilding = glyphMatch[1].trim();
      const glyph = glyphMatch[2];
      rows.push({ building: cleanBuilding, area, note: legend.get(glyph) ?? null });
    } else {
      rows.push({ building: rawBuilding, area, note: null });
    }
  });
  return rows;
}

export function parseContactsHtml(html: string): Omit<ContactRow, "retrieved_at" | "source_url">[] {
  const $ = cheerioLoad(html);
  const main = $("main").first();
  if (main.length === 0) return [];

  // Find the "Important Contacts" heading and walk forward through its siblings.
  const anchor = main.find("h3").filter((_, h) =>
    /important contacts/i.test($(h).text())
  ).first();
  if (anchor.length === 0) return [];

  const rows: Omit<ContactRow, "retrieved_at" | "source_url">[] = [];
  let category: ContactRow["category"] = "emergency"; // first <ul> after the h3 is emergency

  anchor.nextAll().each((_, el) => {
    const tag = ((el as Element).tagName ?? "").toLowerCase();
    if (tag === "h4") {
      const t = $(el).text().toLowerCase();
      if (t.includes("off campus") || t.includes("off-campus")) {
        category = "off_campus_non_emergency";
      } else if (t.includes("campus")) {
        category = "campus_non_emergency";
      }
      return;
    }
    if (tag === "ul") {
      $(el).find("> li").each((_, li) => {
        const label = $(li).find("a").first().text().trim().replace(/\s+/g, " ");
        const phone = $(li).find("strong").first().text().trim().replace(/\s+/g, " ");
        if (!label || !phone) return;
        // Drop ":" from a label like "EMERGENCY: 911" and trim.
        const cleanLabel = label.replace(/:\s*\d+\s*$/, "").trim();
        rows.push({ label: cleanLabel, phone, category });
      });
    }
  });
  return rows;
}
