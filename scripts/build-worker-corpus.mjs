#!/usr/bin/env node
/**
 * Build worker/corpus.json — pre-extracted policy text for the
 * Cloudflare Worker variant.
 *
 * Workers have no node:fs and a 10-25 MB compressed bundle limit,
 * so the Worker can't run pdf-parse at request time. Instead, this
 * script does the scrape + parse offline and ships a static JSON
 * snapshot of all 218 policies' text + metadata, which the Worker
 * imports and serves via BM25 search.
 *
 * Run periodically (weekly is plenty) to keep the Worker corpus
 * fresh against MSU policy updates. Re-deploy after each rebuild.
 *
 *   node scripts/build-worker-corpus.mjs
 *
 * No env vars required. Hits policies.msstate.edu directly.
 *
 * Corpus rule: text comes only from policies.msstate.edu PDFs.
 * Same constraint as build-embeddings.mjs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as cheerioLoad } from "cheerio";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const BASE = "https://www.policies.msstate.edu";
const UA = "msstate-policies-mcp/0.2.0 (build-worker-corpus)";
const POLICY_NUMBER_RE = /^\d{2}\.(\d{2}|\d{3})$/;

// Same metadata patterns as src/scraper.ts so the Worker corpus matches
// what the stdio server would have returned.
const METADATA_PATTERNS = [
  ["effectiveDate", /effective\s+date\s*[:\-]\s*(.+)/i],
  ["reviewedDate", /reviewed(?:\s+date)?\s*[:\-]\s*(.+)/i],
  ["lastRevisedDate", /(?:last\s+)?revised(?:\s+date)?\s*[:\-]\s*(.+)/i],
  ["responsibleOffice", /responsible\s+office\s*[:\-]\s*(.+)/i],
  ["approvedBy", /approved\s+by\s*[:\-]\s*(.+)/i],
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractMetadata(text) {
  const meta = {
    effectiveDate: null,
    reviewedDate: null,
    lastRevisedDate: null,
    responsibleOffice: null,
    approvedBy: null,
  };
  // Scan only the first ~60 lines — MSU policies put metadata near the top.
  const head = text.split("\n").slice(0, 60).join("\n");
  for (const [key, rx] of METADATA_PATTERNS) {
    const m = head.match(rx);
    if (m && m[1]) {
      meta[key] = m[1].trim().replace(/\s+/g, " ").slice(0, 200);
    }
  }
  return meta;
}

function absolutize(href) {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE + href;
  return `${BASE}/${href}`;
}

async function main() {
  console.error("build-worker-corpus: fetching index...");
  const html = await fetchText(`${BASE}/current`);
  const $ = cheerioLoad(html);

  const rows = [];
  $("#datatable tbody tr").each((_i, tr) => {
    const $tr = $(tr);
    const number = $tr.find("td:nth-child(1)").text().trim();
    if (!POLICY_NUMBER_RE.test(number)) return;
    const slug = number.replace(/\./g, "");
    const titleAnchor = $tr.find("td:nth-child(2) a").first();
    const title = titleAnchor.text().trim();
    const landingHref = titleAnchor.attr("href") ?? "";
    const pdfHref = $tr.find("td:last-child a.btn-download").attr("href") ?? "";
    if (!title || !landingHref || !pdfHref) return;
    const status = $tr.find("td:nth-child(3) .badge").text().trim() || "";
    const dt = $tr.find("td:nth-child(4) time").attr("datetime") ?? null;

    rows.push({
      number,
      slug,
      title,
      landingUrl: absolutize(landingHref),
      pdfUrl: absolutize(pdfHref),
      status,
      firstAuthoredOrSorted: dt,
    });
  });

  console.error(`build-worker-corpus: ${rows.length} policies in index`);

  const policies = [];
  let i = 0;
  for (const row of rows) {
    i++;
    try {
      const buf = await fetchBuffer(row.pdfUrl);
      const parsed = await pdfParse(buf);
      const text = (parsed.text || "").normalize("NFKC").trim();
      if (text.length < 200) {
        console.error(
          `build-worker-corpus: skip ${row.number} (text too short: ${text.length} chars)`,
        );
        continue;
      }
      const meta = extractMetadata(text);
      policies.push({
        number: row.number,
        slug: row.slug,
        title: row.title,
        landingUrl: row.landingUrl,
        pdfUrl: row.pdfUrl,
        status: row.status,
        firstAuthoredOrSorted: row.firstAuthoredOrSorted,
        text,
        effectiveDate: meta.effectiveDate,
        reviewedDate: meta.reviewedDate,
        lastRevisedDate: meta.lastRevisedDate,
        responsibleOffice: meta.responsibleOffice,
        approvedBy: meta.approvedBy,
      });
      if (i % 25 === 0) {
        console.error(`build-worker-corpus: extracted ${i}/${rows.length}`);
      }
    } catch (err) {
      console.error(
        `build-worker-corpus: skip ${row.number}: ${err.message ?? err}`,
      );
    }
  }
  console.error(
    `build-worker-corpus: ${policies.length}/${rows.length} policies usable`,
  );

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "worker");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "corpus.json");
  const out = {
    builtAt: new Date().toISOString(),
    source: `${BASE}/current`,
    indexRowCount: rows.length,
    policies,
  };
  writeFileSync(outPath, JSON.stringify(out));
  const bytes = JSON.stringify(out).length;
  console.error(
    `build-worker-corpus: wrote ${outPath} — ${policies.length} policies, ${(bytes / 1024 / 1024).toFixed(2)} MB raw`,
  );
}

main().catch((err) => {
  console.error("build-worker-corpus: fatal", err);
  process.exit(1);
});
