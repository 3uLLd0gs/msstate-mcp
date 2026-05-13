import { load as cheerioLoad } from "cheerio";
import type { FaqRow } from "./types.js";

const RETRIEVED_AT_PLACEHOLDER = "1970-01-01T00:00:00.000Z";

/**
 * Parse the tuition FAQ page. Returns one FaqRow per Q&A pair.
 *
 * The page uses a Bootstrap accordion rendered by Drupal:
 *   div.accordion-item
 *     h2.accordion-header[id="panels-heading--NNN--slug"]
 *       button.accordion-button   <- question text lives here
 *     div.accordion-collapse[id="panels-collapse--NNN--slug"]
 *       div.accordion-body        <- answer text lives here
 *
 * Each accordion-item maps to exactly one FaqRow. The anchor link uses the
 * id from h2.accordion-header (the heading id, not the collapse panel id).
 *
 * `retrieved_at` is left as a placeholder — the scraper overwrites it.
 */
export function parseFaqHtml(html: string, pageUrl: string): FaqRow[] {
  const $ = cheerioLoad(html);
  const out: FaqRow[] = [];
  const seen = new Set<string>();

  $(".accordion-item").each((_, item) => {
    const $item = $(item);

    // Question: text of the button inside h2.accordion-header
    const $button = $item.find("h2.accordion-header button.accordion-button");
    if (!$button.length) return;

    const question = $button.text().replace(/\s+/g, " ").trim();
    if (question.length < 5) return;
    if (seen.has(question)) return;
    seen.add(question);

    // Answer: text of the accordion body
    const $body = $item.find(".accordion-body");
    if (!$body.length) return;

    // Preserve paragraph breaks in the answer (questions collapse all whitespace; answers don't)
    const answer = $body.text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (answer.length < 1) return;

    // Anchor: use the id on h2.accordion-header (not the collapse panel id)
    const headingId = $item.find("h2.accordion-header").attr("id");
    const source_url = headingId ? `${pageUrl}#${headingId}` : pageUrl;

    out.push({
      question,
      answer,
      source_url,
      retrieved_at: RETRIEVED_AT_PLACEHOLDER,
    });
  });

  return out;
}
