# MSU Online module — design (v1.0.0)

**Date:** 2026-05-13
**Target release:** v1.0.0
**Status:** brainstorming approved, pending implementation plan

## Motivation

The current MCP server covers MSU's Operating Policies, calendars, courses, emergency guidance, and tuition. The biggest remaining domain prospective students ask about — and the one our existing modules silently fail on — is the **online program catalog at `online.msstate.edu`**.

A student today who asks ChatGPT or Claude:

- *"Does MSU have an online MBA?"*
- *"How do I apply to MSU online?"*
- *"Who's the academic advisor for the online psychology program?"*
- *"Does MSU online operate in my state?"*
- *"What's the application deadline for the online MS in Cybersecurity?"*

…gets either no useful answer (the model has nothing grounded to call) or a hallucinated answer (the model invents an advisor name or deadline from training data). The site has ~126 program pages plus an admissions-process page, a state-authorization page, a military-assistance page, an orientation page, a FAQ, a financial-matters page, and a central staff directory. All of it is high-volume prospect content that the corpus rule (CLAUDE.md) lets us scrape exclusively from `*.msstate.edu`.

This module adds a baked snapshot of those pages behind 4 new MCP tools. Tool count grows 18 → 22.

## Source URLs — frozen allowlist (`ONLINE_ROOTS`)

The scraper validates per-URL against this allowlist. Per-program URLs are extracted from `/academic-programs` at scrape time, never constructed from external input. Support-page slugs are pinned in a separate frozen `SUPPORT_PAGE_SLUGS` array.

```
https://www.online.msstate.edu/academic-programs        # programs index — entry point, ~126 program slugs
https://www.online.msstate.edu/admissions-process       # sectioned by student type
https://www.online.msstate.edu/staff                    # central staff directory
https://www.online.msstate.edu/                         # base — allows per-program slugs and SUPPORT_PAGE_SLUGS
```

`SUPPORT_PAGE_SLUGS` (frozen, pinned in `types.ts`):

```
state-authorization
military-assistance
orientation
faq
financial-matters
```

The base allowlist entry only matches when the URL's tail is one of:

- A slug extracted from the live `/academic-programs` index in the same scrape
- One of the SUPPORT_PAGE_SLUGS entries above

This prevents accidental URL construction from extracting other paths.

## Approach

Approach A from brainstorming: **baked snapshot, rebuilt weekly + 4 structured tools**. Mirrors the v0.8.0 tuition module pattern. No new MCP server, no runtime fetches — the snapshot is built offline and shipped in `worker/corpus.json` + the stdio bundle's `__ONLINE_CORPUS__` esbuild define.

## Module layout

```
msstate-policies/src/online/
  types.ts       # ONLINE_ROOTS + SUPPORT_PAGE_SLUGS (frozen), MAX_QUERY_CHARS,
                 # ONLINE_DISCLAIMER, OnlineProgram + OnlineAdmissionsProcess +
                 # OnlineStaffEntry + OnlineInfoPage + OnlineCorpus interfaces,
                 # OnlineWafError, OnlineParseWarning union.
  parser.ts      # cheerio extractors:
                 #   parseProgramHtml(html, slug, url)
                 #   parseAdmissionsProcessHtml(html, url)
                 #   parseStaffDirectoryHtml(html, url)
                 #   parseSupportPageHtml(html, slug, url)  (state-auth / military / orientation / faq / financial)
                 #   parseAcademicProgramsIndex(html, url)  (extracts program slugs + levels)
  scraper.ts     # isAllowedOnlineUrl, detectOnlineWaf, fetchOnce, fetchWithRetry,
                 # jitter, pool, scrapeAllOnline (two-pass entry).
  corpus.ts      # setOnlineCorpus, getOnlineCorpus, listPrograms (filtered),
                 # getProgramBySlug, fuzzy resolver helpers, info-page accessors,
                 # health getter.
  search.ts      # BM25 over OnlineInfoPage corpus (incl. staff folded as a text doc).
                 # Deterministic filter for list_online_programs (level + substring).
                 # Fuzzy name-to-program resolver for get_online_program.
```

Plus:

- `scripts/_scrape-online.ts` — subprocess scraper writing JSON to stdout, stderr-only logging
- `msstate-policies/src/tools/list_online_programs.ts`
- `msstate-policies/src/tools/get_online_program.ts`
- `msstate-policies/src/tools/get_online_admissions_process.ts`
- `msstate-policies/src/tools/find_online_info.ts`
- 4 case branches in `worker/src/index.ts`
- 4 tool registrations in `msstate-policies/src/index.ts`
- `__ONLINE_CORPUS__` esbuild `define` in `msstate-policies/build.mjs`

## Mandatory disclaimer

Single constant in `online/types.ts`:

```
ONLINE_DISCLAIMER =
  "Contact info, application deadlines, tuition, and program details on online.msstate.edu can change between releases. Verify against the source URL before applying."
```

Carried on **every response** from **every online tool**, including matched=null / empty-list / error-shape responses. Same enforcement pattern as `TUITION_DISCLAIMER` and the emergency module's `MANDATORY_DISCLAIMER`. ONL5 enforces presence across all 4 tool files.

## Row schemas (verbatim from brainstorming Section 2)

```typescript
type DegreeLevel =
  | "bachelor"
  | "master"
  | "specialist"
  | "doctoral"
  | "certificate"
  | "endorsement";

type StudentType =
  | "undergraduate"
  | "graduate"
  | "transfer"
  | "readmit"
  | "international";

type OnlineParseWarning =
  | "no_contacts_extracted"
  | "no_deadlines_extracted"
  | "tuition_unparsed"
  | "admissions_section_missing"
  | "format_field_missing";

interface OnlineContact {
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
}

interface OnlineApplicationDeadline {
  term: string;       // "Fall" | "Spring" | "Summer" — verbatim from page
  date_text: string;  // "August 1" — verbatim; NOT parsed to ISO (year context is unreliable)
}

interface OnlineEntranceExams {
  required: string[];      // ["TOEFL or IELTS for international students"]
  not_required: string[];  // ["GMAT", "GRE"]
  notes: string;           // verbatim prose for anything ambiguous
}

interface OnlineProgramTuition {
  per_credit_usd: number | null;
  instructional_fee_per_credit_usd: number | null;
  application_fee_domestic_usd: number | null;
  application_fee_international_usd: number | null;
  raw_prose: string;       // verbatim tuition section
}

interface OnlineProgram {
  slug: string;                          // "mba" | "bsee" | "psychology" — URL tail
  name: string;                          // "Master of Business Administration"
  degree_level: DegreeLevel;
  format: string;                        // "Fully online" | "Online with on-campus residency" — verbatim
  short_description: string;             // first paragraph or marketing tagline — verbatim
  url: string;
  tuition: OnlineProgramTuition;
  contacts: OnlineContact[];
  application_deadlines: OnlineApplicationDeadline[];
  admission_requirements: string;        // verbatim prose
  entrance_exams: OnlineEntranceExams | null;
  accreditation: string | null;
  forms: { label: string; url: string }[];
  raw_sections: Record<string, string>;  // section heading → verbatim prose; catch-all
  parse_warnings: OnlineParseWarning[];
  retrieved_at: string;
}

interface OnlineAdmissionsProcess {
  url: string;                           // /admissions-process
  central_contact: OnlineContact;        // ask@online.msstate.edu / (662) 325-3473
  shared_prelude: string;                // verbatim "Applying to Mississippi State Online" intro
  sections: Record<StudentType, string>; // verbatim prose per student type
  application_fee_tiers: { kind: string; usd: number }[];
  external_apply_urls: { kind: string; url: string }[];
  retrieved_at: string;
}

interface OnlineStaffEntry {
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
  office: string;                        // "Office of Online Education" | "Front Desk" | etc.
  url: string;                           // /staff (anchor if available)
  retrieved_at: string;
}

interface OnlineInfoPage {
  slug: string;                          // "state-authorization" | "military-assistance" | ...
  title: string;
  url: string;
  body_markdown: string;                 // verbatim prose; headings preserved as markdown
  retrieved_at: string;
}

interface OnlineCorpus {
  builtAt: string;
  source: "https://www.online.msstate.edu/";
  programs: OnlineProgram[];             // ~126 entries
  admissions_process: OnlineAdmissionsProcess;
  staff: OnlineStaffEntry[];             // central staff directory
  info_pages: OnlineInfoPage[];          // 5 support pages
}
```

Dates are kept verbatim. MSU writes "August 1" with no year context; parsing this to ISO would force the parser to guess the year, which is failure-prone for evergreen deadlines.

## Tool surface (4 new MCP tools)

### `list_online_programs`

```
input:
  level?:           "bachelor" | "master" | "specialist" | "doctoral" | "certificate" | "endorsement"
  subject_keyword?: string  (1–4096 chars, case-insensitive substring matched against name + short_description)
  limit?:           integer 1–200, default 50
  offset?:          integer ≥ 0, default 0

output:
  matches: Array<{ slug, name, degree_level, short_description, url }>
  total:            number   // unfiltered corpus count
  filtered_total:   number   // post-filter, pre-paging count
  disclaimer:       string   // ONLINE_DISCLAIMER
  corpus_built_at:  string
```

Browse / compare entry point. Lightweight rows for the model to enumerate without paying for the full per-program structured record. Use `get_online_program` for details.

### `get_online_program`

```
input:
  slug?:       string   // "mba" | "bsee" | … — fast path, direct lookup
  name_query?: string   // fuzzy path — BM25 over name + short_description

  Exactly one required. Both populated is a zod-rejected error.

output:
  matched:          OnlineProgram | null
  did_you_mean:     Array<{ slug: string; name: string }>  // populated when name_query routed to BM25; top-2 next-best after matched
  not_found_reason: string | null
  disclaimer:       string
  corpus_built_at:  string
```

When `slug` is given, direct hash lookup. When `name_query` is given, BM25 returns top-1 as `matched`, top-2 next-best as `did_you_mean`. Lets the model clarify if ambiguous ("Did you mean the Bachelor's or Master's in psychology?").

### `get_online_admissions_process`

```
input:
  student_type?: "undergraduate" | "graduate" | "transfer" | "readmit" | "international"
                 // optional — omit to receive ALL sections + the shared prelude

output:
  shared_prelude:        string                       // always returned
  sections:              Record<StudentType, string>  // all 5 when student_type is omitted; just the requested type when filtered
  central_contact:       OnlineContact                // always returned
  application_fee_tiers: Array<{ kind: string; usd: number }>
  external_apply_urls:   Array<{ kind: string; url: string }>
  source_url:            string                       // /admissions-process
  disclaimer:            string
  corpus_built_at:       string
```

Filtered or full. The central_contact + prelude + fees + apply URLs are ALWAYS included so the model always has the entry-point info regardless of which student-type section it read.

### `find_online_info`

```
input:
  q:      string   (1–4096 chars, required)
  k?:     integer 1–10, default 3
  scope?: "all" | "state-authorization" | "military-assistance" | "orientation" | "faq" | "financial-matters" | "staff"   default "all"

  // scope values are 1:1 with the OnlineInfoPage.slug field (plus a "staff" pseudo-slug for the central staff directory rendered as a searchable doc), so the model can use the slug it sees in earlier responses as the scope filter.

output:
  matches: Array<{
    slug:         string   // "state-authorization" | "military-assistance" | "orientation" | "faq" | "financial-matters" | "staff"
    title:        string
    excerpt:      string   // top-scoring passage, ~300 chars verbatim
    full_body:    string   // entire body_markdown — verbatim
    source_url:   string
    bm25_score:   number
  }>
  disclaimer:      string
  corpus_built_at: string
```

BM25 over the 5 `OnlineInfoPage` records + a synthesized "staff" document containing the central staff directory rendered as text. `scope` lets the model pre-filter when it knows the category. `full_body` always included so the model can quote longer passages without a follow-up call.

## Routing instructions update

Server-provided `InitializeResult.instructions` (the v0.8.0 routing string) gets a 6th rule:

```
6. Online-program / online-admissions / online-student-services questions
   ("does MSU have an online MBA?", "how do I apply to MSU online?",
   "who's the advisor for the online psychology program?",
   "what's the application deadline for the online MS in Cybersecurity?",
   "does MSU online operate in my state?", "military assistance for MSU online")
   → list_online_programs / get_online_program / get_online_admissions_process / find_online_info,
   picked by question shape.

   Distinction from policies/courses/tuition: the online module covers MSU's
   ONLINE program offerings via online.msstate.edu — distinct from the broader
   policy/course corpus. Online-specific tuition rates from controller.msstate.edu
   stay under get_msu_tuition_rate.
```

Question-routing within the online module:

- Specific program name in query → `get_online_program(name_query=…)`
- Browse / compare ("what online programs in X?") → `list_online_programs`
- Generic "how do I apply" / "how does international student apply" → `get_online_admissions_process`
- Anything else (state authorization, military, orientation, FAQ, staff lookup, financial) → `find_online_info`

## Build pipeline

`scripts/build-worker-corpus.mjs` gains a new step parallel to `scrapeTuitionViaSubprocess()`:

```javascript
1. scrapeOnlineViaSubprocess() spawns `npx tsx scripts/_scrape-online.ts`, captures stdout JSON.
2. Validates payload structure.
3. Aborts with canonical "refusing to ship a poisoned online corpus" on:
   - subprocess exit code != 0
   - JSON parse failure
   - programs.length < 100   (we expect ~126)
   - admissions_process.sections has fewer than 5 student-type entries
   - admissions_process.central_contact.email is null OR doesn't end @msstate.edu OR @online.msstate.edu
   - staff.length < 1
   - info_pages.length < 5  (state-auth + military + orientation + faq + financial)
   - any info_page body_markdown.length < 200 chars
   - more than 10 programs have parse_warnings.length > 0
     (a few broken program pages are tolerable; many = parser regression)
4. Soft-warn (does NOT abort) on individual program parse_warnings.
   Per-program warnings ship in OnlineProgram.parse_warnings.
   Aggregate count tracked.
5. Writes out.online_education = { builtAt, source, programs, admissions_process, staff, info_pages }.
```

9 canonical-string abort sites total (8 listed above + subprocess-failure catch). Matches the established tuition / emergency pattern.

`out.online_education` baked into:

- `worker/corpus.json` (Worker reads `corpus.online_education`)
- `__ONLINE_CORPUS__` esbuild `define` in `msstate-policies/build.mjs`

### Subprocess scraper

`scripts/_scrape-online.ts` mirrors `_scrape-tuition.ts`:

- stdout-only JSON output
- stderr-only logging
- `console.log = (...args) => process.stderr.write(...)` defensive redirect at the top, before any imports
- Imports `scrapeAllOnline` from `msstate-policies/src/online/scraper.js`
- Two-pass internally:
  1. Fetch `/academic-programs`, parse with `parseAcademicProgramsIndex` to get program slugs + degree levels
  2. Concurrency-pool fetch each program page + `/admissions-process` + `/staff` + the 5 support pages
- Output: `{ programs, admissions_process, staff, info_pages, per_source, anyError }`

### Worker dispatch

`worker/src/index.ts` adds a parallel block (~250 lines) modeled on the tuition block:

- Inline types (`OnlineProgram`, `OnlineAdmissionsProcess`, `OnlineStaffEntry`, `OnlineInfoPage`, `OnlineCorpus`) with `parse_warnings?` optional for forward-compat
- BM25 over `info_pages` + flattened staff doc (same field-weighted shape as the existing tuition FAQ BM25; reuses `tokenize` / `countOf` helpers already at the top of the file)
- Fuzzy program-name resolver (lower-cased substring + BM25 over name + short_description)
- 4 `tools/list` entries
- 4 `tools/call` case branches with input validation + `MAX_QUERY_CHARS` length caps on every string-input field
- `online_program_count`, `online_info_page_count`, `online_staff_count` added to `health_check`

## Security checks: ONL1–ONL5 (+12 pts; Linux CI score 257 → 269)

Append to `tools/security-checklist.sh`:

| # | Check | Pts | Mechanism |
|---|---|---|---|
| ONL1 | All `https://` URLs inside `msstate-policies/src/online/` stay on `*.msstate.edu` | 3 | `grep -rE 'https://[^"\s)]+' msstate-policies/src/online \| grep -vE 'https://[^/]*msstate\.edu' \| wc -l` must equal 0 (with `tr -d ' '` macOS-safety) |
| ONL2 | `ONLINE_ROOTS` + `SUPPORT_PAGE_SLUGS` frozen allowlists present in `types.ts` with expected entry counts | 2 | grep for `Object.freeze` on both names + assert >= 4 and == 5 entries |
| ONL3 | Worker length-caps `q`, `subject_keyword`, `name_query` before parse on online tools | 3 | grep for `MAX_QUERY_CHARS` near each of the 4 case branches |
| ONL4 | Build aborts with canonical `"refusing to ship a poisoned online corpus"` string on poisoned online corpus | 2 | `grep -c` in `scripts/build-worker-corpus.mjs` must be ≥ 8 |
| ONL5 | `ONLINE_DISCLAIMER` constant present in `types.ts` AND referenced in all 4 online tool files | 2 | grep the constant in each tool file; total references ≥ 5 |

Linux CI score: **257 → 269**. macOS shows the existing SYN4/SYN6 `wc -l` whitespace artifact (-12 pts), so macOS sees the same 257 baseline.

## Eval plan

`msstate-policies/evals/online.jsonl` — ~30 deterministic questions across 5 buckets, no LLM judge. Runner: `node scripts/run-eval.mjs --suite=online`.

### Bucket 1 — program lookup (8 questions, 100% required)

- `get_online_program(slug="mba")` → `matched.name` contains "Master of Business Administration"; `matched.contacts.length >= 1`
- `get_online_program(slug="bsee")` → `matched.degree_level == "bachelor"`; at least one contact email ends `@msstate.edu`
- `get_online_program(name_query="online psychology bachelor")` → `matched.slug == "psychology"`
- `get_online_program(slug="mba")` → `matched.application_deadlines.length >= 1` AND at least one entry's `date_text` mentions "August"
- 4 more covering different degree levels (doctoral / certificate / specialist / endorsement)

### Bucket 2 — listing / filtering (6 questions, 100% required)

- `list_online_programs(level="doctoral")` → `filtered_total >= 15`; all matches.degree_level == "doctoral"
- `list_online_programs(level="bachelor")` → `filtered_total >= 25`
- `list_online_programs(subject_keyword="engineering")` → matches contain at least 1 each of bachelor + master + doctoral
- `list_online_programs()` → `total >= 100`
- 2 more covering edge cases (empty match, limit/offset paging)

### Bucket 3 — admissions process (5 questions, 100% required)

- `get_online_admissions_process(student_type="undergraduate")` → `sections.undergraduate` contains "test-optional" OR "transcripts"
- `get_online_admissions_process(student_type="international")` → `sections.international` mentions "TOEFL" OR "IELTS"
- `get_online_admissions_process()` → all 5 student_type sections present
- `get_online_admissions_process()` → `central_contact.email == "ask@online.msstate.edu"`
- `get_online_admissions_process()` → `external_apply_urls` includes `apply.msstate.edu` AND `grad.msstate.edu`

### Bucket 4 — info search (8 questions, 90% acceptable for BM25 quirks)

- `find_online_info(q="does MSU online operate in my state", scope="state-authorization")` → top-1 `slug == "state-authorization"`
- `find_online_info(q="military tuition assistance")` → any match.slug == "military-assistance"
- `find_online_info(q="Honorlock proctoring")` → matches non-empty; any match.full_body contains "Honorlock"
- `find_online_info(q="orientation")` → top-1 slug == "orientation"
- `find_online_info(q="who runs MSU online", scope="staff")` → matches non-empty
- 3 more across FAQ + financial

### Bucket 5 — adversarial empty (3 questions, 100% required)

- `list_online_programs(subject_keyword="football")` → matches.length == 0
- `find_online_info(q="ole miss admission application")` → matches.length == 0 OR all bm25_scores below ~0.5 threshold
- `get_online_program(name_query="program that does not exist anywhere xyz")` → matched == null

**Pass threshold:** ≥ 90% across all buckets (rate / list / admissions / adversarial require 100%; info-search allows 1-2 BM25 slack).

## Test plan

Unit tests under `msstate-policies/tests/online/`:

- `types.test.ts` — `ONLINE_ROOTS` frozen + msstate-only URL; `SUPPORT_PAGE_SLUGS` frozen + 5 entries; `ONLINE_DISCLAIMER` contains "verify"; `MAX_QUERY_CHARS == 4096`; `OnlineWafError` carries URL.
- `parser-program.test.ts` — fixtures from a few program pages (MBA, BSEE, certificate). Spot-check verbatim contact name + email + deadline.
- `parser-admissions.test.ts` — fixture of `/admissions-process`. Assert all 5 student-type sections parsed, central_contact email correct.
- `parser-staff.test.ts` — fixture of `/staff`. Assert ≥ 1 entry with @msstate.edu email.
- `parser-support.test.ts` — fixtures of state-auth + military + orientation + faq + financial. Assert body_markdown ≥ 200 chars each.
- `scraper.test.ts` — mocked fetcher (no live MSU). End-to-end: full payload shape, anyError handling, allowlist enforcement, WAF detection.
- `search.test.ts` — BM25 over info_pages + filter routing for list_online_programs + fuzzy resolver for get_online_program.
- `corpus.test.ts` — baked-corpus loader smoke tests.
- 4 tool-level integration tests — happy path + zod-rejection edge cases + length-cap rejection.

Test glob extension in `msstate-policies/package.json`:

```
"test": "tsx --test tests/*.test.ts tests/courses/*.test.ts tests/emergency/*.test.ts tests/tuition/*.test.ts tests/online/*.test.ts"
```

## Net deltas

| Dimension | Before (v0.9.0) | After (v1.0.0) | Delta |
|---|---|---|---|
| Tool count | 18 | 22 | +4 |
| Source URLs allowlisted | ~30 across all modules | + 1 base + 3 fixed + ~131 derived | +~135 |
| `Course`/`Prereq` schemas | unchanged | unchanged | 0 |
| `corpus.json` size | ~5.0 MB | ~5.7 MB | +~700 KB |
| Stdio bundle size | 15.7 MB | ~16.4 MB | +~700 KB |
| Unit tests | 336 | ~370 | +~34 |
| Eval suites | 4 (policies / calendar-synonyms / courses / emergency + tuition) | + 1 (online) | +1 |
| Eval questions added | — | ~30 (online) | +30 |
| Build aborts | existing | +8 (per-category online ceilings) | +8 |
| Security checks (Linux CI) | 257 / 257 | 269 / 269 | +12 |
| Tool description edits | 0 | 4 new tools' descriptions | +4 |
| Lines added (estimate) | — | ~2,500 | parser + scraper + 4 tools + worker dispatch + tests + eval |
| New deps | 0 | 0 | 0 (cheerio already in tree) |

## Source-data quirks (handled, do not regress)

- **Program slug stability:** MSU's online site uses short slugs (`/mba`, `/psychology`) that occasionally get renamed (e.g., `/comm` for `Arts in Communication, Media & Theatre (Communication & Media Studies)`). The scraper extracts slugs from the live `/academic-programs` index — never hardcoded. A slug rename = a new record + the old slug disappears from the next build.
- **Same program name, multiple slugs:** Some programs have two URL paths (e.g., the BAS-PS general track at `/bas` + concentration-specific paths). The scraper records each as a distinct entry by slug; the fuzzy resolver in `get_online_program` returns the closest match with the rest in `did_you_mean`.
- **Deadlines are evergreen + verbatim:** MSU writes "August 1" / "December 1" / "May 15" without year context. The schema preserves these as `date_text: string`, NOT parsed to ISO. The model is responsible for explaining the date is the next occurrence of August 1 (and citing the source URL).
- **Contact info volatility:** Staff turnover happens. `ONLINE_DISCLAIMER` calls this out. The model is instructed to surface the contact + the source URL + the corpus timestamp, never assert confidence about whether the person is still in the role.
- **Some programs share advisors across concentrations:** Two programs (e.g., HDFS Child Development + HDFS Youth Development) may name the same advisor. The records are independent — no dedup. Cross-references are out of scope.
- **State authorization is genuinely useful:** `/state-authorization` lists states where MSU online cannot operate. `find_online_info(q="...", scope="state-authorization")` is the canonical route; the model should surface this proactively when a question mentions out-of-state.

## Out of scope (v1.0.0)

- Live-fetch fallback (chose baked snapshot deliberately during brainstorming)
- Cross-program comparison tool (`compare_online_programs(slugs)`)
- "Find advisor by name" reverse-lookup tool (the model can use `list_online_programs` + `get_online_program` to iterate)
- Application-deadline aggregation across all programs (`find_upcoming_online_deadlines(within_days)`)
- Course-level info for online programs (which specific courses run online — that's Banner / catalog, separate domain)
- Live financial-aid award estimates (different domain entirely; sfa.msstate.edu is partly covered by find_msu_date for deadlines)
- Localization (Spanish translation of the corpus)
- Auto-rebuild cron — manual `node scripts/build-worker-corpus.mjs` per release for now

## Release path

Single feature branch `feat/online-msu`. Standard cadence:

1. Implement scraper + parsers + tools + tests on branch
2. Live corpus rebuild against MSU; verify ≥ 100 programs, all required sections parsed, ≤ 10 program parse_warnings aggregate
3. Update `CLAUDE.md` (corpus extension addendum), `docs/BUILD.md` (online module section), `README.md` (Quality table + tools row + version banner)
4. Bump version **0.9.0 → 1.0.0** in `msstate-policies/package.json` + `worker/src/index.ts` (3 hardcoded sites)
5. PR + merge to main (`--no-ff` for visibility, matching v0.8.0 / v0.9.0 pattern)
6. Re-deploy Worker (`wrangler deploy`) + republish npm (`npm publish msstate-policies-mcp@1.0.0`) + tag v1.0.0 + push tag

**Why v1.0.0:** First non-policy-or-academic domain at this scale (126 program records, 4 tools, ~700KB corpus growth). Adds true product-market-fit feature for prospective students. Earns the major bump after seven minor releases (v0.2.0 → v0.9.0).

## Open questions

None — all resolved during brainstorming. Implementation plan follows.

## References

- Brainstorming transcript: parent conversation, 2026-05-13.
- Predecessor module patterns: `msstate-policies/src/tuition/` (v0.8.0, frozen-allowlist + structured rows + BM25 catch-all), `msstate-policies/src/emergency/` (v0.7.0, alias-resolver + WAF detect).
- Build pipeline: `scripts/build-worker-corpus.mjs` (adds the online step parallel to tuition).
- Eval runner: `scripts/run-eval.mjs` (`--suite=online` to be added).
- Server-side routing instructions: introduced v0.8.0 — gains a 6th routing rule for online.
