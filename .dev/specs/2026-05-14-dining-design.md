# MSU Dining Module — Design Spec

**Date:** 2026-05-14
**Stage:** Brainstorm complete, awaiting plan
**Target release:** v1.1.0
**Author:** Minsub Lee (mminsub90)

---

## 0. Summary

Adds 2 MCP tools — `list_msu_dining_locations`, `get_msu_dining_hours` — over a hybrid-source corpus of MSU's published dining venues. Tool count **22 → 24**.

**Foundational architectural decisions made in brainstorm:**

1. **Corpus rule expansion** to admit MSU-authoritative vendor domains (specifically the target of a `*.msstate.edu` 200-redirect). Required because `dining.msstate.edu` is a hard redirect to `msstatedining.mydininghub.com` (Compass Group Touchpoint platform).
2. **Two-tier freshness**: Worker refreshed daily via GitHub Actions cron (no version bump); npm bundle refreshed quarterly via a separate cron with patch-version bump.
3. **v1 scope**: locations + hours only. Menus + meal plans deferred to v2.
4. **Extraction**: hybrid — cheerio against `/en/sitemap` for location list, Playwright (build-time devDep) against per-location pages for hours.
5. **Polite-scraping policy**: realistic Chrome UA pool, randomized scroll + jitter, sequential per-location, session-persistent storage state, robots.txt honored, attribution via custom `X-Source` header.

---

## 1. Corpus rule expansion (load-bearing)

The existing corpus rule in `CLAUDE.md` reads: *"every value comes from `*.msstate.edu`. No third-party fallback."* Dining is the first time this is too restrictive.

**Replacement language for CLAUDE.md** (`## CORPUS RULE` section):

> MSU-authoritative includes:
> - `*.msstate.edu` and its subdomains, OR
> - Any domain that an `*.msstate.edu` URL 200-redirects to as the canonical destination (e.g., `dining.msstate.edu → msstatedining.mydininghub.com`). The redirect target must be MSU's officially-chosen surface, evidenced by the redirect from an msstate.edu URL we control.
>
> Today the only domain admitted under the second clause is `msstatedining.mydininghub.com`. Adding a future redirect target requires a new spec and a `## Corpus extension` addendum entry — this is not a blanket permission.

**Why this is safe:** the rule still treats `*.msstate.edu` redirect behavior as ground truth. If MSU changes vendors, the redirect changes and the allowlist must change too. If MSU never redirects to a domain, we never trust it. This preserves the "MSU is the source of truth" invariant.

**Frozen allowlist** lives in `msstate-policies/src/dining/types.ts`:

```typescript
export const DINING_ROOTS = Object.freeze([
  "https://dining.msstate.edu/",
  "https://msstatedining.mydininghub.com/",
] as const);
```

Two URLs are pinned. Per-location URLs are constructed from base + slug, and `isAllowedDiningUrl()` enforces the host + slug regex + per-scrape allowed-slug set built from the sitemap.

---

## 2. Two-tier freshness model

| Surface | Refresh source | Cadence | Version bump? |
|---|---|---|---|
| **Cloudflare Worker** (claude.ai + ChatGPT connectors) | GitHub Actions cron `dining-refresh.yml` | Daily at 09:00 UTC (= 04:00 CDT summer / 03:00 CST winter) | No |
| **npm bundle** (npx, Claude Code plugin) | GitHub Actions cron `corpus-release.yml` | Quarterly: 1st of Feb/May/Aug/Nov at 09:00 UTC | Yes — auto-bump patch (`1.1.0 → 1.1.1 → 1.1.2 → ...`) |

Cron timing rationale: post-midnight in MSU's actual timezone year-round, low organic-traffic window. The 1-hour DST drift is acceptable — we're not coupled to a precise local clock. If exact 4 am CT year-round becomes important later, a workflow_dispatch + dual-cron split (CST vs CDT) is the standard fix.

**`DINING_DISCLAIMER`** carried on every response:

> "MSU dining locations and hours change frequently. The web/mobile connector refreshes this data daily; if you're using the local `npx` or Claude Code plugin install, this snapshot may be days–months old — verify against https://dining.msstate.edu/ before going to a closed venue."

`corpus_built_at` field on every response lets the model compute staleness and warn the user appropriately.

---

## 3. v1 scope

**In scope (v1.1.0):**
- Location directory (~30 venues; live baseline confirmed via probe of `/en/sitemap`)
- Per-location hours (by day-of-week, plus today)
- Meal periods if visibly distinguishable in the rendered DOM (breakfast/lunch/dinner)
- `status_now` derived field (`"open" | "closed" | "opens_at HH:MM" | "closes_at HH:MM" | "unknown"`)

**Out of scope (deferred to v2 / v3):**
- Daily menus, items, dietary tags, allergens, nutrition
- Meal plan options + pricing (separate Compass Group surface, mostly static-rendered; cleaner own module)
- DawgDollars / dining rewards programs
- Catering & ordering UIs
- Wait-time / line-length data (not published)

**Explicit non-goals (corpus-rule incompatible or scope-violating):**
- Personalized menu favorites, order history, account state (requires auth)
- Real-time changes within a 24h window (cron cadence is the floor)
- Multi-language responses (Touchpoint also publishes `/es` — we serve `/en` only in v1)

---

## 4. Components

```
msstate-policies/
├── package.json                              ← devDeps add: playwright (chromium only)
├── src/
│   ├── index.ts                              ← register 2 tools; declare/load __DINING_CORPUS__
│   └── dining/
│       ├── types.ts                          • DINING_ROOTS frozen 2-URL allowlist
│       │                                     • LOCATION_SLUG_RE
│       │                                     • DiningLocation, DiningHoursDay,
│       │                                       DiningMealPeriod, DiningCorpus types
│       │                                     • DINING_DISCLAIMER constant
│       │                                     • DiningParseWarning union:
│       │                                         "no_hours_extracted"
│       │                                         "hours_format_unrecognized"
│       │                                         "page_timeout"
│       │                                     • MAX_QUERY_CHARS = 4096
│       │                                     • DiningWafError class
│       ├── parser.ts                         • parseSitemapLocations(html, url) → ProgramIndexEntry-like list
│       │                                     • parseLocationHoursDom(html, slug, url) → DiningLocation
│       │                                       (called on POST-Playwright DOM string, not raw shell)
│       ├── scraper.ts                        • isAllowedDiningUrl(url, allowedSlugs?)
│       │                                     • UA_POOL (3 modern Chrome UAs)
│       │                                     • jitter(minMs, maxMs)
│       │                                     • randomScroll(page) — 2-4 increments, 200-500ms gaps
│       │                                     • politeFetch(page, url) — UA pick + nav + idle wait + scroll + jitter
│       │                                     • scrapeAllDining({ playwright?, fetchHtml? })
│       │                                         pass 1: cheerio /en/sitemap → slugs
│       │                                         pass 2: Playwright sequential per-slug → hours DOM
│       │                                     • mocked-playwright dependency injection for unit tests
│       ├── search.ts                         • filterLocations(locations, { open_now?, name_substring?,
│       │                                                                     limit, offset })
│       │                                     • fuzzyResolveLocation(locations, query) → matched + did_you_mean
│       │                                     • computeOpenStatus(location, now: Date) → status
│       │                                     • Uses America/Chicago via Intl, never trusts client TZ
│       └── corpus.ts                         • setDiningCorpus, getDiningCorpus
│                                             • getDiningLocationBySlug, listAllDiningLocations
│                                             • diningCorpusHealth()
│                                             • path resolution via __dirname (not import.meta.url) —
│                                               pre-empts v1.0.1-class CJS bundle regression
├── tools/
│   ├── list_msu_dining_locations.ts          • zod: { open_now?, name_substring?, limit?, offset? }
│   │                                         • Returns rows {slug, name, url, status_now,
│   │                                                          hours_today, meal_periods_today}
│   └── get_msu_dining_hours.ts               • zod: { slug? | name_query? } .refine(exactly-one)
│                                             • Returns full DiningLocation + status_now + did_you_mean
└── tests/
    ├── dining/
    │   ├── types.test.ts                     • DINING_ROOTS frozen, slug regex, MAX_QUERY_CHARS
    │   ├── parser-sitemap.test.ts            • fixtures/dining/en-sitemap.html
    │   ├── parser-hours.test.ts              • fixtures/dining/rendered-perry.html
    │   │                                       fixtures/dining/rendered-chickfila.html
    │   │                                       fixtures/dining/rendered-no-hours.html
    │   ├── search.test.ts                    • filterLocations / fuzzyResolveLocation /
    │   │                                       computeOpenStatus (fixed-clock injection)
    │   ├── scraper.test.ts                   • mocked Playwright + cheerio
    │   ├── corpus.test.ts                    • set/get/health
    │   ├── tool-list-msu-dining-locations.test.ts
    │   └── tool-get-msu-dining-hours.test.ts
    ├── stdio-bundle-dining.test.ts           ← REGRESSION: spawn dist/index.js,
    │                                                       call get_msu_dining_hours,
    │                                                       assert matched non-null
    └── fixtures/dining/
        ├── en-sitemap.html
        ├── rendered-perry.html
        ├── rendered-chickfila.html
        └── rendered-no-hours.html

scripts/
├── _scrape-dining.ts                         • stderr-only logging; stdout JSON
│                                             • Invokes scrapeAllDining()
├── _capture-dining-fixtures.mjs              • ONE-TIME helper (not in cron path)
│                                             • Launches real Playwright, captures
│                                               post-render DOM, writes to fixtures/
└── build-worker-corpus.mjs                   • scrapeDiningViaSubprocess() with 6+ canonical aborts
                                              • --only-dining flag (preserves all other blocks
                                                from disk corpus.json)
                                              • --skip-dining (symmetric to --skip-calendars)
                                              • out.dining_services = {...}

worker/src/
└── index.ts                                  • dining block (~150 LOC mirrored from src/dining/)
                                              • 2 case branches in tools/call switch
                                              • 2 entries in tools/list array
                                              • health_check exposes dining counts
                                              • SERVER_INSTRUCTIONS routing rule 7 (dining)

.github/workflows/
├── dining-refresh.yml                        • cron "0 9 * * *" (09:00 UTC = 04:00 CDT / 03:00 CST)
│                                             • workflow_dispatch trigger
│                                             • playwright cache + chromium install
│                                             • node scripts/build-worker-corpus.mjs --only-dining
│                                             • wrangler deploy
│                                             • NO commit, NO npm publish
└── corpus-release.yml                        • cron "0 9 1 */3 *" (09:00 UTC, 1st of every 3rd month)
                                              • workflow_dispatch trigger
                                              • full rebuild
                                              • bump patch version (4 sites)
                                              • npm publish (NPM_TOKEN secret)
                                              • wrangler deploy + git tag

tools/
└── security-checklist.sh                     ← DIN1-DIN6 added (+12 pts → 281 Linux CI)

docs/
├── BUILD.md                                  ← addendum: dining module (v1.1.0)
└── CLAUDE.md                                 ← corpus-rule expansion + "Corpus extension" addendum

.dev/specs/2026-05-14-dining-design.md        ← THIS DOCUMENT
.dev/plans/2026-05-14-dining.md               ← created next via writing-plans skill
```

**Departure from the online module:** dining's `corpus.ts` does NOT include a `search.ts` BM25 indexer. Nothing free-text to index in v1 (no menu items, no descriptions beyond venue name). When menus arrive in v2, a BM25 over menu items becomes a natural addition.

---

## 5. Data flow

### 5.1 Daily Worker-refresh flow (cron)

```
09:00 UTC (~04:00 CDT)  →  .github/workflows/dining-refresh.yml fires
                    │
                    ▼
   git checkout main + setup-node + npm ci + npx playwright install chromium
                    │
                    ▼
   node scripts/build-worker-corpus.mjs --only-dining
                    │
                    ├─ Reads existing worker/corpus.json from disk
                    │  Preserves: policies, calendars, courses, emergency,
                    │             tuition, online_education blocks UNCHANGED
                    │
                    ├─ scrapeDiningViaSubprocess() → spawn _scrape-dining.ts
                    │       │
                    │       ▼
                    │   scrapeAllDining({ playwright }) — two-pass:
                    │
                    │       Pass 1 (cheerio, ~1s, single fetch):
                    │         GET https://msstatedining.mydininghub.com/en/sitemap
                    │              with realistic Chrome UA + X-Source header
                    │         parseSitemapLocations() → list of {slug, name, url} (~30 entries)
                    │
                    │       Pass 2 (Playwright sequential, ~3s/venue, ~1-2 min total):
                    │         allowedSlugs = Set(pass1Slugs)
                    │         For each slug:
                    │           url = `https://msstatedining.mydininghub.com/en/location/${slug}`
                    │           isAllowedDiningUrl(url, allowedSlugs) must pass
                    │           politeFetch(page, url):
                    │             • randomize UA from pool (one per session, not per request)
                    │             • page.goto(url, {waitUntil: "networkidle"})
                    │             • jitter 500–1500 ms
                    │             • randomScroll: 2-4 increments × 200-800 px × 200-500 ms gaps
                    │             • jitter 500–1500 ms
                    │           parseLocationHoursDom(await page.content(), slug, url)
                    │             → DiningLocation with hours_today, hours_by_day, meal_periods,
                    │                parse_warnings[]
                    │           inter-request jitter 1500–4500 ms
                    │
                    ├─ Validation (6+ canonical-string abort sites):
                    │     "refusing to ship a poisoned dining corpus"
                    │       • subprocess non-zero exit
                    │       • unparseable JSON
                    │       • malformed payload (missing required fields)
                    │       • per_source.anyError === true
                    │       • locations.length < 15 (baseline ~30)
                    │       • > 5 venues with no_hours_extracted (parser-quality gate)
                    │       • any location URL not on DINING_ROOTS allowlist
                    │
                    ├─ Writes merged worker/corpus.json back to disk
                    │  (only dining_services block changed)
                    │
                    ▼
   wrangler deploy --env production (CLOUDFLARE_API_TOKEN secret)
                    │
                    ▼
   Worker /mcp endpoint serves dining data with retrieved_at = build time.
```

**No git commit, no PR, no npm publish.** The corpus.json change exists only in the Actions runner's workspace; it dies with the runner. Next day's cron re-derives it from scratch.

**Failure isolation:** if Playwright fails on a single venue, that venue gets `parse_warnings: ["no_hours_extracted"]` (or `"page_timeout"`) and the rest succeed. Build aborts only if too many fail in aggregate.

### 5.2 Quarterly npm release flow

```
09:00 UTC, 1st of Feb/May/Aug/Nov → .github/workflows/corpus-release.yml fires
                    │
                    ▼
   Full pipeline (all modules including freshly-scraped dining):
   node scripts/build-worker-corpus.mjs   # no --only flags
                    │
                    ▼
   Auto-bump patch version in 4 sites:
     msstate-policies/package.json
     msstate-policies/.claude-plugin/plugin.json
     worker/src/index.ts (3 hardcoded sites)
                    │
                    ▼
   cd msstate-policies && npm run build  →  dist/index.js rebuilt with new corpus
                    │
                    ▼
   git commit -m "release: vX.Y.Z (quarterly corpus refresh)"
   git tag vX.Y.Z + git push origin main + tag
                    │
                    ▼
   npm publish (NPM_TOKEN secret) + wrangler deploy
                    │
                    ▼
   Both surfaces fresh. Stdio users get dining freshness ≤ 3 months old.
```

### 5.3 Runtime tool-call flow

```
User: "is Perry open right now?"  → claude.ai → Worker /mcp
                    │
                    ▼
   POST /mcp { "name":"get_msu_dining_hours", "arguments":{"name_query":"perry"} }
                    │
                    ▼
   Worker handler:
     • Content-Length cap (inherited from v1.0.2)
     • dispatch matches "get_msu_dining_hours"
     • inline arg validation (length cap on name_query, refine exactly-one)
                    │
                    ▼
   fuzzyResolveLocation(corpus.dining_services.locations, "perry")
     → matched = perry-cafeteria entry; did_you_mean = next 2
                    │
                    ▼
   computeOpenStatus(matched, new Date())
     → reads matched.hours_by_day, compares to current day-of-week +
       clock in America/Chicago
     → "open" | "closed" | "opens at HH:MM" | "closes at HH:MM" | "unknown"
                    │
                    ▼
   Response envelope:
   {
     disclaimer: DINING_DISCLAIMER,
     matched: { ...full DiningLocation... },
     status_now: "open",
     did_you_mean: [{slug, name}, {slug, name}],
     not_found_reason: null,
     corpus_built_at: "2026-05-14T09:00:00.000Z",
     source_url: "https://msstatedining.mydininghub.com/en/location/perry-cafeteria"
   }
```

**`computeOpenStatus` is the only "real-time" computation in the runtime path.** Everything else is corpus lookup.

---

## 6. Error handling

### 6.1 Build-time

| Failure | Response |
|---|---|
| `npx playwright install chromium` fails on GHA runner | Workflow step fails red; no Worker deploy; Worker keeps yesterday's snapshot |
| `/en/sitemap` HTTP non-200 or empty | Canonical abort |
| Sitemap parses to 0 or < 15 locations | Canonical abort |
| Anti-bot blocks one venue (403/429/captcha) | Per-venue try/catch; push into `per_source`; abort only if too many fail |
| Anti-bot blocks `/en/sitemap` itself | Canonical abort |
| Per-location `page.goto` timeout | Venue gets `parse_warnings: ["page_timeout"]`, blank hours; abort if > 5 |
| Hours DOM selector misses (Touchpoint redesign) | Venue gets `parse_warnings: ["no_hours_extracted"]`; abort if > 5 |
| Hours format unrecognized ("By appointment", "Closed for renovation") | `hours_raw_text` captured verbatim, structured fields null, warning `hours_format_unrecognized`; ships |
| All venues parse cleanly but no hours anywhere | Suggests global DOM change → canonical abort |
| `wrangler deploy` auth fails | Workflow red; Worker keeps yesterday's deploy |

### 6.2 Runtime

Every dining tool returns the same envelope shape:

```typescript
{
  disclaimer: string,
  matched: DiningLocation | null,
  did_you_mean: Array<{slug, name}>,
  not_found_reason: string | null,
  corpus_built_at: string | null,
  source_url?: string,
  status_now?: DiningStatus,
}
```

| Failure | Response |
|---|---|
| Corpus has no dining block (stdio built pre-v1.1.0) | `matched: null, not_found_reason: "Dining data is not loaded in this build."` |
| Malformed args | zod (stdio) / inline guard (Worker) → JSON-RPC `-32600` with safe message; never echoes arg value |
| Unknown slug | `not_found_reason: "No location with slug '<slug>'. Try list_msu_dining_locations to see valid slugs."` |
| Fuzzy name match misses | `not_found_reason: "No location matched '<query>'. Try list_msu_dining_locations(name_substring=...) to browse."` |
| Ambiguous fuzzy match | `matched: top-1, did_you_mean: next-2` — model can clarify |
| Matched location has no `hours_by_day` | Full record still returns; `status_now: "unknown"`; `parse_warnings` visible |
| `computeOpenStatus` hits malformed time string | Returns `"unknown"`, never throws |
| Day-of-week boundary, midnight crossings | Resolved via `Intl.DateTimeFormat` in `America/Chicago` |
| `__DINING_CORPUS__` undefined at stdio startup | Same as "no dining block"; other modules unaffected |
| Bundle path issue analogous to v1.0.1 calendars bug | Pre-empted: `corpus.ts` uses `__dirname`. Regression test `stdio-bundle-dining.test.ts` enforces. |

### 6.3 Deliberately NOT handled

- MSU/Touchpoint sending a takedown notice — policy decision, not a code path. We comply, deprecate the module, ship a release that removes dining cleanly.
- User's local clock being wrong — `computeOpenStatus` uses America/Chicago on the Worker side.
- Touchpoint serving different hours per cookie/IP/auth state — we treat the anonymous public view as ground truth.
- Real-time changes within a 24h window — disclaimer documents this.

---

## 7. Anti-bot / polite-scraping policy

| Behavior | Choice |
|---|---|
| Concurrency | 1 (sequential per-location) |
| Inter-request delay | 1500–4500 ms jittered |
| User-Agent | Realistic modern Chrome UA from a pool of 3 recent versions; one UA per cron-session (not per request) |
| Attribution | Custom header `X-Source: msstate-policies-mcp/<ver>` |
| Session persistence | `storageState` reused across the ~30 location fetches in one cron run |
| Scroll simulation | 2–4 increments × 200–800 px × 200–500 ms gaps before scraping |
| Network idle wait | `page.waitForLoadState("networkidle")` + 500–1500 ms jitter |
| Robots compliance | Honored. `/robots.txt` has `User-agent: * / Sitemap: ...` with no disallow rules |
| Cron timing | 09:00 UTC daily (post-midnight Central year-round, low organic-traffic window) |

**Posture:** polite scraping, not stealth. Once-daily, low-volume, attribution-friendly. Randomization is to survive anti-bot scoring, not to deceive. If Touchpoint ever sends a stop request we honor it.

Documented in `SECURITY.md` addendum as in-scope-but-respectful behavior.

---

## 8. Testing

Targets: ~35–40 new tests, lifting total from 436 to ~475.

### 8.1 Unit test layout

```
msstate-policies/tests/dining/
├── types.test.ts                              ~5
├── parser-sitemap.test.ts                     ~5
├── parser-hours.test.ts                       ~10  (3 fixtures: perry, chickfila, no-hours)
├── search.test.ts                             ~10  (computeOpenStatus with fixed-clock injection)
├── scraper.test.ts                            ~5   (mocked Playwright + cheerio)
├── corpus.test.ts                             ~5
├── tool-list-msu-dining-locations.test.ts     ~5
└── tool-get-msu-dining-hours.test.ts          ~5
+
msstate-policies/tests/
└── stdio-bundle-dining.test.ts                ~2   REGRESSION
```

### 8.2 The tricky tests

**`computeOpenStatus`** — inject `now` as a parameter, never call `new Date()` inside. Tests construct fixed `now` values in `America/Chicago` via a small helper and assert specific outcomes for ~8 cases:

- Open mid-day → `open`
- Closed at 2 am → `closed` with `opens_at` populated
- 30 min before close → `open` with `closes_at` populated
- Holiday closed-all-day → `closed`
- Sunday with different hours than weekday → correct hours used
- Day-of-week boundary (Sunday 11 pm → Monday)
- DST transition day
- Malformed hours data → `"unknown"` (never throws)

**Playwright mocking (scraper.test.ts)** — scraper accepts an injected `playwright` arg:

```typescript
export async function scrapeAllDining(opts: {
  fetchHtml?: (url: string) => Promise<string>;
  playwright?: typeof import("playwright");
} = {}): Promise<ScrapeAllResult> { ... }
```

Tests inject a stub that returns fixture HTML from `page.content()`. Real chromium is never downloaded in unit tests — saves ~200 MB per CI run.

**Fixture capture** — one-time scripted via `scripts/_capture-dining-fixtures.mjs`. Launches real Playwright, fetches sitemap + 3 sample location pages, writes post-render DOM to `tests/fixtures/dining/`. Re-run only when MSU/Touchpoint changes the page structure and fixtures drift.

### 8.3 Eval suite

`msstate-policies/eval/dining.jsonl` — ~15-18 questions across 5 buckets:

| Bucket | Count | Examples |
|---|---|---|
| `location_slug_lookup` | 3 | `get_msu_dining_hours({slug:"perry-cafeteria"})` |
| `location_name_query` | 3 | `name_query:"perry"` → `perry-cafeteria`; `"chickfila"` → `chick-fil-a` |
| `list_filter` | 3 | `list_msu_dining_locations({open_now:true})`, `name_substring:"market"` |
| `open_status_check` | 3 | Given fixed corpus + current time, `status_now ∈ ["open","closed","opens_at","closes_at"]` |
| `adversarial` | 3 | Unknown slug → `matched:null`; `name_query:"football game"` → `matched:null`; empty `q` (zod reject) |

Runner: `scripts/run-eval.mjs --suite=dining` — mirrors existing `--suite=online`. 90% pass threshold. Runs in CI as part of `corpus-release.yml` before npm publish.

### 8.4 Security checklist DIN1–DIN6

| Check | Pts | What it asserts |
|---|---|---|
| DIN1 | 3 | All `https://` URLs in `src/dining/` stay on `msstate.edu` OR `mydininghub.com` (the only two domains in `DINING_ROOTS`) |
| DIN2 | 2 | `DINING_ROOTS` frozen allowlist present in `types.ts` |
| DIN3 | 3 | Worker length-caps `name_substring`, `name_query`, `slug` before parse |
| DIN4 | 2 | Build aborts on poisoned dining corpus (≥ 6 sites) |
| DIN5 | 2 | `DINING_DISCLAIMER` present in `types.ts` AND referenced in both tool files |
| DIN6 | 2 | `politeFetch` jitter/scroll/UA-rotation visible in scraper.ts source (static grep) |

**Score impact:** 269 (Linux CI baseline) → **281** post-merge.

### 8.5 Deliberately NOT tested

- Live Touchpoint API responses in unit tests
- Real Playwright in unit tests
- `computeOpenStatus` with real wall-clock `Date()`
- Adversarial inputs to Playwright (Playwright never sees user input)

---

## 9. Strategic risks

1. **Touchpoint restructures DOM** — covered by parser warnings + 5-venue abort threshold. Spec'd response: capture fresh fixtures, update selectors, ship a patch. Expected cadence: 1–2 incidents per year.
2. **Anti-bot escalation** — Compass Group could add Cloudflare Turnstile or similar challenge. If hit, options are (a) try one IP rotation via GHA matrix runners, (b) accept the data goes stale, (c) deprecate the module. We do NOT add CAPTCHA-solving services.
3. **MSU changes dining vendor** — the redirect target changes, our allowlist breaks. Spec'd response: emergency patch updating `DINING_ROOTS` + a CLAUDE.md addendum noting the new redirect target. Single-day turnaround.
4. **Touchpoint sends a stop request** — we comply. We deprecate the module within 1 release (v1.1.x ships with dining tools that return `not_found_reason: "Dining data has been removed at vendor request."`).
5. **GHA chromium install instability** — known to occasionally fail. Fallback: workflow has 1 retry. If chronic, switch to `playwright-core` + manually-pinned chromium.

---

## 10. Routing rule (SERVER_INSTRUCTIONS)

7th rule added to both `msstate-policies/src/index.ts` and `worker/src/index.ts` SERVER_INSTRUCTIONS string:

> 7. Dining / food / meal-hour questions ("is Perry open?", "what time does Chick-fil-A close?", "where can I get coffee right now?", "list dining halls", "what's open at 9 pm") → `get_msu_dining_hours` for a specific venue (slug or fuzzy name), `list_msu_dining_locations` for browse/filter. Always surface `corpus_built_at` and the disclaimer — dining hours change frequently and the local-install snapshot may be days–months old. Distinct from meal-plan-cost questions which are not yet covered.

---

## 11. SECURITY.md addendum (draft)

> ### Build-time scraping of mydininghub.com (v1.1.0)
>
> The dining module (v1.1.0+) fetches data from `msstatedining.mydininghub.com`, the Compass Group Touchpoint platform that `dining.msstate.edu` officially redirects to. We treat this as MSU-authoritative under the expanded corpus rule in CLAUDE.md.
>
> Scraping is once-daily from a GitHub Actions runner, sequential per-location (concurrency = 1), with randomized inter-request delays (1500–4500 ms) and a realistic Chrome user agent identified as `msstate-policies-mcp` via the `X-Source` header. Robots.txt is honored. No authenticated views are accessed. If MSU or Compass Group requests we stop, we comply and deprecate the module within one release cycle.

---

## 12. CLAUDE.md addendum (draft)

> ### Corpus extension (2026-05-14) — dining (v1.1.0)
>
> Adds 2 MCP tools (`list_msu_dining_locations`, `get_msu_dining_hours`) over a hybrid-source corpus of MSU's published dining venues (~30 locations). Tool count 22 → 24.
>
> **First module to exercise the expanded corpus rule** (MSU-authoritative includes redirect targets). The only domain admitted under this expansion today is `msstatedining.mydininghub.com`, pinned in the frozen `DINING_ROOTS` allowlist.
>
> **Two-tier freshness model:** Worker refreshed daily via `dining-refresh.yml` (no version bump); npm bundle refreshed quarterly via `corpus-release.yml` (auto-bumps patch version). `DINING_DISCLAIMER` carried on every response; stdio users are explicitly told to check the source URL.
>
> **Extraction hybrid:** location list via static HTML scrape of `/en/sitemap`; per-location hours via Playwright (build-time devDep, never shipped to runtime). Playwright chromium installed in CI only.
>
> **Build aborts (≥ 6 canonical "refusing to ship a poisoned dining corpus" sites):** subprocess failure, unparseable JSON, malformed payload, per-source error, locations.length < 15, `no_hours_extracted` count > 5.
>
> **DIN1–DIN6 security checks (+12 pts; 269 → 281 Linux CI):** allowlist URL discipline, frozen DINING_ROOTS, Worker input-length caps, build-time poisoned-corpus aborts, DINING_DISCLAIMER presence, polite-scraping policy visible in scraper.ts source.
>
> **Server-side routing:** `SERVER_INSTRUCTIONS` gains a 7th rule routing dining-hours / dining-location questions to the 2 new tools.

---

## 13. Open questions

None blocking implementation. The brainstorm explicitly resolved:

- [x] Corpus rule expansion language
- [x] Freshness model (daily Worker cron + quarterly npm)
- [x] v1 scope (locations + hours only)
- [x] Extraction strategy (hybrid sitemap + Playwright)
- [x] Anti-bot policy (polite scraping with randomization)
- [x] Failure handling (fail loud at build, degrade gracefully at runtime)
- [x] Testing strategy (~40 unit tests + 15 evals + 6 security checks)
- [x] Stdio bundle regression coverage (mirror v1.0.2 calendars pattern)
- [x] Routing instruction text

Items deliberately deferred:

- Menu / meal-plan / DawgDollars modules (v2)
- BM25 indexing over menu items (v2)
- Spanish-language responses (v3+)
- IP rotation strategy if anti-bot escalates (reactive only)

---

## Approvals captured during brainstorm

| Decision | Choice | Notes |
|---|---|---|
| Corpus rule | Expand to admit `*.msstate.edu` redirect targets | Documented in CLAUDE.md replacement language |
| Freshness | Worker daily cron + quarterly npm release | Two GHA workflows |
| npm version cadence | Quarterly | Avoids version-spam; user explicitly chose option B |
| v1 scope | Locations + hours only | Menus deferred |
| Extraction | Hybrid: sitemap (cheerio) + per-location (Playwright) | Headless chromium build-time only |
| Anti-bot policy | Realistic UA pool + jitter + scroll; polite, not stealth | Spec'd in §7 |
| Disclaimer text | Verify against `dining.msstate.edu` before going to a closed venue | Stdio users explicitly addressed |

---

End of spec.
