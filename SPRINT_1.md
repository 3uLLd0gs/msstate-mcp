# Sprint 1 — End-to-end MVP

**Sprint goal**: get a working `chain_find_relevant_policies` answer flowing end-to-end (live MSU fetch → BM25 retrieval → MCP tool response → grounded answer in a Claude client), with CI passing, on **one** install path (`npx`). No embeddings, no plugin marketplace, no eval-harness implementation, no Project zip — those land in Sprint 2.

The point of Sprint 1 is to **prove the architecture works** before scaling out distribution and quality surfaces. If anything in the design is wrong (pdf-parse can't handle the corpus, MCP wiring leaks stdout, taxonomy parsing breaks on edge cases), we want to find out now, not after we've built the marketplace + eval + 4 install paths on top of it.

**Sprint length**: ~2 weeks for a solo developer working part-time. ~5 weeks if working in evenings only.
**Deliverable**: a tagged `v0.1.0-alpha` on a feature branch, installable via `npm install -g .` from a local clone, that answers a real MSU policy question end-to-end.
**Inputs**: [`PRD.md`](./PRD.md), [`PLAN.md`](./PLAN.md) v6, [`PRE_MORTEM.md`](./PRE_MORTEM.md), [`USER_STORIES.md`](./USER_STORIES.md).

---

## Definition of Done (sprint exit criteria)

- [ ] `node msstate-policies/dist/index.js` starts an MCP server on stdio, version + git SHA logged to stderr, no stdout output.
- [ ] `tools/list` returns exactly 5 tools.
- [ ] `chain_find_relevant_policies({question: "what's MSU's policy on amnesty?"})` returns ≥ 1 `PolicyDocument` with full PDF text, `landingUrl`, `retrievedAt`, and the `disclaimer` field from Story T4.
- [ ] `health_check` returns non-zero `index_row_count` after the first fetch.
- [ ] CI green: typecheck, build, `git diff --exit-code dist/`, fixture tests, `tools/list` smoke test (5 tools).
- [ ] Repo has README skeleton with the **honest accuracy phrasing** (T3), **privacy section** (T5), and **disclaimer language** (T4) already in place — no aspirational "99.99%" claim, no missing privacy disclosure.
- [ ] Manual smoke from a clean checkout: `npm ci && npm run build && node dist/index.js` works in one machine that's never seen the project.

Not in scope for Sprint 1: embeddings, RRF, eval-harness implementation (only writing questions), Claude Code plugin manifest, npm publish, Project zip, claude.ai connector docs, Cursor/Windsurf testing.

---

## Tasks (dependency-ordered)

Effort key: **S** ≈ < 1 day, **M** ≈ 1–3 days, **L** ≈ 3–5 days.

| # | Task | Effort | Depends on | Story / risk addressed |
|---|---|---|---|---|
| **1** | **Phase 0 PDF audit.** Write `scripts/audit-pdfs.mjs`. Download all 218 PDFs to `tmp/pdfs/`. Run each through `pdf-parse` (inner-module import). Output `eval/audit-{date}.csv` with `number, bytes, page_count, extracted_chars, first_100_chars, has_smart_quotes, parse_error`. **Decision gate**: if ≥ 95% of PDFs yield ≥ 500 chars/page on average, proceed with `pdf-parse`. If not, stop and switch to `pdfjs-dist` *before writing any tool code*. | M | (none) | PLAN §"PDF audit" |
| **2** | **Repo scaffolding.** Verify `msstate-policies/package.json`, `tsconfig.json`, `.gitignore` are correct (already scaffolded; double-check `dist/` is **not** in `.gitignore`). Pin exact `pdf-parse` version (no caret). Add `LICENSE` (MIT, copyright `mminsub11`). Write `build.mjs` (esbuild → `dist/index.js`, banner injection, format CJS, target node18). Write `scripts/sync-version.mjs` (writes `package.json#version` into `plugin.json`). | S | 1 (audit decides which PDF parser to depend on) | Story 4 (manifests scaffold), 5 |
| **3** | **Test fixtures.** Save the current `https://www.policies.msstate.edu/current` HTML to `tests/fixtures/current.html`. Pick one representative PDF (e.g. `91100.pdf`) and commit to `tests/fixtures/`. Verify both load locally. | S | (none — can run in parallel with 1, 2) | Story 10 (CI fixtures) |
| **4** | **`src/log.ts`.** Stderr-only structured JSON logger. Single export: `log(level, msg, fields?)`. Verify nothing in the project uses `console.log` (grep check). | S | 2 | PLAN §"Logging" |
| **5** | **`src/http.ts`.** `fetch()` wrapper with desktop UA (identifying the project + contact email per PRE_MORTEM E5), retry-on-429 honoring `Retry-After`, concurrency limiter (4), WAF challenge detection (throws `WAFChallengeError` on `Just a moment...`, `cf-chl-bypass`, suspicious meta refresh). | M | 4 | PLAN §"Scraper Design", PRE_MORTEM TR2 |
| **6** | **`src/types.ts`.** Define `PolicyEntry` (index row), `PolicyDocument` (with full text + metadata + `landingUrl` + `retrievedAt` + **`disclaimer` field** per Story T4), `HealthCheckResponse`. Single source of truth — every tool consumes these types. | S | 2 | Stories 1, 2, T4 |
| **7** | **`src/cache.ts`.** `TTLCache<T>` in-memory implementation. Disk cache deferred to Sprint 2. 1h TTL for index, 24h for policy bodies. **Critical correctness check**: cache must NOT store empty results from a `WAFChallengeError`. Add a unit test for that case. | S | 5 | PLAN §"TTLs", PRE_MORTEM cache poisoning |
| **8** | **`src/sources/msstate.ts`: `fetchIndex()`.** GET `/current` via `http.ts`. cheerio-parse `#datatable tbody tr`: extract `number`, `title`, `landingUrl`, `status`, `firstAuthoredOrSorted`, `pdfUrl`, `slug`. **Runtime taxonomy parsing**: parse `select[name="volume"]` and `select[name="section"]` options into `Map<id, label>`. **Sanity assertions**: `rowCount >= 100`, `volumes.size >= 1`, `sections.size >= 1` — log error to stderr on failure, populate `last_index_error`. | M | 5, 6, 7 | Stories 1, 8 (health) |
| **9** | **`src/sources/msstate.ts`: `fetchPolicy(numberOrSlug)`.** Look up in index, GET PDF, run `pdf-parse` (inner module). NFKC-normalize, strip excessive whitespace. Pull metadata (Effective Date, Last Revised, Responsible Office) via labelled regex; missing → omit field (per Story F2: do NOT leak `null` fields). Return `PolicyDocument`. **Sanity check**: < 100 chars on > 2-page PDF logs warning + falls back to landing-page extraction. | M | 8 | Stories 1, F2 |
| **10** | **`tests/scraper.test.ts`.** Parse `tests/fixtures/current.html`. Assert: ≥ 100 rows extracted, all numbers match `/^\d{2}\.\d{2}$/`, slugs derived correctly, ≥ 1 volume + ≥ 1 section in taxonomy maps. **No hardcoded taxonomy IDs anywhere in the test.** | S | 8 | Story 10 |
| **11** | **`src/search.ts`: BM25-lite.** Lowercase + NFKC normalize query and corpus. Tokenize on `/[\s\-_/.,;:()\[\]{}]+/`. BM25 with field weights title × 3, number × 2, body × 1. **Explicit "no stemmer" comment** so the next person doesn't re-litigate. Returns ranked candidates. Embeddings + RRF deferred to Sprint 2. | M | 9 | Story 1 (foundation) |
| **12** | **5 tool modules under `src/tools/`.** Each exports `{ name, description, inputSchema (zod), handler }`. Tool descriptions written verbatim from PLAN.md §"Tools" — these are the highest-leverage prompt engineering. Include the Story T4 disclaimer-in-payload requirement in `chain_find_relevant_policies` and `get_policy`. `chain_find_relevant_policies` uses `search.ts` (BM25-only for now) + `fetchPolicy()` for top-`k=2`. `health_check` reads from cache + scraper state. | M | 9, 11 | Stories 1, 2, 3, 8, T4 |
| **13** | **`src/index.ts`: MCP wiring.** Create `Server`, register `ListToolsRequestSchema` (5 tools, deterministic order, schemas via `zod-to-json-schema`), `CallToolRequestSchema` dispatcher with `isError` wrapping per the PLAN error contract. Connect `StdioServerTransport`. Startup: log version + git SHA + node version to stderr; **if `OPENAI_API_KEY` is set, log Story T5 stderr disclosure line** (even though we're not using embeddings yet — gets the warning surface in place from day 1). | M | 12 | Stories 1, T5 |
| **14** | **CI workflow.** `.github/workflows/ci.yml` running on push/PR: `npm ci` → `npm run typecheck` → `npm run build` → `git diff --exit-code dist/` → `npm test` → `tools/list` smoke (`echo '{...}' \| node dist/index.js \| jq '.result.tools \| length'` must equal 5). Eval is **not** in this workflow — separate scheduled workflow created in Sprint 2. | M | 13, 10 | Story 10 |
| **15** | **README skeleton with launch-tiger fixes baked in.** Sections: front-matter (unofficial disclaimer), install (npx path only for v0.1-alpha), tools, **Privacy** (Story T5: discloses OpenAI flow even though semantic isn't enabled in v0.1-alpha — anchors the section), **Accuracy** (Story T3 phrasing: "0 errors observed at n=50; aspirational target is 99.99%, lower-bound is ~94%; eval results forthcoming"), troubleshooting, kill-criteria note. | S | (none — can run in parallel with later tasks) | Stories T3, T5 |

### Optional / parallel-safe tasks (do these whenever you have a half-day)

| # | Task | Effort | Story / risk addressed |
|---|---|---|---|
| **A** | **Email MSU IT/Communications** with project URL + unofficial framing. One-paragraph note. | S (30 min) | PRE_MORTEM E5 |
| **B** | **Recruit a non-author** for blind eval-question writing (Story T2). Doesn't have to land in Sprint 1 — finding the person and briefing them does. | S (30 min) | PRE_MORTEM T2 |
| **C** | **Start drafting the 50 eval questions** in `eval/questions.jsonl`. Doesn't need to be complete — even 20 questions in the right schema means Sprint 2's eval-harness task starts faster. | M (cumulative) | Story 9 |
| **D** | **Survey MSU community channels** (r/msstate, advising-office FAQs) for ~15 externally-sourced eval questions per Story T2. Capture in `eval/SOURCES.md` with attribution. | M | Story T2 |

---

## Daily checkpoint sketch (rough — adjust to your pace)

| End of day | What should be working |
|---|---|
| **Day 1** | Audit script run, `pdf-parse` viability decided, repo scaffolding committed (#1, #2, #3). |
| **Day 3** | `log.ts`, `http.ts`, `types.ts`, `cache.ts` complete with unit tests (#4–#7). |
| **Day 5** | `fetchIndex()` working against fixture; scraper test green (#8, #10). |
| **Day 7** | `fetchPolicy()` working against fixture PDF; metadata extraction null-safe (#9). |
| **Day 9** | BM25 search returning sensible top-k against the live corpus (#11). |
| **Day 11** | All 5 tools implemented; MCP server starts cleanly; tools/list returns 5 (#12, #13). |
| **Day 13** | CI green on first push; README skeleton committed (#14, #15). |
| **Day 14 (sprint review)** | End-to-end smoke test on a clean machine; tag `v0.1.0-alpha`. |

If you're working evenings only, multiply by ~2.5x.

---

## Out of scope (what Sprint 2 and 3 cover)

**Sprint 2 — quality & retrieval:**
- Embeddings: `scripts/build-embeddings.mjs`, `text-embedding-3-small`, commit `dist/embeddings.json`. Hybrid retrieval with RRF (Story 1 P1 capability).
- API-key fallback path: `OPENAI_API_KEY` unset → BM25-only, stderr warning.
- Eval harness implementation (`scripts/run-eval.mjs`), three sub-metrics, LLM-judge integration.
- 50 eval questions completed, including ≥ 15 externally-sourced (Story T2).
- Disk cache via `env-paths` (Sprint 1 was memory-only).
- WAF detection battle-tested against real failure modes.

**Sprint 3 — distribution & launch:**
- Claude Code plugin manifest + marketplace JSON; verify `/plugin marketplace add` works (Story 4, PRE_MORTEM F4).
- npm publish dry-run + actual publish (Story 5).
- claude.ai connector docs (Story 6) — assumes Sprint 2 spike resolved whether stdio works there.
- Project starter zip with URL list + download script (Stories 7 + T1).
- Recorded ~3-min demo for README (PRE_MORTEM E2).
- All launch-blocking Tigers verified mitigated (Go/No-Go checklist from PRE_MORTEM).
- v1.0.0 release tag.

---

## Risks specific to this sprint

| Risk | Mitigation |
|---|---|
| **PDF audit fails the 95% threshold** → forces switch from `pdf-parse` to `pdfjs-dist`, which is heavier and changes esbuild config. | Run audit on **day 1**, not later. The whole sprint plan above assumes `pdf-parse` works; if not, replan tasks #2 and #9. Don't write tool code until the parser is decided. |
| **WAF starts blocking the scraper mid-sprint** | `http.ts` (#5) lands WAF detection early. If it triggers, slow concurrency to 2, identify in UA, consider reaching out to MSU IT (E5 outreach helps here). |
| **MCP SDK API drift** | Pin SDK version in `package.json`. Read the SDK's CHANGELOG before starting #13. |
| **Going over sprint** | If Day 7 you don't have `fetchPolicy()` working, descope: ship `chain_find_relevant_policies` with index-only metadata (no PDF body), tagged as v0.1.0-alpha-no-bodies. Sprint 2 picks up PDF bodies. Better to ship something smoke-testable than to slip the sprint by a week. |

---

## What to do at sprint review

1. Run the 8-step Definition of Done checklist top-to-bottom on a clean machine.
2. Tag `v0.1.0-alpha`. Push the tag.
3. Capture lessons-learned in a 1-page `docs/sprint-1-retro.md`: what worked, what was harder than estimated, what changes for Sprint 2 estimates.
4. Pick top 3 Sprint 2 tasks based on what you learned.
