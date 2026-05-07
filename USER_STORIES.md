# Backlog: MSU Policies MCP Server v1.0

**Format**: User stories (Card / Conversation / Confirmation, INVEST-validated)
**Total stories**: 15 (10 P0s from [`PRD.md`](./PRD.md) §5 + 5 launch-blocking Tigers T1–T5 from [`PRE_MORTEM.md`](./PRE_MORTEM.md))
**Estimated total effort**: ~7L + 7M + ~6S = roughly 3 sprints for a solo developer

All 15 stories are P0 (launch-blocking). Effort: **S** ≈ < 1 day, **M** ≈ 1–3 days, **L** ≈ 3–5 days.

---

## Stories

### Story 1: Grounded chain answer

**As an** MSU community member
**I want** to ask Claude a natural-language MSU policy question and get a grounded answer that quotes verbatim from the canonical policy text
**so that** I can act on the answer without separately verifying every load-bearing claim.

**Conversation**: This is the headline JTBD — the entire reason the project exists. The chain tool fetches full policy text in one call so the LLM never has to draw on outside knowledge for normative claims. Tool description enforces "quote verbatim, refuse if uncertain."

**Acceptance Criteria**:
- [ ] `chain_find_relevant_policies({question, k=2})` returns an array of `PolicyDocument` objects with full text body, OP number, title, `landingUrl`, `retrievedAt`.
- [ ] Tool description text in the published `tools/list` response contains the verbatim "RULES for answering" block from PLAN.md §"Tools" (use only returned text; quote verbatim for normative claims; refuse if unclear; cite OP + URL + retrievedAt).
- [ ] Default `k=2` keeps a typical response payload under 16k tokens (verified on 5 representative questions).
- [ ] When called with a question covered by an MSU policy, the response array is non-empty and contains the expected canonical OP for ≥ 99% of the eval set.
- [ ] Eval's answer-correctness sub-metric scores 0 observed errors after 100% manual review.

**Priority**: P0 | **Effort**: L | **Dependencies**: scraper (PDF fetch + parse), retrieval (BM25 + embeddings + RRF), MCP wiring | **INVEST**: ✓

---

### Story 2: Verifiability of every answer

**As an** MSU community member who got an answer from the MCP
**I want** the canonical source URL and retrieval timestamp included in every response
**so that** I can verify against the official site before acting on anything important.

**Conversation**: Trust mechanism. PRE_MORTEM T4 elevates this: the README disclaimer is invisible at point of use, so verifiability metadata must travel inside the response payload itself.

**Acceptance Criteria**:
- [ ] Every `PolicyDocument` returned by `get_policy` and `chain_find_relevant_policies` includes `landingUrl` (canonical `/policy/{slug}` URL, absolute) and `retrievedAt` (ISO 8601 with timezone).
- [ ] `landingUrl` is verified to be the public-facing landing page, not the PDF URL.
- [ ] `retrievedAt` reflects the moment the body was fetched/cached, not the moment of the current call (so a 24h-cache hit shows the original fetch time).
- [ ] Manual test: 5 chain calls, each response shows a clickable canonical URL that loads the corresponding policy page on policies.msstate.edu.

**Priority**: P0 | **Effort**: S | **Dependencies**: Story 1 | **INVEST**: ✓

---

### Story 3: Plain refusal on negative cases

**As an** MSU community member who asked a question with no MSU-policy answer ("what's MSU's policy on alien encounters?")
**I want** a plain refusal that recommends the responsible office
**so that** I'm not misled by a fabricated citation.

**Conversation**: Refusal correctness is one of the three accuracy gates. Bigger risk than wrong answers because users can't tell a fabricated `\d{2}\.\d{2}` OP number from a real one without checking.

**Acceptance Criteria**:
- [ ] Tool description tells the LLM: "if returned policies don't clearly answer, say so plainly; do NOT extrapolate."
- [ ] On all 12 negative-case eval questions, the LLM response contains a refusal phrase from the approved list (e.g. "no MSU policy directly covers", "the available policies do not address").
- [ ] On all 12 negative-case eval questions, the response contains zero strings matching `/\b\d{2}\.\d{2}\b/` (no fabricated OP numbers).
- [ ] Refusal-correctness sub-metric scores 100% on the eval.
- [ ] At least 3 of the 12 negative cases are deliberately written to look "policy-shaped" (e.g. dress code, parking on game day) so the LLM is tempted to make something up.

**Priority**: P0 | **Effort**: M | **Dependencies**: Story 1, eval harness (Story 9) | **INVEST**: ✓

---

### Story 4: 2-command install on Claude Code

**As a** Claude Code user
**I want** to install with `/plugin marketplace add` + `/plugin install`
**so that** I don't have to edit any JSON or write a config file.

**Conversation**: The lowest-friction install surface. Same `dist/index.js` runs as the npm path; difference is just the marketplace + plugin manifest layer.

**Acceptance Criteria**:
- [ ] Repo root contains `.claude-plugin/marketplace.json` listing `msstate-policies` with `source: "./msstate-policies"`.
- [ ] `msstate-policies/.claude-plugin/plugin.json` exists with the `mcpServers` entry pointing at `${CLAUDE_PLUGIN_ROOT}/dist/index.js`.
- [ ] After `/plugin marketplace add mminsub11/msstate-mcp` and `/plugin install msstate-policies@msstate-mcp` on a clean Claude Code installation, `tools/list` returns exactly 5 tools.
- [ ] Plugin version in `plugin.json` matches `package.json#version`, written by `scripts/sync-version.mjs` (manual edit not required).
- [ ] Manual smoke test on a clean machine completes the install and answers one policy question end-to-end.

**Priority**: P0 | **Effort**: M | **Dependencies**: Story 1, dist bundle, version sync | **INVEST**: ✓

---

### Story 5: Plain-MCP install via npx

**As a** Claude Desktop / Cursor / Windsurf / Zed user
**I want** a JSON config snippet I can paste to enable the MCP via `npx`
**so that** I can use the same server outside Claude Code.

**Conversation**: Power-user surface. The npm package and the plugin distribute the same `dist/index.js`.

**Acceptance Criteria**:
- [ ] `msstate-policies` is publishable to npm with `bin: dist/index.js` and a `prepublishOnly` step that runs build + version-sync.
- [ ] `examples/claude_desktop_config.json` contains a working snippet using `npx -y msstate-policies-mcp`.
- [ ] On a clean machine with Node 18+, pasting the snippet into `claude_desktop_config.json` and restarting Claude Desktop loads the MCP successfully.
- [ ] README documents the same snippet with adaptations for Cursor, Windsurf, Zed.
- [ ] `npx -y msstate-policies-mcp` exits 0 and prints version + git SHA to stderr on startup.

**Priority**: P0 | **Effort**: M | **Dependencies**: Story 1, npm publishing setup | **INVEST**: ✓

---

### Story 6: Paid claude.ai MCP-connector path

**As a** paid claude.ai user
**I want** documented copy-paste instructions for the MCP-connector UI
**so that** I can install without editing any config files.

**Conversation**: claude.ai's MCP-connector UI accepts a remote MCP URL or stdio command snippet. We document the npx form.

**Acceptance Criteria**:
- [ ] README has a labeled "claude.ai (paid)" section with screenshot or step-by-step click path.
- [ ] The documented configuration uses the same `npx -y msstate-policies-mcp` invocation as Story 5.
- [ ] Manual verification: on a paid claude.ai account, following the documented steps loads the MCP and a sample query returns a grounded answer.
- [ ] If claude.ai's MCP-connector requires only remote/HTTP MCPs (not stdio), the README documents that limitation honestly and points users to the desktop path.

**Priority**: P0 | **Effort**: S | **Dependencies**: Story 5 | **INVEST**: ✓ (note: depends on claude.ai connector capabilities — flag for spike if connector turns out to be HTTP-only)

---

### Story 7: Free claude.ai user gets a Project starter

**As a** free claude.ai user with no MCP support
**I want** a one-click Project starter (URL list + system prompt + download script)
**so that** I can use Claude with grounded MSU policy answers without paying or installing.

**Conversation**: Originally a zip of bundled PDFs; PRE_MORTEM T1 changes this to URL list + script instead of bundled PDFs (avoids redistribution risk). See Story T1.

**Acceptance Criteria**:
- [ ] `scripts/build-project-bundle.mjs` produces a zip containing: `policies.txt` (list of ~30 high-traffic canonical URLs), `system-prompt.md` (template), `download.sh` and `download.ps1` (cross-platform fetch scripts).
- [ ] System prompt template includes: "answer only from the attached policy text"; "quote verbatim for normative claims"; "cite the OP number and source URL"; "refuse if not covered by the attached policies."
- [ ] Released as a GitHub release asset attached to each tagged release.
- [ ] Manual test: drop the unzipped bundle into a free claude.ai Project, run the download script locally to attach the PDFs, ask one policy question — answer is grounded with citation.
- [ ] README labels the Project path as "degraded: ~30 policies, not the full 218; live MCP recommended where possible."

**Priority**: P0 | **Effort**: M | **Dependencies**: T1 (which replaces the original PDF-bundling design) | **INVEST**: ✓

---

### Story 8: Health-check tool

**As an** operator (or the LLM itself mid-conversation)
**I want** a `health_check` tool that exposes scraper state
**so that** the LLM can apologize coherently when the scraper is broken instead of confidently saying "MSU has no policy on amnesty."

**Conversation**: The single best mitigation against silent scraper failure leaking out as confidently-wrong "no such policy" answers. Tool is intentionally exposed to the LLM, not just operators.

**Acceptance Criteria**:
- [ ] `health_check` tool returns `{ index_row_count, last_index_fetch, last_index_error, volumes_discovered, sections_discovered, cache_hit_rate, version, git_sha }`.
- [ ] `index_row_count` reflects the most recent successful fetch; if zero, `last_index_error` is populated with the WAF/parse error reason.
- [ ] `version` and `git_sha` match the values printed in the bundle banner.
- [ ] Tool is listed in `tools/list` with a description telling the LLM to call it when search returns empty/unexpected results.
- [ ] Manual test: simulate a WAF challenge by intercepting the request; `health_check` reports the failure and `chain_find_relevant_policies` returns a structured `isError` rather than empty success.

**Priority**: P0 | **Effort**: M | **Dependencies**: scraper, cache, version-sync | **INVEST**: ✓

---

### Story 9: Eval harness with three sub-metrics

**As a** maintainer
**I want** to run `npm run eval` and see retrieval, answer, and refusal correctness scored independently
**so that** I have a defensible gate before each release.

**Conversation**: This is the project's quality gate. Three sub-metrics because no single eval can measure 99.99% directly.

**Acceptance Criteria**:
- [ ] `eval/questions.jsonl` contains 50 questions in the schema `{q, expected_op_numbers[], must_cite, negative, must_quote_verbatim, notes}`.
- [ ] Question composition: 10 student-life + 10 academic + 10 HR/faculty + 8 conceptual stress-test + 12 negative — and ≥ 15 are sourced from real MSU community channels per Story T2.
- [ ] `scripts/run-eval.mjs` drives the MCP server via stdio JSON-RPC and produces `eval/eval-{date}.json` with per-question pass/fail per sub-metric and aggregate scores.
- [ ] **Retrieval correctness** (deterministic): for each non-negative question, `chain_find_relevant_policies(q).results.map(p => p.number)` includes `expected_op_numbers[0]`.
- [ ] **Answer correctness** (LLM-judge): a separate Claude API call grades each answer against the retrieved policy text using the prompt from PLAN.md §"Eval"; manual review of 100% of judged answers before release.
- [ ] **Refusal correctness** (deterministic): for each `negative: true` question, response contains an approved refusal phrase AND no fabricated OP-number pattern.
- [ ] Aggregate output reported as: retrieval ≥ 99%, answer = 0 observed errors, refusal = 100%.

**Priority**: P0 | **Effort**: L | **Dependencies**: Story 1, T2 (curator-bias mitigation) | **INVEST**: ✓

---

### Story 10: CI catches the silent-failure modes

**As a** maintainer
**I want** CI to run typecheck, build, dist-drift, fixture tests, and a `tools/list` smoke check on every push
**so that** common regressions don't reach a release tag.

**Conversation**: `git diff --exit-code dist/` is the single most important hygiene check — committed bundle drifting from source is the most common silent failure for the dist-committing pattern.

**Acceptance Criteria**:
- [ ] `.github/workflows/ci.yml` runs on push and PR with these steps in order: `npm ci` → `npm run typecheck` → `npm run build` → `git diff --exit-code dist/` → `npm test` → tools/list smoke.
- [ ] tools/list smoke: pipes a `tools/list` JSON-RPC envelope to `node dist/index.js` and asserts the response contains exactly 5 tools.
- [ ] Fixture tests: `scraper.test.ts` parses the saved `tests/fixtures/current.html` and asserts row count ≥ 100, ≥ 1 volume, ≥ 1 section. `parse-fixture.test.ts` imports `dist/index.js` and parses `tests/fixtures/91100.pdf` end-to-end.
- [ ] Eval is **not** in the per-push CI (it makes live MSU requests); a separate scheduled workflow runs nightly + on `release/*` branches.
- [ ] CI badge in README reflects current build status.

**Priority**: P0 | **Effort**: M | **Dependencies**: Stories 1, 4, 5, 8, 9 | **INVEST**: ✓

---

### Story T1: Project zip ships URL list, not bundled PDFs

**As a** project maintainer concerned about MSU brand and copyright
**I want** the Claude Project starter zip to contain canonical URLs + a download script, not bundled PDF files
**so that** I'm not redistributing MSU's documents under their name.

**Conversation**: PRE_MORTEM T1. Bulk-redistributing institutional PDFs in a GitHub release is a category step beyond runtime retrieval. Keep the zip path but flip its contents.

**Acceptance Criteria**:
- [ ] `scripts/build-project-bundle.mjs` no longer downloads PDFs at build time.
- [ ] Output zip contents: `policies.txt` (one canonical URL per line), `system-prompt.md` (template referencing the user's locally-downloaded PDFs), `download.sh` and `download.ps1` (cross-platform fetch scripts the user runs once).
- [ ] System prompt template instructs Claude to treat attached PDFs as the only source of truth.
- [ ] Zip size < 50 KB (down from ~30 MB if PDFs were bundled).
- [ ] README "free claude.ai" section explains the two-step flow (download zip → run script → attach PDFs to Project) and credits MSU as the source.

**Priority**: P0 (launch-blocking Tiger) | **Effort**: S | **Dependencies**: replaces the original Story 7 design | **INVEST**: ✓

---

### Story T2: Eval set includes externally-sourced questions

**As a** maintainer who wants the eval to reflect real questions, not curator preferences
**I want** ≥ 15 of the 50 eval questions to come from real MSU community channels (or written by a non-author)
**so that** "passes eval" actually correlates with "works for users."

**Conversation**: PRE_MORTEM T2. Single-author eval is the most common quality theater in eval-driven projects. Sources: r/msstate, MSU student-services FAQs, MSU Bullies subreddit, MSU advising office FAQs, friend writing blind.

**Acceptance Criteria**:
- [ ] At least 15 questions in `eval/questions.jsonl` have a `source` field naming a real MSU community channel or "blind-author" identity (not the project owner).
- [ ] Source documentation in `eval/SOURCES.md` shows where each externally-sourced question came from (URL, thread, or "blind-author").
- [ ] Composition still respects the original 10/10/10/8/12 split across categories.
- [ ] At least 5 externally-sourced questions stress conceptual retrieval (weak keyword overlap).
- [ ] Eval passes the three sub-metric gates (Story 9) on the externally-sourced subset *as well as* on the full set.

**Priority**: P0 (launch-blocking Tiger) | **Effort**: M | **Dependencies**: Story 9 | **INVEST**: ✓

---

### Story T3: README reports "0 errors at n=50," not "99.99%"

**As a** first-time README reader who's deciding whether to trust the project
**I want** accuracy claims to be honestly bounded by the eval's sample size
**so that** I'm not misled by an aspirational headline number.

**Conversation**: PRE_MORTEM T3. PLAN.md already concedes a 50-question eval can't measure 99.99%. The risk is launch marketing repeats the aspirational number anyway. Fix once, ship right.

**Acceptance Criteria**:
- [ ] README "Accuracy" section opens with the literal sentence: *"Eval result: 0 answer-correctness errors observed on a 50-question hand-written eval. The 50-question set provides a ~94% lower bound on answer correctness; the 99.99% target named in `PLAN.md` is aspirational, not measured."*
- [ ] No marketing surface (README headline, GitHub repo description, social card, blog post if any) uses "99.99%" as a current-state claim.
- [ ] The full eval result JSON is linked from the README and committed under `eval/eval-{date}.json`.
- [ ] PRD.md §3 success-metrics table updated to footnote the n=50 lower bound on the answer-correctness row.
- [ ] Manual review by one external reader (friend) confirms the README doesn't read as oversold.

**Priority**: P0 (launch-blocking Tiger) | **Effort**: S | **Dependencies**: Story 9 (eval results in hand) | **INVEST**: ✓

---

### Story T4: Disclaimer travels in the response payload

**As an** MSU community member who never reads READMEs before using a tool
**I want** the unofficial disclaimer to appear in every chain/get_policy response
**so that** I see it at the moment the answer would otherwise mislead me.

**Conversation**: PRE_MORTEM T4. The README disclaimer is invisible at point of use. The LLM is more likely to surface a structured response field than to recall a tool-description sentence.

**Acceptance Criteria**:
- [ ] Every `chain_find_relevant_policies` and `get_policy` response includes a top-level `disclaimer: string` field.
- [ ] `disclaimer` text reads (verbatim): *"Unofficial — this MCP is not affiliated with MSU. Verify against {landingUrl} before acting on any policy detail."* with `{landingUrl}` interpolated for the most relevant returned policy.
- [ ] Tool description tells the LLM to surface the disclaimer to the user when answering normative questions (deadlines, eligibility, monetary amounts).
- [ ] Eval's answer-correctness review includes a manual check: does the LLM surface the disclaimer when the question is high-stakes? Track pass-rate; if < 80%, tighten the tool description.
- [ ] Tested on Claude Sonnet, Claude Opus, and one non-Claude client (Cursor or Windsurf): the disclaimer appears in the answer at least 80% of the time on a 5-question high-stakes subset.

**Priority**: P0 (launch-blocking Tiger) | **Effort**: S | **Dependencies**: Story 1 | **INVEST**: ✓

---

### Story T5: Privacy disclosure for OPENAI_API_KEY semantic retrieval

**As a** privacy-conscious user (especially asking about Title IX, harassment, substance use, or other sensitive topics)
**I want** explicit disclosure that my queries are sent to OpenAI when semantic retrieval is enabled
**so that** I can make an informed choice about enabling it.

**Conversation**: PRE_MORTEM T5. Sensitive-topic queries leaking to OpenAI without user awareness is a real privacy harm. Keep the feature; disclose clearly; recommend BM25-only for sensitive use until the v0.2 ONNX bundle lands.

**Acceptance Criteria**:
- [ ] README has a top-level "Privacy" section disclosing: queries are sent to OpenAI for embedding when `OPENAI_API_KEY` is set; no other telemetry; semantic retrieval is opt-in via env var; BM25-only fallback works without any external API call.
- [ ] On startup, if `OPENAI_API_KEY` is set, the server logs to stderr (one line, JSON): `{"level":"warn","msg":"semantic retrieval enabled — query embeddings will be sent to OpenAI"}`.
- [ ] If `OPENAI_API_KEY` is unset, the server logs `{"level":"info","msg":"semantic retrieval disabled (no OPENAI_API_KEY); using BM25-only retrieval"}`.
- [ ] README explicitly recommends omitting the key for users asking about sensitive topics until the v0.2 ONNX-bundle ships.
- [ ] PRD.md §3 Non-Goals updated to reflect that the v0.2 ONNX bundle is now sensitive-topic-driven, not just bundle-size-driven.

**Priority**: P0 (launch-blocking Tiger) | **Effort**: S | **Dependencies**: retrieval module knows whether key is set | **INVEST**: ✓

---

## Story Map

```
Foundation (must be built first):
  ├─ Story 1: chain answer (L)            ← the keystone; nearly everything depends on this
  ├─ Story 8: health_check (M)            ← parallel-safe; surfaces failures
  └─ Story 9: eval harness (L)            ← parallel-safe once Story 1 has a stub

Built on top of foundation:
  ├─ Story 2: verifiability fields (S)
  ├─ Story 3: refusal correctness (M)
  ├─ Story T4: disclaimer in payload (S)
  └─ Story T2: external eval questions (M)

Distribution layer (parallel-safe with each other once foundation works):
  ├─ Story 4: Claude Code plugin install (M)
  ├─ Story 5: npx install (M)
  ├─ Story 6: claude.ai connector docs (S)
  └─ Story 7 + T1: Project starter zip with URL list (M+S)

Quality + comms (last):
  ├─ Story 10: CI (M)
  ├─ Story T3: honest README accuracy phrasing (S)
  └─ Story T5: privacy disclosure (S)
```

## Technical Notes (cross-cutting)

- **PolicyDocument shape** is defined once in `src/types.ts` and consumed by Stories 1, 2, 3, T4. Adding the `disclaimer` field for T4 forces a type update; coordinate to avoid two passes.
- **Tool description text** is the single highest-leverage prompt-engineering surface. Stories 1, 3, T4 all touch it. Recommend writing all three changes in one PR to avoid sequential drift.
- **Eval set ownership** spans Stories 9 and T2; T2's external-source requirement should land before Story 9 reports final numbers, otherwise the headline numbers carry curator bias and have to be re-run.
- **README** is touched by Stories 5, 6, 7, T3, T5 and the project's "Privacy" + "Accuracy" sections. One PR for all README changes is cleaner than five.
- **CI workflow** (Story 10) needs Stories 4, 5, 8, 9 to be at least stub-complete to test against. Plan it as the *last* story before release tag.

## Open Questions

- **claude.ai MCP-connector capabilities (Story 6).** Does the connector accept stdio-via-npx, or only remote HTTP MCPs? If HTTP-only, Story 6 becomes either "document the limitation" or "spike a hosted HTTP wrapper" — material scope difference.
- **Marketplace approval flow (Story 4).** Does `/plugin marketplace add mminsub11/msstate-mcp` work for arbitrary GitHub repos at end-user scale, or is there a registration step? Verify on a throwaway plugin before the v1.0 launch — see PRE_MORTEM F4.
- **Disclaimer surfacing rate (Story T4).** The 80% target is a guess. We may need to tune the tool description after observing real LLM behavior — flag for re-eval after first eval run.
- **Externally-sourced eval questions (Story T2).** Are the publicly-available MSU subreddits and FAQs sufficient to source 15+ representative questions, or do we need to rely entirely on a blind-author friend? Quick survey before committing to the M-effort estimate.

## Suggested next steps

- **Convert this into a sprint-1 task list** (next step the user asked for) — pulling the foundation-layer stories (1, 8, 9) plus T1, T2, T3, T4, T5 into a dependency-ordered first-week plan.
- **Generate test scenarios** for Story 1 (`/pm-execution:test-scenarios`) — high-stakes question paths, ambiguity cases, refusal cases.
- **Run cohort analysis on eval results** post-launch (`/pm-data-analytics:analyze-cohorts`) to see which question categories regress between releases.
