# Worker Telemetry + Privacy Policy — Plan

**Date:** 2026-05-18
**Goal:** Add anonymous aggregate usage telemetry to the Cloudflare Worker so we can answer "is anyone using this?" without compromising the zero-PII contract. Ship the corresponding privacy policy.

**Why now:** Four versions shipped, zero usage signal. Per the multi-perspective evaluation, this is the highest-leverage missing piece before any next-tool decision.

---

## 0. Design decisions (defaults set — override if needed)

| # | Decision | Default | Rationale |
|---|---|---|---|
| D1 | Telemetry backend | **Cloudflare Workers Analytics Engine** (AE) | Free up to 25 events/sec/script and ~10M events/month. Designed for exactly this. SQL queryable. No external dependency. |
| D2 | What to record per request | `(date, tool_name, ok, country_bucket)` | Minimum signal that answers "any users?" + "which tools matter?" + rough geography. **`country_bucket` is regionalized — `US / NA-other / EU / Other` — NOT raw country code.** Raw country at small volumes is a quasi-identifier. No IPs, no payloads, no user identifiers, no timestamps below day granularity. |
| D3 | How we view the data | Cloudflare dashboard SQL queries + a `scripts/telemetry-summary.mjs` helper that **enforces k-anonymity (suppresses any cell where N<5)**. | Private viewer. No public dashboard. Monthly snapshots committed to repo are deferred until 3+ months of data exist and k-anonymity rules are explicit. |
| D4 | Privacy doc shape | **New `PRIVACY.md` at repo root + cross-reference from `SECURITY.md` and `README.md`** | Telemetry adds a real data-collection surface; deserves its own document, not buried in security. |
| D5 | Opt-out mechanism | **Server-side flag `TELEMETRY_DISABLED=1`** environment var; per-request opt-out is impossible because the recording happens server-side. Document this clearly in `PRIVACY.md` + a comment in `wrangler.toml`. | The MCP protocol has no client opt-out hook for anonymous server-side aggregate counts. The recording IS the product's analytics. Honest framing: "if you use the Worker, anonymous aggregate counts are recorded; if that's not acceptable, use the npm/plugin install which records nothing." |
| D6 | When to record | **Single event per tool call: `completed` with `ok: bool`.** Originally the plan called for two events (`received` + `completed`) but that doubles AE volume for marginal value — Worker crashes mid-dispatch are <0.1% of requests under current defensive try/catch coverage, and the `ok=1` placeholder on `received` confuses naive queries. Drop. | One event per call. `ok=true` only set after dispatch returns successfully. |
| D7 | Success threshold (pre-commit) | **≥5 unique-day requests/week for ≥4 consecutive weeks** = "real usage, continue investing". <5/week for 8 consecutive weeks = "consider archiving the project". | Pre-commit BEFORE seeing data to avoid hindsight bias. Numbers can move with explicit justification; the discipline is committing now. |
| D8 | Semver impact | **`1.1.2 → 1.2.0` minor bump** (originally drafted as patch). Adding a data-collection surface changes the user contract; users with subscribed update flows deserve the heads-up of a minor bump, not silent patch. | Style call: minor bumps invite scrutiny; patches don't. Privacy-sensitive change → minor. |

---

## 1. Architecture

```
                                        ┌──────────────────────────┐
   POST /mcp tools/call get_msu_date   │  Cloudflare Worker /mcp  │
   ──────────────────────────────────►│  src/index.ts            │
                                        │                          │
                                        │  ┌────────────────────┐  │
                                        │  │ recordEvent(...)   │  │
                                        │  │ writeDataPoint     │  │
                                        │  │   blobs: [tool]    │  │
                                        │  │   doubles: [ok]    │  │
                                        │  │   indexes: [dateKey]│ │
                                        │  └─────────┬──────────┘  │
                                        │            │             │
                                        │  ┌─────────▼──────────┐  │
                                        │  │ existing dispatch  │  │
                                        │  └────────────────────┘  │
                                        └──────────────────────────┘
                                                     │
                                                     ▼
                                       ┌────────────────────────────┐
                                       │ Cloudflare Analytics Engine│
                                       │ dataset: msstate_mcp_events│
                                       │                            │
                                       │ Query via SQL API:         │
                                       │   SELECT date, tool, count │
                                       │   FROM dataset GROUP BY ...│
                                       └────────────────────────────┘
```

Key invariants:
- `request.cf.country` is read but only the country code is written (already aggregated at the CF edge — no IP at the Worker).
- No payload bytes are recorded.
- No timestamps below day granularity (`date` = `YYYY-MM-DD` UTC).
- No user-agent / session / cookies.

---

## 2. Implementation tasks

### Task 1 — wrangler.toml + AE binding

**Files:**
- Modify: `worker/wrangler.toml`

Add:

```toml
[[analytics_engine_datasets]]
binding = "TELEMETRY"
dataset = "msstate_mcp_events"
```

This makes `env.TELEMETRY` available in the Worker handler.

### Task 2 — Worker recording helper

**Files:**
- Modify: `worker/src/index.ts`

Add a single helper near the top (after the existing constant declarations):

```typescript
interface TelemetryEnv {
  TELEMETRY?: {
    writeDataPoint: (data: {
      blobs?: string[];
      doubles?: number[];
      indexes?: string[];
    }) => void;
  };
  TELEMETRY_DISABLED?: string;
}

function bucketCountry(raw: string | undefined | null): "US" | "NA-other" | "EU" | "Other" | "??" {
  if (!raw) return "??";
  if (raw === "US") return "US";
  if (raw === "CA" || raw === "MX") return "NA-other";
  const EU = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","GB"]);
  if (EU.has(raw)) return "EU";
  return "Other";
}

function recordEvent(
  env: TelemetryEnv,
  request: Request,
  toolName: string,
  ok: boolean,
): void {
  if (env.TELEMETRY_DISABLED === "1") return;
  if (!env.TELEMETRY) return;
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const country = (request as Request & { cf?: { country?: string } }).cf?.country;
  const bucket = bucketCountry(country);
  try {
    env.TELEMETRY.writeDataPoint({
      blobs: [toolName, bucket],
      doubles: [ok ? 1 : 0],
      indexes: [date],
    });
  } catch {
    // Telemetry failure is never propagated — recording is best-effort.
  }
}
```

Then thread `env` through the request handler (Workers signature change) and call **once per tool call, after dispatch returns**:

```typescript
recordEvent(env, request, toolName, !response.error);
```

We dropped the originally-planned `received` event (see D6) — single event per call halves AE volume and removes the misleading `ok=1` placeholder.

### Task 3 — Helper script for maintainer queries

**Files:**
- Create: `scripts/telemetry-summary.mjs`

```javascript
#!/usr/bin/env node
/**
 * Query the Worker telemetry Analytics Engine dataset and print a daily summary.
 *
 * Requires CLOUDFLARE_API_TOKEN with "Analytics Engine: Read" + account ID.
 * Set CF_ACCOUNT_ID in .env.
 *
 * Usage:
 *   node scripts/telemetry-summary.mjs              # last 7 days
 *   node scripts/telemetry-summary.mjs --days 30    # last 30 days
 *   node scripts/telemetry-summary.mjs --by-tool    # per-tool histogram
 */
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CF_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) {
  console.error("Set CLOUDFLARE_API_TOKEN and CF_ACCOUNT_ID");
  process.exit(1);
}

const rawDays = process.argv.includes("--days") ? process.argv[process.argv.indexOf("--days") + 1] : "7";
const days = parseInt(rawDays, 10);
if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error("--days must be an integer 1-365");
  process.exit(1);
}
const byTool = process.argv.includes("--by-tool");
const K = 5; // k-anonymity threshold: suppress cells with fewer than K events

// blob1 = tool, blob2 = country bucket (post-D6: single event per call, no phase field)
const sql = byTool
  ? `SELECT blob1 AS tool, count() AS calls
     FROM msstate_mcp_events
     WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
     GROUP BY tool
     HAVING calls >= ${K}
     ORDER BY calls DESC FORMAT JSON`
  : `SELECT toDate(timestamp) AS day, count() AS calls
     FROM msstate_mcp_events
     WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
     GROUP BY day
     HAVING calls >= ${K}
     ORDER BY day FORMAT JSON`;

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/sql" },
    body: sql,
  },
);
const data = await res.json();
console.log(JSON.stringify(data.data ?? data, null, 2));
```

### Task 4 — `PRIVACY.md` at repo root

**Files:**
- Create: `PRIVACY.md`

Full draft below in §5.

### Task 5 — Cross-references

**Files:**
- Modify: `README.md` — add a "Privacy" link near the top
- Modify: `SECURITY.md` — add a one-line pointer to `PRIVACY.md` in the in-scope/out-of-scope section
- Modify: `CLAUDE.md` — add a one-line note in the security section that telemetry is anonymous-aggregate only

### Task 6 — Deploy + verify

```bash
cd worker && npx --no-install wrangler deploy
curl -sS -X POST "https://msstate-policies-mcp.mminsub90.workers.dev/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' > /dev/null
sleep 60  # AE has a short ingest delay
node scripts/telemetry-summary.mjs --days 1
```

Expected: see at least 1 event in the dataset.

### Task 7 — Version bump + release

`1.1.2 → 1.2.0` **minor** (not patch — see D8; data-collection-surface change deserves the heads-up). Same flow:
- `sed` 4 sites (`1.1.2` → `1.2.0`)
- `npm run build`
- Commit
- Push, PR, CI, merge
- npm publish, wrangler deploy, tag

---

## 3. Privacy invariants (load-bearing — security-checklist enforces)

For the static checklist, add `TEL1`–`TEL4`:

| Check | Pts | Asserts |
|---|---|---|
| TEL1 | 2 | `recordEvent` exists in worker source AND its body (next ~20 lines after the function declaration) contains NO calls to `request.headers.get`, `request.url`, or anything from `cookies` / `body`. Scope: function body only, not whole file (the file legitimately uses `headers.get("content-length")` elsewhere). |
| TEL2 | 2 | `wrangler.toml` declares an `analytics_engine_datasets` binding named exactly `TELEMETRY` (binding name matches runtime contract). |
| TEL3 | 2 | `PRIVACY.md` exists at repo root AND contains the strings `Cloudflare Workers Analytics Engine`, `country_bucket`, `tool name`, `Last updated`. Catches the stale / hollow-shell case. |
| TEL4 | 2 | `bucketCountry` function present in scraper source AND maps raw country codes to one of `{US, NA-other, EU, Other, ??}` — verifies the k-anonymity-by-design choice didn't quietly drift back to raw country codes. |

These cement the privacy contract mechanically. +8 pts; new security baseline **292**.

---

## 4. Failure modes + edge cases

| Failure | Handling |
|---|---|
| AE write fails | Wrapped in try/catch; never propagates |
| AE dataset not provisioned on first deploy | **Need verification step** — added to Task 6: after first deploy, run a smoke request and confirm an event lands within 60s. If empty, the dataset wasn't auto-created; provision via Cloudflare dashboard before retrying. |
| User sends garbage to /mcp | Tool name is "unknown" → still recorded with `ok: false`; aggregate stays useful. |
| Cloudflare quota exceeded | AE silently drops events past the limit. CF free tier in 2026: 10M write ops/month + 25 events/sec — well above our worst-case at current usage. AE write ops are separate from the Workers 100k-requests/day quota. |
| Country header missing | Falls back to `??` bucket. |
| Country is spoofed (VPN / proxy) | Accept it; documented as "best-effort, not authoritative" in PRIVACY.md. |
| Worker error before recording starts | No telemetry; we see request count = 0 for that period even if users hit the endpoint. Acceptable trade-off — recording happens AFTER dispatch returns. |
| Cron workflow redeploys without AE binding | The binding is in `wrangler.toml`; cron workflows pick it up. But if the deploy account has AE disabled, writes silently fail. Add `set -e` + the post-deploy smoke check to both workflows. |
| Traffic drops to zero for a week | Currently no alerting. Cheap follow-up: weekly cron + email if 7-day count = 0. Tracked as a Tier 4 improvement, not blocking v1.2.0. |

---

## 5. PRIVACY.md draft

```markdown
# Privacy

**Last updated:** 2026-05-18 (v1.1.3+)

msstate-mcp is operated as an unofficial, open-source utility. This document
describes exactly what data the project collects, why, where it's stored, and
how to opt out. If any item below is more invasive than you're comfortable
with, the npm/plugin install records nothing — see §3.

---

## 1. What we collect (and what we don't)

The Cloudflare Worker at `https://msstate-policies-mcp.mminsub90.workers.dev/mcp`
records **anonymous aggregate** telemetry. Every tool call writes one or two
data points to Cloudflare Workers Analytics Engine:

**Recorded per request (one event per tool call, post-dispatch):**
| Field | Example | Why |
|---|---|---|
| date | `2026-05-18` (UTC, day granularity only) | To compute daily request counts |
| tool name | `find_msu_date` | To see which tools matter |
| outcome | `1` (success) or `0` (error) | To detect breakage |
| country bucket | `US`, `NA-other`, `EU`, `Other`, `??` | Rough geographic signal — NOT raw country code (raw country at small volumes is a quasi-identifier). |

Aggregate queries enforce **k-anonymity (N≥5)** — cells with fewer than 5 events in the window are suppressed entirely. Combined with the bucketed country, this prevents the dataset from identifying any single user even at very small volumes.

**Explicitly NOT recorded:**
- The query string / question content
- IP addresses (the country is derived at the Cloudflare edge before the
  Worker sees it; the IP itself never reaches our code)
- User agents
- Session or cookie data
- Sub-day timestamps
- Response bodies
- Anything that could identify a person or a single user across requests

No personal data is ever stored or transmitted to third parties beyond
Cloudflare itself.

## 2. Why we collect it

We need to know whether anyone is using the Worker. Without aggregate
counts, every product decision (which tool to build next, whether to keep
maintaining the project, whether to invest in distribution) is speculation.
The minimum signal that answers "is this useful to anyone?" is the daily
request count by tool — and that's exactly what we record.

We do NOT use telemetry for:
- Advertising or marketing
- Selling data to anyone
- Personalization
- A/B testing
- User profiles

## 3. Surfaces and what each one records

| Surface | What it records | How to use without telemetry |
|---|---|---|
| **Cloudflare Worker** (claude.ai / ChatGPT connectors) | Anonymous aggregate only (above) | Use a different surface (npm or plugin) |
| **npm `msstate-policies-mcp`** (npx, Claude Code plugin) | **Nothing.** The bundle runs entirely on your machine; no outbound calls to us. | Already private. |

If you use the Worker, you generate one or two aggregate events. If you use
the npm bundle, you generate zero. The choice is yours.

## 4. Data retention

Cloudflare Workers Analytics Engine retains events for the duration of the
plan's retention policy (currently 90 days for the free tier; up to 90 days
on paid). We do not export or back up event data; when CF rotates it out,
it's gone.

## 5. Who can see the data

Only the project maintainer (currently mminsub90) — via the Cloudflare
dashboard or the `scripts/telemetry-summary.mjs` helper. The data is not
shared with MSU, third parties, or the public. If you'd like to see a
snapshot of aggregate counts, file an issue and we can publish a redacted
summary.

## 6. Opt-out

Per-request opt-out is not technically possible for anonymous aggregate
server-side counts — there is no header or flag a client can send to
prevent the Worker from incrementing a counter, because the increment
happens server-side before the client's preferences are read.

If telemetry of any kind is unacceptable to you, **use the npm install or
the Claude Code plugin**. Those record nothing.

## 7. What changes trigger a privacy-policy update

We commit to revising this document and bumping its "Last updated" date
whenever any of the following changes:
- The set of recorded fields
- The data retention period (including changes to Cloudflare's policy that
  our doc cites)
- The list of people with access
- The list of third parties involved
- The opt-out story
- The country-bucket scheme (e.g., if we ever decided to record raw
  country codes again, that's a privacy-policy-update event)
- The k-anonymity threshold in our query helper

The document is in version control. The full history is at
`https://github.com/3uLLd0gs/msstate-mcp/commits/main/PRIVACY.md`.

## 8. Out of scope

Two things this policy explicitly does NOT cover:

- **Your MCP client's behavior.** Claude.ai, ChatGPT, Cursor, Windsurf, Zed,
  Claude Code, etc. each have their own privacy policies. They may log your
  prompts. That's between you and them.
- **MSU's own privacy practices.** When you ask a question that triggers a
  tool call, we serve a cached snapshot of msstate.edu content. We do not
  contact MSU at request time. MSU's own privacy practices apply to anything
  you do directly with their sites.

## 9. Contact

Privacy questions: open a public issue at
`https://github.com/3uLLd0gs/msstate-mcp/issues`. For anything sensitive,
use the GitHub Security Advisory flow described in `SECURITY.md`.
```

---

## 6. Self-review

**Spec coverage:**
- Telemetry backend: D1 + Task 1 + Task 2 ✓
- What's recorded: D2 + Task 2 + PRIVACY.md §1 ✓
- How to view it: D3 + Task 3 ✓
- Privacy doc: D4 + Task 4 + PRIVACY.md draft ✓
- Opt-out: D5 + PRIVACY.md §6 ✓
- Phase: D6 + Task 2 ✓

**Placeholder scan:** no TBD / TODO / fill in details.

**Type consistency:** `recordEvent` signature matches in all three references (Task 2, TEL1 check, draft).

**Scope check:** single module, single Worker change, two new files, four MD edits. Right-sized for v1.1.3 patch.

---

## 7. Open questions before I start

| Q | Default |
|---|---|
| Cloudflare account ID — do you have one already, or new free account? | Existing (we deploy the Worker already; same account) |
| Country bucketing scheme — `US / NA-other / EU / Other / ??` correct? Or do you want a different bucketing (e.g., add MS for Mississippi-specific signal)? | The four-bucket scheme above. Adding a Mississippi bucket would require a state-level signal (CF only gives country) — defer. |
| Should `scripts/telemetry-summary.mjs` be a private one-off or tracked in repo? | Tracked. No secrets in the script itself; access requires CF_ACCOUNT_ID + token in .env. |
| Should we commit monthly aggregate snapshots back to the repo (e.g., `.dev/telemetry/2026-06.md`)? | Defer until ≥3 months of data exist AND we've defined explicit k-anonymity rules for any committed snapshot (no per-tool-per-day cell with N<5). |
| AE auto-provisioning verified? | NO — Task 6 now includes a post-deploy smoke check. If the dataset wasn't auto-created, we provision via dashboard before retrying. |
| Pre-commit success threshold | `≥5 unique-day requests/week for 4 weeks` = real usage; `<5 for 8 weeks` = consider archive. Committed in D7. |
| Semver impact | Minor bump (`1.1.2 → 1.2.0`), not patch — committed in D8. |

---

If the defaults look right, I'll execute the 7 tasks straight through.

---

## 8. Changelog of this plan (post-review)

This plan was reviewed on 2026-05-18 and edited inline. Summary of edits:

**Tier 1 — privacy / correctness:**
- D2: raw country → bucketed country (`US / NA-other / EU / Other / ??`)
- D3: query helper enforces k-anonymity (N≥5 cells only)
- D6: dropped the `received` phase event (was misleading + doubled volume)
- Task 2: `recordEvent` simplified to single event per call + `bucketCountry()` helper
- TEL1: scoped the "no headers in recordEvent" check to function body only (the file legitimately uses `headers.get("content-length")` for the 413 cap)
- TEL3: strengthened (PRIVACY.md must contain specific anchor strings)
- TEL4 added: `bucketCountry` mapping must remain in source (prevents quiet drift back to raw country)

**Tier 2 — robustness:**
- Task 6: added post-deploy AE-event smoke check (catches "dataset not provisioned" failure mode)
- `telemetry-summary.mjs`: input validation on `--days`; k-anonymity HAVING clause
- Failure-modes table: added AE-not-provisioned + cron-redeploy + zero-traffic-alert rows

**Tier 3 — honest framing:**
- D7 added: pre-committed success threshold (5/week × 4 weeks)
- D8 added: minor (not patch) bump for the data-collection-surface change
- PRIVACY.md §7: added Cloudflare retention-change + bucket-scheme-change as update triggers
- Open questions: removed "is country worth recording" (answered: only as bucket)

**Tier 4 — nice-to-have (deferred, not blocking v1.2.0):**
- Weekly zero-traffic alerting cron
- Unit test for `recordEvent` (Worker is single-file; testing requires extraction)
- Mermaid-diagram label inconsistency (cosmetic)
- Cloudflare-level analytics as a separate debugging signal

Net effect: score baseline 290 → 292 (TEL4 added); release shape moves from patch to minor; privacy invariants tightened from "no IPs" to "no IPs AND bucketed country AND k-anonymity in queries".
