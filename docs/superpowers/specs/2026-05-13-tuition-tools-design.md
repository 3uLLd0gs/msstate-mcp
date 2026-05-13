# Tuition Tools Design — v0.8.0

**Date:** 2026-05-13
**Target release:** v0.8.0
**Status:** approved (brainstorming), pending implementation plan

## Motivation

`msstate-mcp` covers policies, calendars, courses, and emergency guidance. Tuition is the next obvious gap — students, prospective students, and parents routinely ask "how much is tuition at MSU?" and the LLM currently has nothing grounded to call. This module adds a baked snapshot of every MSU-published tuition rate, enrollment fee, and the official FAQ, behind 4 new MCP tools.

The corpus rule applies unchanged: every value comes from `*.msstate.edu` sources, never training data or third-party mirrors.

## Source URLs — frozen allowlist (`TUITION_ROOTS`)

9 URLs total, all on `*.msstate.edu` subdomains:

```
https://www.controller.msstate.edu/accountservices/tuition
https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions
https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs
https://www.controller.msstate.edu/accountservices/tuition/select-your-campus
https://www.controller.msstate.edu/accountservices/tuition/starkville-campus
https://www.controller.msstate.edu/accountservices/tuition/meridian-campus
https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates
https://www.controller.msstate.edu/accountservices/tuition/online-education-rates
https://www.vetmed.msstate.edu/tuition
```

Both `controller.msstate.edu` and `vetmed.msstate.edu` are `*.msstate.edu`, so the existing URL-on-msstate.edu security checks accept them without modification.

**Known data gaps and source quirks (snapshot-as-found, not corrected):**

- The controller's `/select-your-campus` page links to `https://www.vetmed.msstate.edu/academics/admissions/tuition-financial-aid`, which returns **404**. We use the live URL `https://www.vetmed.msstate.edu/tuition` instead. This is a controller-side broken link, not ours.
- The vetmed page is marked `"Effective Fall 2025 Semester through Summer 2026"` while the controller pages show Fall 2026 / Spring 2027 — vetmed is one academic year behind on its public page. We snapshot whatever is published and surface `effective_term` verbatim in every response, so a downstream LLM can flag staleness rather than us silently extrapolating.
- MGCCC ("Engineering on the Coast") is undergrad-only by program design — no graduate rates exist. The rate tool returns an explicit `not_found_reason` for `campus=mgccc + level=grad`.
- The 4 controller campuses use per-credit-hour rate tables with hour buckets (1-11 / 12-16 for undergrad, 1-8 / 9+ for grad). Vetmed uses flat per-semester and per-year amounts (DVM is a 3-semester professional program). The unified row schema below expresses both via nullable fields rather than a sum type.

## Coverage matrix

| Campus | Undergrad | Grad | DVM | Rate basis |
|---|---|---|---|---|
| Starkville | yes (4 tables) | yes (4 tables) | — | per_credit_hour |
| Meridian | yes (4 tables) | yes (4 tables) | — | per_credit_hour |
| MGCCC | yes (4 tables) | — (undergrad-only partnership) | — | per_credit_hour |
| Online | yes (4 tables) | yes (4 tables) | — | per_credit_hour |
| Vetmed | — | — | yes (2 tables: Resident, Non-Resident) | annual_flat |

Expected baked-corpus row counts (validated at build time):

- `rate_rows`: ≥ 50 (controller campuses' 8 tables × residency × ~4 line items per table + vetmed's 2 tables × ~7 rows). Build aborts if < 40.
- `fee_rows`: ≥ 15 (college fees 8 + program fees 5+ + course/distance categories). Build aborts if `college` kind == 0 or `program` kind == 0.
- `faq_rows`: 16 published; build aborts if < 10.
- `campuses`: exactly 5 (validated explicitly).

## Module layout

New module `msstate-policies/src/tuition/` parallel to `emergency/`:

```
msstate-policies/src/tuition/
  types.ts       # TUITION_ROOTS, MANDATORY_DISCLAIMER, MAX_QUERY_CHARS, row interfaces, error class
  parser.ts     # cheerio extractors: rate tables (controller pattern + vetmed pattern), fee tables, FAQ pairs
  scraper.ts    # per-URL fetch via src/http.ts, retries, WAF detect, scrapeAllTuition()
  corpus.ts     # runtime loader — reads __TUITION_CORPUS__ esbuild define
  search.ts     # BM25 index for FAQ; deterministic routing for rates + fees
```

Plus:

- `scripts/_scrape-tuition.ts` — subprocess scraper, stdout JSON, stderr logging
- `msstate-policies/src/tools/get_msu_tuition_rate.ts`
- `msstate-policies/src/tools/get_msu_enrollment_fees.ts`
- `msstate-policies/src/tools/find_msu_tuition_faq.ts`
- `msstate-policies/src/tools/list_msu_tuition_campuses.ts`
- 4 corresponding case branches in `worker/src/index.ts`
- 4 corresponding tool registrations in `msstate-policies/src/index.ts`
- esbuild `define` for `__TUITION_CORPUS__` in `msstate-policies/build.mjs`

## Mandatory disclaimer

Single constant in `tuition/types.ts`, named **`TUITION_DISCLAIMER`** (module-scoped to avoid colliding with the emergency module's `MANDATORY_DISCLAIMER`):

```
"Tuition rates are subject to change without notice. Always verify the current rate at https://www.controller.msstate.edu/accountservices/tuition before paying."
```

Carried on **every response** from **every tuition tool**, including matched=null, matched=[], and error-shape responses. Same enforcement pattern as `MANDATORY_DISCLAIMER` in the emergency module. Security check TUI5 enforces presence of `TUITION_DISCLAIMER` in all 4 tool response builders.

## Row schemas

### TuitionRateRow

```ts
interface TuitionRateRow {
  campus:        "starkville" | "meridian" | "mgccc" | "online" | "vetmed";
  level:         "undergrad" | "grad" | "dvm";
  residency:     "resident" | "non_resident";
  term:          "fall_spring" | "winter" | "summer" | "annual";
  rate_basis:    "per_credit_hour" | "per_semester_flat" | "annual_flat";
  credit_hour_bucket: "1-11" | "12-16" | "1-8" | "9+" | null;
  amount_usd:    number;                            // headline ("Total Charge to Student") row
  line_items:    { label: string; amount_usd: number }[];   // verbatim breakdown rows from the source table
  effective_term: string;                           // verbatim from page heading, e.g. "Fall 2026 or Spring 2027"
  source_url:    string;
  retrieved_at:  string;
}
```

Field semantics:

- `term` `"annual"` is vetmed-only. The controller pages use `"fall_spring"`, `"winter"`, `"summer"`.
- `credit_hour_bucket` is `null` when `rate_basis != "per_credit_hour"` (vetmed flat rates, or controller's winter / summer per-hour rates where every hour is the same single rate).
- `amount_usd` always carries the headline total. `line_items` preserves the per-fee breakdown so a model that wants to explain "what makes up that number" can do so.
- `effective_term` is preserved verbatim so vetmed's "Fall 2025 through Summer 2026" gap is visible to the model.

### FeeRow

```ts
interface FeeRow {
  kind: "college" | "program" | "course_distance";
  label: string;                                    // e.g. "College of Engineering", "Honors College", "MBA"
  per_credit_usd:    number | null;                 // null when only a flat amount is published
  full_time_cap_usd: number | null;                 // null when no cap published
  flat_amount_usd:   number | null;                 // null when only per-credit is published
  applicability_note: string;                       // verbatim, e.g. "Undergraduate sophomore level and above"
  source_url:        string;
  retrieved_at:      string;
}
```

### FaqRow

```ts
interface FaqRow {
  question:    string;     // verbatim
  answer:      string;     // verbatim, markdown-normalized
  source_url:  string;     // anchor link if the heading has an id, else the page URL
  bm25_score:  number;
  retrieved_at: string;
}
```

### CampusEntry

```ts
interface CampusEntry {
  slug:           "starkville" | "meridian" | "mgccc" | "online" | "vetmed";
  display_name:  string;                            // verbatim, e.g. "Starkville Campus"
  levels_offered: Array<"undergrad" | "grad" | "dvm">;
  rate_basis:    "per_credit_hour" | "annual_flat";
  source_url:    string;
}
```

## Tool surface

### 1. `get_msu_tuition_rate`

Structured lookup. Required: campus + level + residency. Optional: term + credit_hours.

```
input:
  campus:        enum (5)            required
  level:         enum (3)            required
  residency:     enum (2)            required
  term:          enum (4)            optional — omit to receive all term variants for the (campus, level, residency) triple
  credit_hours:  integer 1-30        optional — ignored when campus=vetmed

output:
  matches:           TuitionRateRow[]   0+ rows; empty when no row exists for the combo
  not_found_reason:  string?            populated on intentional rejects (e.g., MGCCC graduate, DVM at Starkville)
  disclaimer:        string             MANDATORY_DISCLAIMER
  corpus_built_at:   string
```

Resolution rules:

1. `campus=vetmed` requires `level=dvm`. Other levels return empty matches with `not_found_reason: "Vetmed publishes tuition for the DVM program only. For graduate-level MS/PhD vet med programs, see Starkville graduate rates."`.
2. `level=dvm` requires `campus=vetmed`. Other campuses return empty matches with `not_found_reason: "DVM tuition is published only by the College of Veterinary Medicine. See campus=vetmed."`.
3. `campus=mgccc + level=grad` returns empty matches with `not_found_reason: "MGCCC partnership covers undergraduate engineering only — graduate students enroll on the Starkville campus."`.
4. `credit_hours` maps to `credit_hour_bucket`:
   - undergrad: 1-11 → `"1-11"`, 12+ → `"12-16"` (>16 is capped to the 12-16 bucket — flat rate)
   - grad: 1-8 → `"1-8"`, 9+ → `"9+"`
   - vetmed: ignored
5. Omitting `term` returns rows for every published term variant for that (campus, level, residency) triple. Specifying `term` filters to one variant.

### 2. `get_msu_enrollment_fees`

```
input:
  kind:    enum ("college"|"program"|"course_distance")   required
  filter:  string                                          optional — substring match against label (case-insensitive), length-capped at MAX_QUERY_CHARS

output:
  matches:          FeeRow[]
  disclaimer:       string
  corpus_built_at:  string
```

`filter=""` or omitted returns all rows for the requested `kind`.

### 3. `find_msu_tuition_faq`

```
input:
  q:  string                  required, length-capped at MAX_QUERY_CHARS (4096)
  k:  integer 1-10            optional, default 3

output:
  matches:          FaqRow[]  top-k BM25 results, sorted by bm25_score desc
  disclaimer:       string
  corpus_built_at:  string
```

BM25 parameters: same defaults as the calendar module (`k1=1.2`, `b=0.75`). Question text weighted ×2 over answer text.

### 4. `list_msu_tuition_campuses`

```
input:   {}                  no args

output:
  campuses:         CampusEntry[]   exactly 5 rows
  disclaimer:       string
  corpus_built_at:  string
```

Static-from-corpus listing. Same role as `list_msu_emergency_types` — helps clients discover valid `campus` enum values.

## Build pipeline

`scripts/build-worker-corpus.mjs` gains a tuition step parallel to the existing emergency step (~line 538 area). Order:

1. `scrapeTuitionViaSubprocess()` spawns `npx tsx scripts/_scrape-tuition.ts`, captures stdout (JSON), pipes stderr to console.
2. Validates payload structure and aborts with the canonical string `"refusing to ship a poisoned tuition corpus"` on any of:
   - subprocess exit code != 0
   - JSON parse failure
   - `anyError` flag set by scraper
   - `< 4` controller campus pages successfully parsed (Starkville, Meridian, MGCCC, Online all required)
   - Vetmed page missing OR `< 2` rate rows from vetmed
   - `< 40` total rate rows
   - `< 10` FAQ rows
   - `0` college fees OR `0` program fees
   - Any rate row with `amount_usd <= 0` or `> 100_000` (sanity bounds — DVM annual ~$50k, anything outside is a parser bug)
3. Writes `out.tuition = { builtAt, source, rate_rows, fee_rows, faq_rows, campuses }`.

Both surfaces consume `out.tuition`:

- `worker/corpus.json` — Worker reads `corpus.tuition.*` directly.
- `__TUITION_CORPUS__` esbuild `define` in `msstate-policies/build.mjs` — stdio server reads from compiled-in constant, same pattern as `__EMERGENCY_CORPUS__`.

### Subprocess scraper

`scripts/_scrape-tuition.ts` mirrors `_scrape-emergency.ts`:

- Stdout-only JSON output.
- Stderr-only logging.
- `console.log = (...args) => process.stderr.write(...)` defensive redirect at the top, before any imports run (so any dep that logs to stdout doesn't corrupt the JSON pipe).
- Imports `scrapeAllTuition` from `msstate-policies/src/tuition/scraper.js`.
- Output shape: `{ rate_rows, fee_rows, faq_rows, campuses, per_source, anyError }`.

### Worker dispatch

`worker/src/index.ts` gains 4 case branches in the `tools/call` switch. Each handler:

- Validates input with zod (same pattern as existing tools).
- For tools with string input, length-caps before parse: `get_msu_enrollment_fees.filter`, `find_msu_tuition_faq.q`.
- Routes to a small per-tool resolver in the dispatch file (rate routing rules, fee filter, FAQ BM25 over baked synonyms, campus list).
- Builds a response object that always includes the `disclaimer` field.

Worker `/` info JSON gains a `tuition: { rate_rows: N, fee_rows: N, faq_rows: N, campuses: 5 }` block parallel to the existing `emergency` block. `tools/list` returns 18 tools.

## Security checks — TUI1 through TUI5 (+12 pts, 245 → 257)

Add to `tools/security-checklist.sh`:

| # | Check | Points | Mechanism |
|---|---|---|---|
| TUI1 | All `https://` URLs inside `msstate-policies/src/tuition/` stay on `*.msstate.edu` subdomains | 3 | `grep -rE 'https://[^"'\''\s)]+' msstate-policies/src/tuition \| grep -vE 'https://[^/]*msstate\.edu'` must equal 0 |
| TUI2 | `TUITION_ROOTS` frozen `Object.freeze([...])` allowlist present in `msstate-policies/src/tuition/types.ts`, contains exactly the 9 documented URLs | 2 | grep for `export const TUITION_ROOTS` + `Object.freeze`, then assert each of the 9 expected URLs is present |
| TUI3 | Worker length-caps `q` and `filter` before parse on the 2 input-taking tuition tools | 3 | grep for `MAX_QUERY_CHARS` references near the `get_msu_enrollment_fees` and `find_msu_tuition_faq` handler cases. `list_msu_tuition_campuses` is exempt (no input). `get_msu_tuition_rate` is exempt (all enums + number, no string fields) |
| TUI4 | Build aborts with canonical string `"refusing to ship a poisoned tuition corpus"` on poisoned tuition corpus | 2 | `grep -c 'refusing to ship a poisoned tuition corpus' scripts/build-worker-corpus.mjs` must be `>= 8` (one per abort condition) |
| TUI5 | `TUITION_DISCLAIMER` constant present in `msstate-policies/src/tuition/types.ts` AND referenced in all 4 tuition tool files under `msstate-policies/src/tools/` | 2 | `grep -l 'TUITION_DISCLAIMER' msstate-policies/src/tools/{get_msu_tuition_rate,get_msu_enrollment_fees,find_msu_tuition_faq,list_msu_tuition_campuses}.ts \| wc -l` must equal 4 |

CI gate stays at `>= 100`. Expected Linux CI score after this PR: **257/257**. Score regression below 245 means a check broke and must be fixed before merge.

## Eval plan

`msstate-policies/eval/tuition-eval-set.json` — ~30 hand-written questions in 4 buckets. Runner: `node scripts/run-eval.mjs --suite tuition`.

### Rate lookups (12 questions, 100% pass required)

Dollar amounts must match exactly. Examples (with placeholder expected values — fill in at implementation time from the scraped corpus):

- `"How much is in-state undergrad tuition at Starkville for Fall 2026 with 15 credit hours?"` → expect TuitionRateRow with `campus=starkville level=undergrad residency=resident term=fall_spring credit_hour_bucket=12-16`, exact `amount_usd`.
- `"Non-resident grad tuition Online, 9 hours, Spring 2027?"` → exact row.
- `"Vetmed DVM annual tuition for a Mississippi resident?"` → vetmed annual_flat resident row.
- 9 more across all campus × level × residency × term combinations.

### Cross-campus / cross-level edge cases (6 questions, 100% pass required)

These test routing correctness:

- `"What's MGCCC graduate tuition?"` → matches `[]`, `not_found_reason` mentions undergraduate-only partnership.
- `"DVM tuition on the Starkville campus?"` → matches `[]`, `not_found_reason` points to `campus=vetmed`.
- `"What's vetmed graduate (MS/PhD) tuition?"` → matches `[]`, `not_found_reason` points to Starkville graduate rates.
- 3 more.

### Fee lookups (6 questions, 90% pass acceptable)

- `"What's the College of Engineering fee?"` → FeeRow with `kind=college label≈"Engineering"`, exact `per_credit_usd` + `full_time_cap_usd`.
- `"Honors College fee?"` → FeeRow with `kind=program label≈"Honors"`, exact `flat_amount_usd`.
- `"MBA program fee per credit hour?"` → FeeRow with `kind=program label≈"MBA"`, exact `per_credit_usd`.
- 3 more.

### FAQ retrieval (6 questions, 90% pass acceptable)

Top-1 BM25 must contain the expected question:

- `"Why are college fees different between colleges?"` → top-1 is the verbatim Q.
- `"How do I find my campus?"` → top-1 is `"What if I don't know my campus?"`.
- 4 more.

### Adversarial bucket (4 questions, 100% pass required)

LLM should refuse + tools should return empty:

- `"What's the football schedule?"` → all tools return `[]`.
- `"What's tuition at Ole Miss?"` → all tools return `[]`.
- `"How much is parking?"` → all tools return `[]` (parking isn't on these pages).
- `"What was tuition in 2015?"` → all tools return `[]` (no historical archive in scope).

## Test plan

New tests under `msstate-policies/tests/tuition/`:

- `parser.test.ts` — saved-HTML fixtures for all 6 page types (4 controller campuses + vetmed + FAQ + other-enrollment-costs). Assert parsed row counts and spot-check verbatim `amount_usd` against the fixture.
- `search.test.ts` — BM25 ordering on the 16 FAQ pairs (top-1 for each question is itself); structured-lookup routing for all 4 reject scenarios in `get_msu_tuition_rate`.
- `corpus.test.ts` — baked-corpus loader smoke tests (mirror `emergency/corpus.ts` tests).
- 4 tool-level integration tests:
  - `get_msu_tuition_rate.test.ts` — happy path per campus + 4 reject scenarios + credit_hours bucket boundaries (11, 12, 16, 17 for undergrad; 8, 9 for grad).
  - `get_msu_enrollment_fees.test.ts` — `kind` enumeration + filter substring + empty filter.
  - `find_msu_tuition_faq.test.ts` — top-k bounds (1, 3, 10) + length-cap rejection at 4097 chars + BM25 ranking.
  - `list_msu_tuition_campuses.test.ts` — exact 5 entries, each with expected `levels_offered`.

Test glob in `msstate-policies/package.json` `"test"` script extends to include `tests/tuition/*.test.ts`.

## Net deltas

| Dimension | Before (v0.7.0) | After (v0.8.0) | Delta |
|---|---|---|---|
| Tool count | 14 | 18 | +4 |
| Security checks (Linux CI) | 245 / 245 | 257 / 257 | +12 |
| Worker `corpus.json` size | ~5.0 MB | ~5.1 MB | +~100 KB |
| Stdio bundle size | 16.3 MB | ~16.4 MB | +~100 KB |
| New deps | — | — | none (cheerio already in tree) |
| Lines added (rough) | — | ~1,800 | module + scraper + 4 tools + worker dispatch + tests + eval |

## Out of scope for v0.8.0

The following are explicitly **not** in scope for this release and would require a separate spec:

- **Master of Science in Nursing (Meridian)** and **Master of Physician Assistant Studies (Meridian)** — both linked from `/select-your-campus` but on separate controller pages. Add later if user demand surfaces.
- **Historical rate archives** — only the currently-published academic year is in scope. MSU does not publish a historical archive on these pages.
- **Financial aid, scholarships, grants** — different domain (`sfa.msstate.edu`), separate corpus extension if needed.
- **Payment plans, refunds, billing dates** — referenced in the FAQ but the actual policy pages are different URLs. The FAQ tool will surface verbatim Q&A; we don't deep-link further.
- **Per-course / per-distance fees from the Master Class Schedule** — listed as a reference on the other-enrollment-costs page but the Schedule itself is a separate Banner integration, out of scope.
- **Foreign-language localization** of tool descriptions.

## Open questions

None — all clarifying questions resolved during brainstorming (2026-05-13). Implementation plan follows.

## References

- Brainstorming transcript: this file's parent conversation (2026-05-13).
- Predecessor module pattern: `msstate-policies/src/emergency/` (added v0.7.0, 2026-05-13).
- Build pipeline: `scripts/build-worker-corpus.mjs`.
- Security check format: `tools/security-checklist.sh` (EMG1-EMG4 are the closest analogues).
- Eval runner: `scripts/run-eval.mjs` (`--suite=tuition` to be added).
