#!/usr/bin/env node
/**
 * Query the Worker telemetry Analytics Engine dataset and print an aggregate
 * summary. Enforces k-anonymity: cells with fewer than K=5 events in the
 * window are suppressed from output entirely.
 *
 * Requires:
 *   CLOUDFLARE_API_TOKEN  - token with "Account Analytics: Read" scope
 *   CF_ACCOUNT_ID         - Cloudflare account ID (find in dashboard URL)
 *
 * Usage:
 *   node scripts/telemetry-summary.mjs                    # last 7 days, by day
 *   node scripts/telemetry-summary.mjs --days 30          # last 30 days, by day
 *   node scripts/telemetry-summary.mjs --by-tool          # tool histogram, 7d
 *   node scripts/telemetry-summary.mjs --by-country       # country-bucket histogram, 7d
 *   node scripts/telemetry-summary.mjs --days 30 --by-tool
 *
 * Privacy contract (see PRIVACY.md):
 *   - Queries are aggregate-only; no per-event records returned.
 *   - HAVING calls >= 5 suppresses cells that could identify single users.
 *   - Output goes to stdout for the maintainer; never committed to repo
 *     without a separate k-anonymity check.
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CF_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) {
  console.error("Set CLOUDFLARE_API_TOKEN and CF_ACCOUNT_ID environment variables.");
  console.error("Example: export $(grep -E '^(CLOUDFLARE_API|CF_ACCOUNT_ID)' .env | xargs)");
  process.exit(1);
}

const args = process.argv.slice(2);

function parseDays() {
  const idx = args.indexOf("--days");
  const raw = idx >= 0 ? args[idx + 1] : "7";
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    console.error(`--days must be an integer in [1, 365] (got: ${raw})`);
    process.exit(1);
  }
  return n;
}

const days = parseDays();
const byTool = args.includes("--by-tool");
const byCountry = args.includes("--by-country");

if (byTool && byCountry) {
  console.error("Pass at most one of --by-tool / --by-country.");
  process.exit(1);
}

// k-anonymity threshold: suppress any cell with fewer than K events in the window.
const K = 5;

// Worker recordEvent writes:  blobs=[toolName, countryBucket], doubles=[ok], indexes=[date]
// Cloudflare AE exposes these as blob1, blob2, double1, index1.
const sql = byTool
  ? `SELECT blob1 AS tool, count() AS calls
     FROM msstate_mcp_events
     WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
     GROUP BY tool
     HAVING calls >= ${K}
     ORDER BY calls DESC
     FORMAT JSON`
  : byCountry
  ? `SELECT blob2 AS country_bucket, count() AS calls
     FROM msstate_mcp_events
     WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
     GROUP BY country_bucket
     HAVING calls >= ${K}
     ORDER BY calls DESC
     FORMAT JSON`
  : `SELECT toDate(timestamp) AS day, count() AS calls
     FROM msstate_mcp_events
     WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
     GROUP BY day
     HAVING calls >= ${K}
     ORDER BY day
     FORMAT JSON`;

process.stderr.write(`[telemetry-summary] querying last ${days} days, mode=${byTool ? "by-tool" : byCountry ? "by-country" : "by-day"}, k-anonymity threshold=${K}\n`);

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/sql",
    },
    body: sql,
  },
);

if (!res.ok) {
  console.error(`[telemetry-summary] HTTP ${res.status} from Cloudflare AE`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
console.log(JSON.stringify(data.data ?? data, null, 2));
