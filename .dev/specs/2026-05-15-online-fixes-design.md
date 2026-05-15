# v1.1.1 online module fixes + reverse-lookup tool — design

**Date:** 2026-05-15
**Status:** Design approved, ready for implementation planning
**Target release:** v1.1.1 (patch on top of v1.1.0)
**Brainstorm input:** Maintainer's live-testing report on the deployed online module (3 bugs + 1 missing feature) — surfaced during Center-for-Distance-Education workflow validation.

---

## Background

The MSU Online module shipped in v1.0.0 (2026-05-13) with 4 tools over a baked corpus of `online.msstate.edu` — 114 programs, admissions process, 23 staff, 5 support pages. The intended workflow targets MSU Center for Distance Education staff answering two operational questions:

1. **"Is THIS program mine?"** — given a program, who owns what aspect of it.
2. **"What programs am I responsible for?"** — given a person, what's their full portfolio.

Live testing against the deployed Worker (2026-05-15) found that direction 1 works correctly when called by exact slug (`get_online_program(slug="mba")`), but the fuzzy-name path that natural-language users will rely on is broken, and direction 2 isn't implementable in any reasonable LLM-loop cost.

## Problems addressed

### P1 — Fuzzy resolver fails on `"online <X>"` queries (critical)

`get_online_program(name_query="online MBA")` returns `"Online B.A.S. in Business Office Technology"` instead of the MBA program. The MBA isn't even in the `did_you_mean` alternates.

**Root cause.** The resolver tokenizes the query and scores programs as:

```
score = 4 × countOf(token, slug)
      + 3 × countOf(token, name)
      + 1 × countOf(token, short_description)
```

Every program's `name` is "Online X" and every `short_description` mentions "online" multiple times. The token `"online"` therefore contributes ~5-15 points to *every* program. The token `"mba"` matches only the MBA program's slug (`"mba"`), worth 4 points, but it doesn't appear in the spelled-out name `"Online Master of Business Administration"`. A program with a long marketing description and many `"online"` mentions outscores the actual slug match.

**Impact.** Advisors and prospective students will type `"online MBA"`, `"online MSW"`, `"online psychology bachelor"` — these are natural phrasings. A wrong result on the first query damages trust in a way that's hard to recover from in a Center-for-Distance-Education demo.

### P2 — `list_programs_by_staff` doesn't exist (missing feature)

To answer "what programs am I responsible for?", an LLM today must call `list_online_programs` (1 call) and then loop `get_online_program` over all 114 programs (114 calls), filtering for the staff member's name in each program's `contacts[]`. That's 115 tool calls per question — unreliable, slow, expensive, and almost certain to time out or be abandoned.

The data is already in the corpus (`contacts[]` per program, with role labels). It just needs to be flipped at scrape time.

### P3 — `tuition.raw_prose` leaks HTML/JS (cleanliness)

The BAS-Business Office Technology program's `tuition.raw_prose` contains `<iframe src="https://www.googletagmanager.com/..."></iframe>` and embedded site-nav text. Likely cause: GTM injects a `<noscript><iframe>` fallback, and cheerio's `.text()` extracts text content from `<noscript>` as if it were normal prose. Other `<nav>` / `<header>` / `<footer>` chrome elements likely also leak.

**Impact.** Lower severity than P1/P2 — doesn't break functionality, but the prose looks unprofessional in advisor-facing outputs.

### P4 — README staleness claim (verified non-issue)

User reported the README "still says 10 tools and three domains." Verification (grep across `README.md`, `msstate-policies/README.md`, `CLAUDE.md`, `docs/BUILD.md`) found zero matches for either string. Both READMEs were updated to v1.1.0 / 24 tools / 7 domains in commit `bda3989` (2026-05-15). The user's view is almost certainly a cached `npmjs.com/package/msstate-policies-mcp` page; npm refreshes the registry README only on publish. The v1.1.1 publish will resolve it.

No code change required for P4. Listed here so it doesn't sneak into scope.

## Goals

- **G1.** `get_online_program(name_query="online MBA")` deterministically returns the MBA program.
- **G2.** Natural-language fuzzy queries (`"online <X>"`) work for the 10 most-common programs without manual disambiguation.
- **G3.** A single tool call answers "what programs is Lily Hudson responsible for?" with role labels per program.
- **G4.** No HTML/JS noise in any program's `tuition.raw_prose`.
- **G5.** Existing 30-question online eval stays at 100% (zero regression).

## Non-goals (deferred to v1.1.2+)

- **Staff deduplication across name variants** (e.g., "Sam" vs "Samantha" appearing as separate contact entries on different program pages). Mitigated partially by the email-primary lookup strategy.
- **Cross-program role analytics** (most-assigned staff, programs without coaches, etc.).
- **Embedding-based program search** (Anthropic Haiku synonyms at build time, mirroring v0.5.0). Only if BM25 + substring pre-stage measurably underperforms on a future eval.
- **On-demand re-scrape.** The online block refreshes only quarterly.
- **README on npmjs.com.** No action — refreshes automatically on publish.

## Scope: one v1.1.1 patch release

All four changes ship together. Single PR, single release tag, single npm publish, single Worker deploy. Tool count goes **24 → 25**.

Semver note: a new tool in a patch isn't strict semver, but this project has done it before (v0.4.0 added 2, v0.7.0 added 4). Documented in `CLAUDE.md`'s v1.1.1 addendum.

## Design

### D1 — Fuzzy resolver with stop-words + substring pre-stage

**Pseudocode:**

```
function resolveProgram(query, programs):
    PROGRAM_STOP_WORDS = {"online", "program", "degree", "msu", "msstate"}
    qTokens = tokenize(query).filter(t => !PROGRAM_STOP_WORDS.has(t))

    // Empty-after-stripping → don't guess
    if qTokens.length == 0:
        return { matched: null, did_you_mean: [], match_strategy: "no_signal" }

    // Substring pre-stage (deterministic)
    qNorm = qTokens.join(" ")
    substringHits = []
    for p in programs:
        slugNorm = p.slug.toLowerCase().replace(/-/g, " ")
        nameNorm = p.name.toLowerCase()
        if slugNorm == qNorm:
            substringHits.push({ p, strength: 3 })           // exact slug
        elif slugNorm.includes(qNorm) or nameNorm.includes(qNorm):
            substringHits.push({ p, strength: 2 })           // substring
        elif qTokens.every(t => slugNorm.includes(t) or nameNorm.includes(t)):
            substringHits.push({ p, strength: 1 })           // all tokens present

    if substringHits.length > 0:
        substringHits.sort((a, b) =>
            b.strength - a.strength || a.p.name.length - b.p.name.length)
        return {
            matched: substringHits[0].p,
            did_you_mean: substringHits.slice(1, 3).map(...),
            match_strategy: "substring"
        }

    // BM25 fallback (existing weights, stop-words still stripped)
    return bm25Fallback(qTokens, programs)   // 4× slug + 3× name + 1× short_desc
```

**Stop-word set rationale:**

- `"online"` — every program name contains it; saturates BM25.
- `"program"` — appears in 60+ short descriptions; near-universal.
- `"degree"` — appears in 50+ short descriptions; near-universal in marketing copy.
- `"msu"` / `"msstate"` — boilerplate in marketing copy; matches all programs equally.

Stop-words apply ONLY to `resolveProgram`. The info-page search (`find_online_info`) keeps full tokenization since its docs aren't 100% online-saturated and `"online"` may legitimately discriminate (e.g., `"online program orientation"` vs general orientation content).

**Edge cases handled:**

| Query | qTokens after stripping | Strategy | Result |
|---|---|---|---|
| `"online MBA"` | `["mba"]` | substring on slug `"mba"` | MBA (strength 3) |
| `"online program"` | `[]` | no_signal | empty + helpful message |
| `"online social work"` | `["social","work"]` | substring `"social work"` in name | MSW |
| `"cyber"` | `["cyber"]` | BM25 (no substring hit) | MS Cyber via slug weight |
| `"computer science"` | `["computer","science"]` | all-tokens-present in name | "Online M.S. in Computer Science" |

### D2 — `list_programs_by_staff` tool

**Tool signature:**

```ts
{
  name: "list_programs_by_staff",
  description: "Look up the online programs a Center for Distance Education staff member is responsible for. Query by email (preferred — unambiguous) or by name (first, last, or full name). Returns each matching staff member's program portfolio with their role label per program. Use for 'what programs am I responsible for?' or 'who handles the MBA?' workflows.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Email address (e.g. 'lily.hudson@msstate.edu') OR name (e.g. 'Lily', 'Hudson', 'Lily Hudson'). Email match is exact; name match is case-insensitive substring.",
        maxLength: 4096
      }
    },
    required: ["query"]
  }
}
```

**Resolution algorithm:**

```
function resolveStaff(query, index):
    q = query.trim().toLowerCase()
    if q.length == 0: return []

    if q.includes("@"):
        // Email path — exact match
        return index.filter(s => s.email && s.email.toLowerCase() == q)

    // Name path — diacritic-normalized substring or all-tokens-present
    qNorm = q.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ")
    matches = []
    for s in index:
        nameNorm = s.display_name.toLowerCase()
            .normalize("NFKD").replace(/\p{Diacritic}/gu, "")
            .replace(/\s+/g, " ")
        if nameNorm.includes(qNorm):
            matches.push({ ...s, match_kind: "substring" })
        elif qNorm.split(" ").every(t => nameNorm.includes(t)):
            matches.push({ ...s, match_kind: "all_tokens" })

    matches.sort((a, b) =>
        kindOrder(a.match_kind) - kindOrder(b.match_kind) ||
        a.display_name.length - b.display_name.length)
    return matches
```

**Response shape:**

```json
{
  "query": "Lily",
  "match_count": 1,
  "matches": [
    {
      "staff": {
        "display_name": "Lily Hudson",
        "email": "lily.hudson@msstate.edu",
        "role": "Coordinator, Enrollment & Student Services"
      },
      "programs": [
        {
          "slug": "mba",
          "name": "Online MBA",
          "role_in_program": "General Program Questions, Admissions Process & Requirements"
        }
      ],
      "program_count": 1
    }
  ],
  "disclaimer": "Contact info, application deadlines, tuition, and program details on online.msstate.edu can change between releases. Verify against the source URL before applying."
}
```

**Ambiguous-name case** (e.g., `query="Knight"` matches two people): `match_count: 2`, both staff entries surfaced with their full program lists so the LLM can disambiguate by asking the user. No silent winner-picking.

**No-match case:** `match_count: 0`, `matches: []`, with a `did_you_mean` array of up to 3 closest staff names by trigram-overlap score (Jaccard similarity over character trigrams on the normalized name). Implemented inline in `search.ts` — no new dependency. Pseudocode:

```
function trigramScore(a, b):
    A = set of 3-char windows over normalize(a)
    B = set of 3-char windows over normalize(b)
    return |A ∩ B| / |A ∪ B|

did_you_mean = index
    .map(s => ({ name: s.display_name, score: trigramScore(qNorm, normalize(s.display_name)) }))
    .filter(x => x.score > 0.2)
    .sort by score desc
    .slice(0, 3)
    .map(x => x.name)
```

Trigram overlap is cheap (~30 LOC), deterministic, and good enough for "did you mean Lily Hudson?" suggestions. Disclaimer still present in the response.

### D3 — Staff-to-programs inverted index (build-time)

**Index shape (in `corpus.json.online.staff_to_programs`):**

```ts
type ProgramRef = {
  slug: string;
  name: string;
  role_in_program: string;     // from the contact entry's role label on that program page
};

type StaffEntry = {
  display_name: string;        // canonical form, longest spelling wins on dedup
  email: string | null;
  role: string;                // department title from the staff directory if available
  programs: ProgramRef[];
};

type StaffToProgramsIndex = StaffEntry[];   // flat array, ~30 entries
```

**Builder** (lives in `msstate-policies/src/online/parser.ts`, called after programs are fully parsed):

```
function buildStaffToProgramsIndex(programs, staff_directory):
    byKey = Map<string, StaffEntry>()

    for p in programs:
        for c in p.contacts:
            // Prefer email as the dedup key; fall back to normalized name
            key = c.email
                ? c.email.toLowerCase()
                : normalizeName(c.display_name)

            entry = byKey.get(key) ?? {
                display_name: c.display_name,
                email: c.email ?? null,
                role: c.role ?? "",
                programs: []
            }
            // Longest spelling wins (handles "Sam" vs "Samantha")
            if c.display_name.length > entry.display_name.length:
                entry.display_name = c.display_name
            entry.programs.push({
                slug: p.slug,
                name: p.name,
                role_in_program: c.role
            })
            byKey.set(key, entry)

    // Enrich `role` field from the staff_directory where possible
    for entry in byKey.values():
        if entry.email:
            staffRecord = staff_directory.find(s => s.email == entry.email)
            if staffRecord: entry.role = staffRecord.title ?? entry.role

    return Array.from(byKey.values())
```

**Why a flat array (not a `Record<email, programs>`):**

- Total staff count is ~30 — linear scan is faster than hash-then-merge.
- Substring name match needs to walk all entries anyway.
- Single representation handles both email and name lookup modes.

**Size impact:** ~5-15 KB added to `corpus.json` (well under the Worker's 25 MB bundle limit).

### D4 — HTML strip in tuition parser

Two call sites in `parseTuition`:

```ts
// Site 1 — primary tuitioncowbell path (current line ~310)
if ($cowbell.length > 0) {
  const $parent = $cowbell.parent();
  $parent.find("script, style, noscript, iframe, nav, header, footer").remove();  // ← NEW
  $parent.find("table tr").each(...);
  raw_prose = $parent.text().replace(/\s+/g, " ").trim();
}

// Site 2 — BAS-style quickInner fallback (current line ~526)
if (!tuition.raw_prose) {
  const $block = $("strong#credit_hours").closest("div.quickInner");
  if ($block.length) {
    $block.find("script, style, noscript, iframe, nav, header, footer").remove(); // ← NEW
    tuition.raw_prose = $block.text().trim().slice(0, 400);
  }
}
```

cheerio `.remove()` mutates the in-memory tree but not the underlying HTML buffer — safe to call before downstream selectors. Strip applies ONLY to tuition prose paths in v1.1.1; other `raw_*` paths (admission_requirements, raw_sections) are deferred since live testing didn't surface leakage there.

### D5 — Worker dispatch mirror

`worker/src/index.ts` adds:

- One entry in the `tools/list` array (with the same description as the stdio tool).
- One case in the `tools/call` switch dispatching to a Worker-local `handleListProgramsByStaff` helper.
- The same `resolveStaff` algorithm (TypeScript copy of the stdio implementation — no shared module imports across the stdio/worker boundary, per existing pattern).
- The `staff_to_programs` index read from `BAKED_CORPUS.online.staff_to_programs` at module-load time.
- Tool count constant bumped: any place that asserts 24 becomes 25.

CI smoke test in `.github/workflows/ci.yml` already asserts tool count — bump the assertion from `24` to `25`.

## Build-time guards

Two new abort sites in `scripts/build-worker-corpus.mjs` (`scrapeOnlineViaSubprocess`), both using the canonical `"refusing to ship a poisoned online corpus"` string:

1. `staff_to_programs` array is empty or missing.
2. `staff_to_programs` total program-ref count is 0 (every staff has 0 programs).

The 13 existing canonical abort sites in this section become **15**. ONL4's security check (which counts canonical-string occurrences) requires updating: current target `>= 8`, becomes `>= 10`.

## Eval delta

Online eval stays at `msstate-policies/eval/online.jsonl`. Current 30 questions remain (regression baseline — must stay 100%). Adds:

**Fuzzy regression bucket (10 cases):**

The exact 10 query/slug pairs are authored against the live `online.msstate.edu` scrape during implementation — every `expected_slug` MUST be confirmed against the corpus snapshot in the same session per the corpus rule (CLAUDE.md). Below are the *query patterns* the bucket must cover — the implementer fills in the live slug for each:

| Query pattern | Picks which program |
|---|---|
| `"online MBA"` | the MBA program |
| `"online MSW"` (acronym) | the Master of Social Work program |
| `"online social work"` (spelled out) | the Master of Social Work program |
| `"online psychology bachelor"` | the undergraduate psychology BA/BS |
| `"online cybersecurity"` | the MS in cybersecurity |
| `"online MS in computer science"` | the MS in computer science |
| `"online BAS business"` | the BAS in Business Office Technology |
| `"online graduate education"` | any one of the M.Ed. programs (record exact slug) |
| `"online RN to BSN"` | the RN-to-BSN program |
| `"online ag economics"` | the MS in agricultural economics |

Threshold: **10/10 (100%)** — substring matching is deterministic, no LLM-judge ambiguity. If MSU has discontinued any of these programs by build time, the implementer substitutes another live program in the same category and documents the swap in the eval row's metadata.

**Staff-lookup bucket (5 cases):**

Same corpus-rule constraint: the implementer picks 5 staff queries against the live scrape's `staff_to_programs` index. Pattern coverage required:

| Query pattern | Expected behavior |
|---|---|
| One real `@msstate.edu` email from a live staff entry | exactly 1 staff match with `program_count >= 1` |
| Distinct first name appearing in exactly one staff record | exactly 1 staff match by substring |
| Distinct last name appearing in exactly one staff record | exactly 1 staff match by substring |
| Substring that appears in two or more live staff names (often a common last name) | `match_count >= 2`, both surfaced |
| A nonsense string e.g. `"NoSuchPerson"` | 0 matches, empty `matches` array, `did_you_mean` populated with 3 closest names |

Threshold: **5/5 (100%)**.

**Overall online eval gate:** 45/45 (100% existing + new). Ship-blocker.

## Tests

Three new test files under `msstate-policies/tests/online/`:

1. **`search-program-resolver.test.ts`** — table-driven, covers:
   - no_signal case (empty after stripping)
   - exact-slug substring win (MBA case)
   - substring-in-name win (MSW case)
   - all-tokens-present win (computer science case)
   - BM25 fallback (cyber case)
   - sort stability under equal strength (shortest-name wins)

2. **`search-staff-resolver.test.ts`** — table-driven, covers:
   - email exact match
   - first-name substring
   - last-name substring
   - ambiguous (multiple matches)
   - no-match + did_you_mean
   - diacritic normalization (one fixture entry with accented characters)

3. **`parser-tuition-html-strip.test.ts`** — fixture HTML with embedded `<noscript><iframe src="https://www.googletagmanager.com/..."></iframe></noscript>` and a `<nav>` block; assert `tuition.raw_prose` contains none of `<iframe`, `<script`, `<noscript`, `<nav`.

## Security checklist updates

- **ONL4** — canonical "refusing to ship a poisoned online corpus" count: bump target from `>= 8` to `>= 10` (two new abort sites in D3 + D4 area).
- **ONL5** — ONLINE_DISCLAIMER referenced in tool files: bump target from `4 tool files` to `5 tool files` (new `list_programs_by_staff.ts`).

Score delta: **0** — both updates are target-count refreshes, not new checks. Score stays at **284/284**.

No new security checks are needed: `list_programs_by_staff` is a lookup over an existing in-memory data structure; no new URLs, no new fetch surface, input length already capped by the Worker's global `MAX_QUERY_CHARS`.

## File-by-file change list

| File | Change | LOC est. |
|---|---|---|
| `msstate-policies/src/online/types.ts` | Add `ProgramRef`, `StaffEntry`, `StaffToProgramsIndex` types | +30 |
| `msstate-policies/src/online/search.ts` | Replace `bestMatchByName` with new `resolveProgram` (stop-words + substring pre-stage). Add `resolveStaff` helper. | +120 / -30 |
| `msstate-policies/src/online/parser.ts` | (a) HTML-strip at 2 call sites in `parseTuition`. (b) New `buildStaffToProgramsIndex` function called after programs assembled. | +60 |
| `msstate-policies/src/online/corpus.ts` | Surface `staff_to_programs` from corpus to tool handlers | +10 |
| `msstate-policies/src/tools/list_programs_by_staff.ts` | NEW — tool handler, calls `resolveStaff`, formats response | +80 |
| `msstate-policies/src/index.ts` | Register the new tool | +3 |
| `worker/src/index.ts` | Mirror tool registration + dispatch + resolveStaff helper + tool-count assertion bump | +70 |
| `scripts/_scrape-online.ts` | Emit `staff_to_programs` in the subprocess output JSON | +5 |
| `scripts/build-worker-corpus.mjs` | 2 new abort sites in online block | +15 |
| `tools/security-checklist.sh` | Bump ONL4 target count, ONL5 file count | +2 / -2 |
| `msstate-policies/eval/online.jsonl` | +15 new eval rows (10 fuzzy + 5 staff) | +15 rows |
| `msstate-policies/tests/online/search-program-resolver.test.ts` | NEW | +90 |
| `msstate-policies/tests/online/search-staff-resolver.test.ts` | NEW | +80 |
| `msstate-policies/tests/online/parser-tuition-html-strip.test.ts` | NEW + 1 fixture HTML file | +60 |
| `msstate-policies/package.json` | Version 1.1.0 → 1.1.1 | trivial |
| `msstate-policies/.claude-plugin/plugin.json` | Version 1.1.0 → 1.1.1 | trivial |
| `worker/src/index.ts` | Version string 1.1.0 → 1.1.1 | trivial |
| `README.md` | Tool count 24 → 25; new tool row in catalog; `list_programs_by_staff` example in dining-or-online section | +20 |
| `CLAUDE.md` | v1.1.1 addendum capturing new tool + corpus-rule diff (none — no new URLs); update version/tool-count in "What this repo is" | +30 |
| `docs/BUILD.md` | Extend "## MSU Online module" section with v1.1.1 sub-section: D1-D5 rationale + the source-data quirk about long short_descriptions inflating BM25 | +40 |
| `msstate-policies/README.md` | Tool count 24 → 25; list_programs_by_staff in online tools row | +3 |
| `.github/workflows/ci.yml` | Smoke-test tool-count assertion 24 → 25 | trivial |

**Total estimate:** ~750 LOC added, ~30 removed, +15 eval rows, +3 test files. Single PR.

## Acceptance criteria

A v1.1.1 release is accepted when ALL of:

1. CI green on the v1.1.1 tag commit (typecheck, build, dist/ body diff, tools/list count == 25, npm audit, security checklist >= 100).
2. Security checklist score == **284** (no regression).
3. New tests pass: `parser-tuition-html-strip`, `search-program-resolver`, `search-staff-resolver`.
4. Online eval: **45/45 (100%)** — 30 existing + 10 fuzzy regression + 5 staff lookup.
5. Manual smoke: `get_online_program(name_query="online MBA")` returns MBA (slug `mba`).
6. Manual smoke: `list_programs_by_staff(query=<one real live staff email>)` returns ≥1 program. (Implementer picks the email at release-validation time from the freshly-built corpus.)
7. Manual smoke: `list_programs_by_staff(query="Knight")` returns >=2 staff if multiple "Knight" entries exist in live data; else exactly 1.
8. Corpus-level grep on `worker/corpus.json`: zero occurrences of `<iframe`, `<script`, `<noscript`, `<nav` inside any program's `tuition.raw_prose` value.
9. npm publish succeeds, Worker deploy succeeds, `tools/list` against the live Worker returns 25 tools.

## Out-of-scope items (deferred)

Listed so they don't sneak in mid-implementation:

- Cross-program staff dedup beyond email-match (e.g., "Sam Clardy" vs "Samantha Clardy" if email differs or absent on one page). Mitigated by email-primary lookup; revisit only if v1.1.1 demo surfaces this.
- Cross-program role analytics (most-assigned staff, programs without an enrollment coach).
- Embedding-based program search (v0.5.0 calendar-synonym pattern).
- BM25 search-as-you-type / autocomplete.
- On-demand re-scrape between quarterly refreshes.
- Broader HTML strip on other `raw_*` fields (admission_requirements, raw_sections, accreditation).

## Risks

- **R1 — Stop-word over-removal.** Adding `"program"` and `"degree"` to PROGRAM_STOP_WORDS could hurt queries that legitimately need those tokens (e.g., `"degree completion program"`). **Mitigation:** the eval bucket includes queries that rely on substring matching, not BM25 — those still work after stop-word removal. If post-ship monitoring shows degraded performance on queries that genuinely need `"degree"`, narrow the stop-word set.

- **R2 — Staff dedup wrong.** If two staff legitimately share a first OR last name and the parser-built index merges them, the response is misleading. **Mitigation:** email is preferred as the dedup key when present; only name-collision-with-no-email cases are at risk. Build-time validation could surface this (count of staff entries with email vs without) but isn't in v1.1.1's scope.

- **R3 — Substring pre-stage too aggressive.** A query like `"online business"` matches both `Online MBA` (slug `mba` doesn't contain "business", but name does) and `Online B.A.S. in Business Office Technology` (multiple substring hits). **Mitigation:** sort tie-breaks by shortest name wins (more specific), and `did_you_mean` surfaces the others so the LLM can ask.

- **R4 — Tool count inflation in patch versions.** Past releases added tools in patches; this continues the pattern. **Mitigation:** documented in CLAUDE.md addendum; bump to v1.2.0 instead if the user prefers strict semver (call-out in writing-plans).

## Notes for `writing-plans`

When the implementation plan is written, sequence the work so independent agents can parallelize:

- **Wave 1 (independent):**
  - HTML strip in `parser.ts` (D4)
  - `resolveProgram` in `search.ts` (D1)
  - `buildStaffToProgramsIndex` in `parser.ts` (D3)
- **Wave 2 (depends on Wave 1):**
  - New `types.ts` entries (consumed by D2/D3)
  - New `list_programs_by_staff.ts` tool file (depends on `resolveStaff` + types)
  - `corpus.ts` plumbing (depends on `staff_to_programs` shape)
  - Worker mirror (`worker/src/index.ts`)
- **Wave 3 (depends on Waves 1-2):**
  - `scripts/_scrape-online.ts` emit
  - `scripts/build-worker-corpus.mjs` abort sites
  - Eval rows + tests
  - Security checklist target bumps
  - Docs (README, CLAUDE.md, BUILD.md)
- **Wave 4 (release ritual, serial):**
  - Version bumps in package.json + plugin.json + worker
  - CI smoke-test tool-count bump
  - Rebuild dist/ + corpus.json
  - PR + merge + tag + publish

This structure preserves the project's pattern (single PR, all-or-nothing).
