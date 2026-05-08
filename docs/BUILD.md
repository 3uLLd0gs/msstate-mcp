# msstate-mcp — development notes

> Maintainer-facing. End users: see [`README.md`](../README.md). Future Claude sessions: also read [`CLAUDE.md`](../CLAUDE.md) for the corpus rule.

This file consolidates everything that used to live across `PLAN.md`, `PRD.md`, `PRE_MORTEM.md`, `USER_STORIES.md`, `ROADMAP.md`, `plan-codex-fixes.md`, `codex_review.md`, and the per-eval-run notes under `msstate-policies/eval/*.md`. Those were deleted on 2026-05-08 in the consolidation pass — git history has the originals.

## What this is

A Model Context Protocol server that exposes Mississippi State University's ~218 current Operating Policies (the entire `/current` index at <https://www.policies.msstate.edu/current>) to MCP-capable clients. Ask Claude (or Cursor / Windsurf / Zed / claude.ai) a natural-language policy question; the MCP fetches the relevant policies straight from MSU and Claude answers grounded in that text.

Framed as a **portfolio piece + reusable .edu-policy MCP template**, not an adoption-chasing product. Real audience is small (dozens, not thousands). Optimizations: build quality, eval rigor, template portability. Adoption metrics are watched, not gated.

## Corpus rule (load-bearing — see CLAUDE.md too)

Every fact this server returns must trace back to an HTTP fetch of `policies.msstate.edu` made by *this* server. **No** Claude memory, **no** WebSearch, **no** Wayback Machine, **no** third-party mirror. The whole grounding story collapses if inputs are contaminated. A wrong answer about amnesty / Title IX / FERPA is the worst-case failure mode.

Practical: don't seed `dist/embeddings.json`, the eval set, or any corpus snapshot from anything other than scrape output. Don't author eval `expected_op_numbers` from memory. Either confirm against the live `/current` index or leave a `TODO: confirm against live index`.

## Architecture

### Source layout

```
msstate-mcp/                              # repo root = Claude Code marketplace
├── .claude-plugin/marketplace.json       # marketplace manifest
├── README.md                             # user-facing
├── CLAUDE.md                             # session bootstrap for future Claude sessions
├── docs/BUILD.md                         # this file
├── examples/claude_desktop_config.json   # ready-to-paste snippet
├── scripts/
│   ├── audit-pdfs.mjs                    # one-time pdf-parse yield audit
│   ├── build-embeddings.mjs              # build dist/embeddings.json
│   ├── build-project-bundle.mjs          # Claude Project starter zip
│   ├── calibrate-thresholds.mts          # F2 fused/raw-BM25 score sweep
│   ├── run-eval.mjs                      # MCP-driven eval harness
│   └── sync-version.mjs                  # syncs package.json -> plugin.json
└── msstate-policies/                     # the plugin == the npm package
    ├── .claude-plugin/plugin.json        # plugin manifest (mcpServers entry)
    ├── package.json                      # publishable to npm
    ├── build.mjs                         # esbuild bundler
    ├── eval/
    │   ├── questions.jsonl               # 50 grounded-answer eval questions
    │   ├── audit-2026-05-07.csv          # PDF-parse yield audit
    │   └── eval-2026-05-08-*.json        # eval run results
    ├── tests/                            # tsx --test tests/*.test.ts
    ├── dist/
    │   ├── index.js                      # COMMITTED bundle (~14 MB)
    │   └── embeddings.json               # COMMITTED embeddings (~24 MB)
    └── src/
        ├── index.ts                      # MCP server entry (stdio)
        ├── log.ts                        # stderr-only structured logger
        ├── types.ts                      # PolicyEntry, PolicyDocument, PolicyIndex
        ├── cache.ts                      # TTLCache<T> (mem + opt-in disk)
        ├── http.ts                       # fetch with UA, retry, WAF detection
        ├── scraper.ts                    # fetchIndex(), fetchPolicy()
        ├── search.ts                     # BM25 + embeddings + RRF + gate
        ├── corpus.ts                     # batch fetchPolicy with concurrency
        ├── embed.ts                      # runtime query-embedding via OpenAI
        └── tools/
            ├── search_policies.ts
            ├── get_policy.ts
            ├── chain_find_relevant.ts
            ├── cite_policy.ts
            └── health_check.ts
```

### Tools (5)

| Tool | Purpose |
|---|---|
| `search_policies` | Keyword search over the index. |
| `get_policy` | Fetch one policy in full by number (`91.100`) or URL. |
| `chain_find_relevant_policies` | One call: hybrid retrieval + fetch top-`k` bodies. The right tool for natural-language questions. |
| `cite_policy` | Format a citation string. |
| `health_check` | Inspect scraper state — index row count, cache hit rate, last error. |

### Bundling and dist/

- TypeScript source under `msstate-policies/src/`, bundled by `build.mjs` (esbuild → CJS, single file, target node18, **non-minified** so diffs are readable).
- `dist/index.js` (~14 MB) and `dist/embeddings.json` (~24 MB) are **committed**. The plugin path resolves to `${CLAUDE_PLUGIN_ROOT}/dist/index.js` after a `claude plugin install` clone, with no `npm install` step. CI verifies `git diff --exit-code dist/` after `npm run build` (catches any source/bundle drift).
- `pdf-parse` is **pinned** (no caret) — the inner-module import (`pdf-parse/lib/pdf-parse.js`) skips the test-PDF loader, but inner layout drifts between minor versions.
- All runtime logging goes to **stderr only**. `stdout` is reserved for MCP JSON-RPC framing. One stray `console.log` corrupts the protocol. Use `src/log.ts`.

### Retrieval

Three modes selectable via `MSSTATE_POLICIES_RETRIEVAL=`:
- `bm25` (default) — BM25 over title + number + body tokens.
- `embed` — cosine over `dist/embeddings.json` chunks (~1k tokens each, 200 overlap).
- `hybrid` — RRF fusion of both ranks: `score = 1/(60+bm25Rank) + 1/(60+embedRank)`.

Default is `bm25` because the comparative eval (see "Eval results" below) found that hybrid (RRF) underperforms BM25-only. Embed-only ties BM25; BM25 wins on operational simplicity (no API key needed at runtime).

`embedSearch` returns `[]` when `OPENAI_API_KEY` is unset, so `hybrid` mode silently degrades to BM25 if the key isn't available.

Body tokens are **pre-attached** at startup from the shipped `dist/embeddings.json` chunks — this is what makes BM25-only viable for body-content queries even without the embedding model at runtime.

### Cache

`TTLCache<T>` is in-memory by default; opt in to disk persistence by setting `MSSTATE_POLICIES_CACHE=disk`. When enabled, the policy-body cache (24h TTL) writes/reads JSON at the env-paths cache dir (`%LOCALAPPDATA%` / `~/Library/Caches` / `$XDG_CACHE_HOME` per platform). Index cache stays in-memory because PolicyIndex contains cheerio-derived Maps that don't JSON round-trip cleanly, and a cold rescrape is cheap.

Persistence is best-effort: corrupt files, missing dirs, or write failures degrade to in-memory and log a warn line — they do not throw from `get()` / `set()`.

### Scraper

Index page is one `<table id="datatable">`. Each row: number (`NN.NN` or `NN.NNN`), title (links to `/policy/{slug}` where slug = number with dot stripped), status, "Date Authored" (NOT last-revised — true revision dates live in PDF metadata), attachment column, download link.

PDF URL paths are **not** stable — most are `/sites/.../files/policies/{slug}.pdf`, some are `/sites/.../files/YYYY-MM/{slug}.pdf`, and some carry `_0`/`_N` suffixes. Always **read the href verbatim from `<a class="btn-download">`**; never reconstruct it from the slug.

Volume IDs (`name="volume"`) and section IDs (`name="section"`) are Drupal taxonomy term surrogate keys. **Don't hardcode them** — parse the dropdowns at runtime to build a label↔id map. Hardcoded IDs silently break the day MSU touches Drupal.

WAF detection: site is normally fronted by F5 (its `id="f5_cspm"` script is *always* present in normal responses). Use it as a challenge signal **only** when combined with an absent `#datatable`. Cloudflare-style patterns probably never fire here.

PDF text extraction: `pdf-parse` inner-module import → NFKC normalize → strip excessive whitespace. If extracted text < `MIN_USABLE_POLICY_TEXT_CHARS = 200`, fall back to landing page; if both fail, throw — do not cache empty success.

## Decision log (chronological)

### Plan revisions (v1 → v7, all in git history)

- **v1**: 8 tools. Eval deferred. Hardcoded Drupal taxonomy IDs.
- **v2**: 5 tools. Eval = v1 prereq. Hardcoded IDs removed. `dist/` drift defended via CI.
- **v3**: Audience broadened from a single persona to "MSU community". Accuracy north star = 99.99%. Tool descriptions push verbatim quoting + refusal.
- **v4**: Project framed as portfolio + reusable .edu template (not adoption-chasing). Site-isolation: scraping logic in `src/sources/` so the rest can be reused.
- **v5**: Adoption metrics downgraded to observational; accuracy is the only kill gate.
- **v6**: Roadmap section, MSU course catalog as planned v2.0 second source.
- **v7**: Live-site verification (2026-05-07): policy-number regex corrected (`91.100` was previously rejected); PDF URL path variability documented; F5 WAF detection signature added.

### Sprint 1 — architecture validation (code-complete; never tagged `v0.1.0-alpha`)

End-to-end pipeline works on real MSU data through `npx`. CI green: typecheck, build, fixture tests, `tools/list` returns 5. README skeleton with honest accuracy phrasing.

### Sprint 2 — accuracy + privacy (mostly complete; not tagged `v0.2.0-beta`)

#### Codex adversarial review (2026-05-07)

External adversarial review flagged 4 findings on the working tree:

| ID | Finding | Resolution |
|---|---|---|
| F1 | Conceptual queries degrade to title-only retrieval when embeddings absent | `3f6b743` — pre-attach body tokens from `dist/embeddings.json` chunks before `bm25Search` |
| F2 | No confidence/scope gate before returning policies | `0edf9e4` + `dc0735f` — `gateRetrieval` with `DEFAULT_MIN_SCORE=0.01` (fused) |
| F3 | Empty/poisoned cache after PDF + landing fallback both fail | `75244b9` — `MIN_USABLE_POLICY_TEXT_CHARS=200`, `isPolicyTextUsable`, `fetchPolicy` throws on unusable text |
| F4 | Whole-doc evidence inflates distractor load | `cba897f` + `fd4bfde` — `extractMatchedPassages` + `buildEvidenceResult` surface `primaryEvidence: MatchedPassage[]` per result |

Validation eval (`ba7e67e`) confirmed clean improvement: composite **81/87 → 86/88** (+5 answer-pass).

#### F2 v2 calibration finding (2026-05-08)

Static analysis via `scripts/calibrate-thresholds.mts` showed a clean apparent gap in BM25-only mode — passing cases' top-1 BM25 was ≥ 11.93, failing cases' top-1 was ≤ 11.20. Set `DEFAULT_MIN_BM25_SCORE = 11.5` (`94ce7d8`).

Empirical eval at k=5 with Sonnet judge ($0.66) showed regression: composite **86/88 → 78/88** (−8). Root cause: `run-eval.mjs` grades retrieval as a pass when the expected OP appears in chain top-k OR via cross-references from top-k policies. Hard-rejecting at top-1 BM25 < 11.5 cuts off that recovery path for ~4 weak-keyword questions.

Rolled back in `a95db00`: `DEFAULT_MIN_BM25_SCORE = 0` (gate disabled by default). Plumbing kept (`FusedHit.bm25Score`, `GateThresholds.minBm25Score`, gate branch + test) for per-call opt-in / future hybrid-mode use.

**Architectural takeaway:** in BM25-only mode with cross-ref grounding active, the eval's retrieval metric is *more* permissive than top-k membership. To gate at the MCP layer without regressing, either the eval needs a "did MCP refuse correctly?" sub-metric, or the gate needs a multi-signal threshold. The codex F2 goal (MCP-layer refusal) stays partially open in BM25-only mode by design.

#### Disk cache via env-paths (`9018ae4`)

`TTLCache<T>` accepts `{ttlMs, persistKey?, persistDir?}` alongside the legacy number-only constructor. Policy-body cache opts in via `MSSTATE_POLICIES_CACHE=disk`. 6 TDD tests cover backward-compat, write/reload across instances, expired-entry filtering on load, `clear()` unlinking, cold-start, and corrupt-file resilience.

#### Comparative retrieval eval (2026-05-08)

Three modes, identical eval, same 50 questions, k=5, Sonnet-4-6 judge:

| Mode | Retrieval | Answer | Refusal | Composite | Cost |
|---|---:|---:|---:|---:|---:|
| **BM25 only** | 37/38 | 37/38 | 12/12 | **86/88** | $0.82 |
| Hybrid (RRF) | 36/38 | 36/38 | 12/12 | **84/88** | $0.82 |
| **Embed only** | 37/38 | 37/38 | 12/12 | **86/88** | $0.83 |

Hybrid uniquely failed "What happens if I get cited for underage drinking at a tailgate?" — embedding signal pulled `03.04` (Sexual Misconduct) to top-1 because `tailgate`/`cited` embeds near consent / Title IX language; `60.121` (HR personnel rule) to top-2/3; ejected canonical `91.119` (Sanctions for Alcohol and Drug Offenses) from top-5. RRF rank-averaging then preserved the bad ordering.

The tornado case fails all three modes — corpus-boundary issue (see "Open issues" below).

Per "if RRF underperforms either method, configure to use the winning method" (then-Sprint-2 task 2.9), default flipped to `bm25` in `72ac7c2`. Hybrid and embed remain available via `MSSTATE_POLICIES_RETRIEVAL=hybrid|embed`.

#### Manual judge-answer review (2026-05-08)

Skim of all 38 positive cases' `judge_answer` fields against question + expected_op_numbers. **No weak passes.** Patterns observed: explicit OP citation, verbatim quoting for normative claims, appropriate refusal on sub-questions the policy doesn't address (e.g. ADHD-specific accommodation list), thoughtful cross-ref usage, no fabricated OP numbers, no paraphrased binding language. The single fail (tornado, `01.04`) is correctly graded as a fail; the model refused with a redirect to MSU Emergency Management.

## Eval methodology

### The 50-question set (`eval/questions.jsonl`)

50 hand-written questions, every `expected_op_numbers` confirmed against the live MSU `/current` index on 2026-05-07 (no trained-knowledge guesses):

| Bucket | n | Example |
|---|---:|---|
| Student-life — direct (title overlap) | 10 | "What is MSU's hazing policy?" → `91.208` |
| Academic — direct | 10 | "What's the policy on final examinations?" → `12.04` |
| HR / faculty / staff — direct | 10 | "What governs employee leave and leave without pay?" → `60.201` |
| Conceptual — weak title overlap | 8 | "Can my RA write me up for lighting a candle in my dorm room?" → `91.100` (Code of Student Conduct — no candle/dorm/RA in the title) |
| Negative — no OP applies | 12 | "What's the weather forecast for Starkville next weekend?" → `null` |

Sub-metrics:

1. **Retrieval correctness** — deterministic. Pass if expected OP is in chain top-k OR via cross-references from the returned policies.
2. **Answer correctness** — Sonnet-4-6 judge (separate Claude API call) grades the final prose answer against retrieved policy text.
3. **Refusal correctness** — deterministic. For negatives, response must contain a refusal phrase AND must NOT contain a fabricated OP number matching `/\b\d{2}\.\d{2,3}\b/`.

### Current state — composite **86/88**

`msstate-policies/eval/eval-2026-05-08-k5-sonnet-4-6.json` (BM25-only, Sonnet-4-6 judge):

```
retrieval  37 / 38 passed   (1 miss: tornado conceptual case)
answer     37 / 38 passed   (1 miss: same tornado case)
refusal    12 / 12 passed
```

The Sprint 2 DoD targets ≥ 99% retrieval / 0 observed answer errors / 100% refusal. **Refusal is met; retrieval and answer are 1 short** because of the tornado case.

### Eval artifacts in `msstate-policies/eval/`

- `questions.jsonl` — the 50 questions.
- `audit-2026-05-07.csv` — Sprint 1 PDF-parse yield audit (per-policy bytes / pages / extracted chars / parse errors).
- `eval-2026-05-08-k5-sonnet-4-6.json` — **canonical** validated baseline (BM25-only, 86/88).
- `eval-2026-05-08-k5-sonnet-4-6-{bm25,hybrid,embed}.json` — comparative eval per mode.
- `eval-2026-05-08-k5-sonnet-4-6-F2v2-regression.json` — preserved snapshot of the F2 v2 regression run (78/88) so the calibration finding stays reproducible.
- `eval-2026-05-07-k5-sonnet-4-6.json` — the pre-codex-fix baseline (81/87).

### Re-running

Cheap (free, no judge):

```bash
cd msstate-policies && node --env-file=.env ../scripts/run-eval.mjs --no-judge --k 5
```

Full Sonnet judge (~$0.82):

```bash
cd msstate-policies && node --env-file=.env ../scripts/run-eval.mjs --k 5 --model sonnet-4-6
```

The eval harness writes `eval-{date}-k{N}-{model}.json` and overwrites if the file exists. Snapshot the canonical baseline before re-running if you want to preserve it.

## Open issues

### Tornado case — corpus boundary

Question: "Are there protocols if a tornado warning hits during my class?" (expected `01.04`).

OP 01.04 ("Emergency Operations") is a one-page meta-policy that says "MSU shall maintain a Campus Emergency Management Plan" and points at `emergency.msstate.edu/files/cemp.pdf`. The actual tornado protocols live in that external CEMP, **outside our corpus**. OP 01.04's text contains zero tornado-adjacent words ("tornado", "severe weather", "shelter", "warning", "evacuation", "inclement") — BM25 has nothing to match, embeddings drift to other emergency-shaped policies, and even when 01.04 is retrieved the LLM correctly says "I cannot answer from the policy text" because the answer isn't in the OP itself.

This is a corpus-shape issue, not a retrieval-quality bug. Three honest options:

1. **Test hybrid mode** ($0.66) — already done; hybrid was *worse* on this case. Skip.
2. **Revise the eval question** — either remove it, or change to a refusal-mode test ("system should respond with the OP pointer + redirect to `emergency.msstate.edu`"). Most honest given the corpus boundary.
3. **Accept and document** — README already includes the unofficial disclaimer; the OP corpus is meta-policy-shaped, some questions point to external documents we don't index. Treat 86/88 as the realistic ceiling with this corpus shape.

### Eval set is single-author

All 50 questions were author-written against the live policy index. The eval risks self-flattery: the author wrote questions knowing the answers, so retrieval may look easier than on questions composed by someone with the actual JTBD.

The fix is to source ≥ 15 questions from places where MSU community members ask things in their own voice:
- `r/msstate` (Reddit) — public threads
- MSU advising / financial aid / dean-of-students FAQ pages
- MSU Bullies (Facebook) — public posts
- A non-author cohort told only the topic, not the policy text

The corpus rule applies: the **question text** can come from anywhere, but the `expected_op_numbers` must still be looked up against the live `/current` index, not guessed. If a sourced question has no clear OP answer, mark `negative: true` instead of guessing.

This is human work — the corpus rule explicitly forbids AI-generated questions.

### WAF detection battle-test

Unit tests assert `WAFChallengeError` fires on mocked challenge responses; "battle-tested" means actually triggering it on the live MSU site once. Hand-run script that hits the site faster than rate limit allows (or with a stripped User-Agent), verifies:

1. Scraper detects the challenge (throws `WAFChallengeError` instead of returning empty success).
2. Cache doesn't pollute on the failed response (F3 fix is the relevant code path).
3. `health_check` surfaces the failure.
4. Chain tool returns a structured error rather than a confident wrong answer.

Should be done once, with care to respect MSU's site (back off on completion, document outcome).

### T4 disclaimer surfacing test

5 high-stakes question conversations across Claude Sonnet, Claude Opus, and one non-Claude client (Cursor or Windsurf). Measure: does the LLM surface the `disclaimer` field from the tool response in its answer? Target ≥ 80%. If short, tighten the tool description and re-run. Manual UI testing.

### `v0.2.0-beta` not yet tagged

Gated on the eval close-out (above) and a release decision. Sprint 3 is publishing (npm publish, marketplace listing, recorded demo, README final pass) — see git history for the original ROADMAP detail if needed.

## Next steps in priority order

1. **Decide on the tornado eval question** — option 1, 2, or 3 above.
2. **Source ≥ 15 externally-sourced eval questions** (Tiger T2). Real user voice.
3. **WAF detection battle-test** — hand-run script against live MSU site, document outcome.
4. **T4 disclaimer surfacing test** — manual UI test across 3 clients.
5. **Tag `v0.2.0-beta`** once 1–4 are addressed (or explicitly waived in the README).
6. **Sprint 3 — publish:** marketplace publishing spike, claude.ai connector spike, npm publish, examples for Cursor/Windsurf/Zed, recorded demo, README final pass, `STALENESS.md`, `docs/release.md`, Go/No-Go walkthrough, tag `v1.0.0`.

## Test inventory

`npm test` runs `tsx --test tests/*.test.ts`. Currently 23 tests:

| File | Asserts |
|---|---|
| `tests/scraper.test.ts` | Index parsing fixture; policy-number regex; only-valid-numbers emitted; normalizeText / looksLikeDataTable. |
| `tests/policy-text-usable.test.ts` | `isPolicyTextUsable` rejects empty/short/whitespace, accepts substantial text. |
| `tests/parse-fixture.test.ts` | `pdf-parse` extracts text from the committed fixture PDF. |
| `tests/body-attached-search.test.ts` | BM25 finds policies by body content once bodies are attached (F1 acceptance). |
| `tests/matched-passages.test.ts` | `extractMatchedPassages` windows around hits, merges overlap, capacity-limits. |
| `tests/retrieval-gate.test.ts` | Empty/low-score/margin gate (legacy fused signal); raw BM25 score floor when caller opts in. |
| `tests/retrieval-mode.test.ts` | `MSSTATE_POLICIES_RETRIEVAL` env var: default bm25, all three values accepted, unrecognized falls back to bm25. |
| `tests/cache-disk.test.ts` | TTLCache backward-compat, write/reload across instances, expired-entry skip on load, `clear()` unlinks file, cold-start, corrupt-file resilience. |

CI runs typecheck + build + `git diff --exit-code dist/` + tests + `tools/list` smoke (5 tools) per `.github/workflows/ci.yml`.

## Env vars

| Var | Effect |
|---|---|
| `OPENAI_API_KEY` | Enables runtime query embedding for `embed` and `hybrid` retrieval modes. Without it, those modes degrade to BM25. |
| `ANTHROPIC_API_KEY` | Used by the eval harness for the LLM-judge stage. Loaded from `.env` via `node --env-file=.env`. |
| `MSSTATE_POLICIES_RETRIEVAL` | `bm25` (default) / `embed` / `hybrid`. Controls retrieval mode. |
| `MSSTATE_POLICIES_CACHE` | Set to `disk` to enable cross-platform on-disk policy-body cache via env-paths. Default in-memory. |

## Conventions

- Single-responsibility files. `chain_find_relevant.ts` orchestrates; index/scoring lives in `search.ts`/`corpus.ts`; gating in pure `gateRetrieval`; evidence assembly in `buildEvidenceResult`.
- Pure functions where possible. Scoring, gating, passage-extraction are testable without network or model calls.
- No fail-open paths. Every catch either logs + rethrows, or logs + returns a structured error envelope. Empty strings as success markers are banned (the F3 root cause).
- Threshold values live in one place. All magic numbers (k, score floors, margins, passage windows) declared as named constants at the top of their owning module.
- All logging via `src/log.ts` to stderr only. `console.log` is forbidden in this codebase.
- Don't hardcode Drupal taxonomy IDs. Parse the dropdowns at runtime.

## What's NOT in this codebase

- Trained-knowledge content. Per the corpus rule.
- AI-sourced eval questions. Same.
- A hosted web demo. Deferred until eval + install signals justify hosting cost.
- Historical / superseded policies beyond what PDF metadata exposes.
- Telemetry server. Out of scope.
- Hardcoded policy text or cite examples. Anything that didn't come from the live site in this same session is "placeholder" or "example only" or labeled as such.
