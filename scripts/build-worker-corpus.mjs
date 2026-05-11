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

// N7: detect WAF / antibot challenge pages so a transient interstitial during
// build doesn't silently poison corpus.json. Mirrors the runtime scraper's
// looksLikeWafChallenge in msstate-policies/src/http.ts. Required before
// any future M6 (auto-rebuild) cron lands.
function looksLikeWafChallenge(body) {
  if (body.includes("Just a moment...")) return true; // Cloudflare interstitial
  if (body.includes("cf-chl-bypass")) return true;
  if (/<meta\s+http-equiv=["']refresh["'][^>]+url=[^>]*token=/i.test(body)) return true;
  // F5 antibot served a bare shell with no data table
  const isAntibotShell =
    /<form[^>]+class=["'][^"']*antibot/i.test(body) &&
    !/id=["']datatable["']/.test(body);
  return isAntibotShell;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (looksLikeWafChallenge(text)) {
    throw new Error(
      `WAF / antibot challenge detected for ${url} — refusing to ship a poisoned corpus`,
    );
  }
  return text;
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

async function scrapeCalendarsViaSubprocess() {
  const { execFileSync } = await import("node:child_process");
  console.error("[build-worker-corpus] scraping calendars (6 sources)...");
  const out = execFileSync(
    "npx",
    ["--yes", "tsx", "scripts/_scrape-calendars.ts"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const payload = JSON.parse(out.toString("utf8"));
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error(
      "calendar scrape: malformed payload — refusing to ship a poisoned calendar corpus",
    );
  }
  if (payload.rows.length === 0) {
    throw new Error(
      "calendar scrape returned 0 rows — refusing to ship a poisoned calendar corpus",
    );
  }
  for (const [source, info] of Object.entries(payload.per_source)) {
    if (info.error) {
      throw new Error(
        `calendar scrape: ${source} failed with: ${info.error} — refusing to ship a poisoned calendar corpus`,
      );
    }
    if (info.row_count === 0) {
      throw new Error(
        `calendar scrape: ${source} returned 0 rows — refusing to ship a poisoned calendar corpus`,
      );
    }
  }
  console.error(
    `[build-worker-corpus]   total calendar rows: ${payload.rows.length}`,
  );
  for (const [source, info] of Object.entries(payload.per_source)) {
    console.error(`[build-worker-corpus]   ${source}: ${info.row_count}`);
  }
  return payload;
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
  const builtAt = new Date().toISOString();
  const out = {
    builtAt,
    source: `${BASE}/current`,
    indexRowCount: rows.length,
    policies,
  };

  const calendarPayload = await scrapeCalendarsViaSubprocess();
  out.academic_calendar = {
    rows: calendarPayload.rows,
    per_source: calendarPayload.per_source,
    built_at: builtAt,
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
