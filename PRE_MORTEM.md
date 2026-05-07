# Pre-Mortem: MSU Policies MCP Server v1.0 launch

**Date**: 2026-05-07
**Status**: Draft
**Sources**: [`PRD.md`](./PRD.md), [`PLAN.md`](./PLAN.md) v6
**Scope**: Risks **not** already covered by PLAN.md §"Open Risks." Imagine it's 60 days post-launch and the project has failed. What happened?

---

## Risk Summary

- **Tigers**: 13 (5 launch-blocking, 4 fast-follow, 4 track)
- **Paper Tigers**: 6
- **Elephants**: 5

The pattern: PLAN.md's risk section is good on **technical/scraper failure modes** but undercovers **communications, distribution, and post-launch sustainability** — exactly where a portfolio piece tends to die quietly.

---

## Launch-Blocking Tigers

These must be addressed before the v1.0 release tag.

| # | Risk | Likelihood | Impact | Mitigation | Owner | Deadline |
|---|---|---|---|---|---|---|
| **T1** | **Claude Project starter zip = bulk redistribution of MSU PDFs.** The "free claude.ai user" path bundles ~30 policy PDFs into a GitHub release. That's *redistribution*, not retrieval. Even with the unofficial disclaimer, redistributing a curated compilation of an institution's documents — under their brand name in the project title — is a category step up from the live MCP. MSU's communications team could reasonably ask for takedown. | Medium | High (loss of distribution path; potential reputational issue) | Don't ship PDFs in the zip. Ship instead: (a) a `.txt` list of canonical policy URLs, (b) the system-prompt template, (c) a one-line script users run locally to download to their machine. The zip becomes pointers + prompt, not content. | mminsub11 | Before release tag |
| **T2** | **Eval set written by a single curator → curator bias.** I picked the 50 questions. There's a strong bias toward questions whose answers I already know fit the retrieval design. Eval passes 100%; real users ask "if I'm sick the day of an exam can my prof require a doctor's note" and the system fails because that question style isn't represented. The eval is a quality theater, not a quality gate. | High | High (false confidence in the headline numbers) | (a) Scrape 15–20 real questions from `r/msstate`, MSU student-services FAQs, and MSU Bullies subreddit threads. Replace the easiest 15–20 of my hand-written questions with these. (b) Have one non-author (a friend, family member) write 5 questions blind. (c) Document curator-bias risk in README's eval-results section. | mminsub11 | Phase 2 (validate) |
| **T3** | **README claims "99.99%" or "highly accurate" — but 50 questions can only confirm "0 errors at n=50."** PLAN.md §"Accuracy" already concedes this. The risk is that release marketing (README headline, GitHub social card, any blog post) uses the aspirational number. Day-1 readers see "99.99%," try the tool, hit one wrong answer, write the project off as overhyped. | Medium | Medium (credibility damage on a portfolio piece is hard to undo) | README's eval section says verbatim: *"0 errors observed on a 50-question hand-written eval. The 50-question set provides a ~94% lower bound on answer correctness; the 99.99% target is aspirational, not measured. See `eval/eval-{date}.json` for the full eval run."* No headline number above the eval table. | mminsub11 | Before release tag |
| **T4** | **"Unofficial" disclaimer is in the README — invisible at point of use.** A user installs via `/plugin install`, asks "what's the policy on amnesty," gets a confident answer with citation. They never saw the README. They treat it as authoritative. The disclaimer fails at the moment it actually matters. | High | Medium-High (the central trust mechanism for the project leaks) | Embed disclaimer + verify-against-source instruction directly in the `chain_find_relevant_policies` tool description (already partly there) AND in the response payload itself: every chain response includes a `disclaimer` field with text like *"Unofficial; verify at {landingUrl} before acting."* The LLM is more likely to surface field text than to recall a tool-description sentence. | mminsub11 | Before release tag |
| **T5** | **Privacy disclosure missing.** When the user sets `OPENAI_API_KEY`, every query they ask is sent to OpenAI for embedding. That's a third-party data flow most users won't anticipate from "MSU policies MCP." Worse if the user is asking about Title IX, harassment, sexual misconduct, or substance use — sensitive topics they may not realize are leaving their machine. | Medium | High (real privacy harm + reputational risk if surfaced after the fact) | (a) README has a dedicated **Privacy** section disclosing: queries sent to OpenAI when key is set; no other telemetry; semantic retrieval is opt-in via env var; BM25-only fallback works without any external call. (b) On startup, if `OPENAI_API_KEY` is set, log to stderr: `"semantic retrieval enabled — query embeddings will be sent to OpenAI."` (c) v0.2 ONNX-bundle priority bumped specifically because of sensitive-topic queries. | mminsub11 | Before release tag |

## Fast-Follow Tigers

Address within first two weeks post-launch.

| # | Risk | Likelihood | Impact | Planned Response | Owner |
|---|---|---|---|---|---|
| **F1** | **Policy ambiguity — multiple policies cover the same domain.** Example: "amnesty" exists under Title IX (sexual misconduct) AND under substance-use code (Greek life / amnesty for medical emergencies). Top-k=2 may return both, but the LLM has no signal which applies to the user's situation. Risk of confidently citing the wrong one. | High | Medium | Tool description amendment: when chain returns ≥ 2 policies covering the same domain, the LLM must (a) name all of them, (b) ask the user a clarifying question, (c) only quote verbatim once the user has selected which scenario applies. Add 3 ambiguity test cases to eval. | mminsub11 |
| **F2** | **PDF metadata fields parse as `null` and the LLM cites `null` as fact.** Plan says missing metadata → `null` field. If the LLM sees `effectiveDate: null` and dutifully reports "the effective date is null," the answer looks broken. | Medium | Medium | Tool layer omits `null`-valued fields entirely from the response; tool description tells LLM that absent fields are unknown, not "null." Add 1 negative test for null-leakage to eval. | mminsub11 |
| **F3** | **MSU updates the Drupal site Friday at 5pm; v1.0 released Friday at 4pm; everything breaks Monday.** Mitigated partially by `health_check`, but the launch experience is "user installs, tries, gets cryptic error, never returns." | Medium | High | (a) Pre-release smoke test from a clean machine with cache cleared. (b) Documented runbook `docs/scraper-debug.md` for "if scraper breaks tomorrow." (c) Post-release nightly eval run; if it goes red, an issue auto-files via GitHub Action. | mminsub11 |
| **F4** | **Claude Code marketplace publishing process unverified.** Plan assumes `/plugin marketplace add mminsub11/msstate-mcp` works for end users. If marketplace requires Anthropic review, or rejects for any reason, the primary install path is broken at launch. | Medium | High | Verify the publishing path on a throwaway plugin *before* the v1.0 release. Document the actual steps in `docs/release.md`. If there's a review queue, factor it into the launch timeline. | mminsub11 |

## Track Tigers (monitor post-launch with trigger conditions)

- **TR1: Pre-computed embeddings drift from corpus.** `dist/embeddings.json` is built per-release; if MSU edits a policy mid-cycle, the embedding doesn't reflect the new text. BM25 stays current (always reflects the latest fetch); embedding ranks go stale. Trigger: investigate if eval retrieval correctness drops > 2 points between releases without a code change.
- **TR2: PDF edge cases — fillable forms, scanned-image policies, double-column layouts.** `scripts/audit-pdfs.mjs` catches the current corpus; new uploads can break silently. Trigger: any policy where extracted text < 100 chars on a > 2-page PDF should log a warning visible in `health_check`.
- **TR3: Non-English queries.** BM25 fails on Spanish/Mandarin queries; embeddings handle them but only with API key. Trigger: if a user reports a missed result for a non-English query, decide whether to add a small multilingual model or document the limitation.
- **TR4: Cross-client variance.** The chain tool description is tuned for Claude. Cursor (GPT-4) and Windsurf (mixed models) may honor "quote verbatim, refuse if uncertain" less reliably. Trigger: any user report of a cross-client divergence; if reproducible, expand eval to include the offending model.

## Paper Tigers (concerns that seem big but are manageable)

- **P1: User OpenAI costs.** Embedding a query is ~$0.00001. A user would have to ask 100,000 questions to hit a dollar. Documented in README; not a real concern. Becomes a real Tiger only if rate-limit / TOS issues emerge for users on free OpenAI tier — unlikely at this volume.
- **P2: Eval requires Claude API availability.** If Anthropic is down during release, can't run the LLM-judge. Manual review still works for the 50-question set; LLM-judge can run later. Not launch-blocking.
- **P3: Solo developer, no support team.** A portfolio project doesn't need 24/7 ops. Set GitHub issue templates for bug reports; respond as available; no SLA promised. Stops being a paper tiger if usage actually grows past a handful of users.
- **P4: "Free claude.ai" path delivers a degraded experience (only ~30 policies, not 218).** Yes — and the README labels it that way. As long as we don't market it as "the same MCP," there's no expectation gap. Becomes a real Tiger if marketing implies parity.
- **P5: Bundle size of `dist/index.js`.** ~2–3 MB unminified is fine. Becomes a real Tiger if v0.2 ONNX model balloons it past 30–40 MB without size justification.
- **P6: Branch hygiene (developing this on `claude/add-autoresearch-skill-BEzMA`).** Internal organization issue, invisible to users. Squash-merge to main at release time and the history is clean.

## Elephants in the Room

The risks that are most uncomfortable to write down — and therefore most important.

### E1: Bus factor of one. There is no maintenance plan.

This is a portfolio project by a single developer. MSU updates policies; the scraper continues working as long as selectors hold; embeddings go progressively stale; the developer moves on to the next project. Six months later the MCP is returning citations to superseded policies. Users who don't notice trust the wrong answer. Users who do notice file an issue that nobody triages. **The project doesn't fail dramatically — it decays.**

What to do with this honestly:
- **Decide upfront whether this is "ship and walk" or "maintain through 2026."** Document it in README. "Maintenance status: best-effort, no SLA, last refreshed YYYY-MM-DD" is honest. "Maintained" without a refresh-cadence commitment is misleading.
- Add a `STALENESS.md` with the rule: "if the last successful eval run is > 90 days old, README's badge turns yellow; > 180 days, red, with banner *'corpus may be stale; verify at policies.msstate.edu'*."
- Have a sunset plan: if no maintenance for > 1 year, archive the GitHub repo with a clear pinned issue redirecting users to the official source.

### E2: Eval-passing-but-unused ≠ portfolio win.

The v6 framing says low usage is OK because the project's job is to be well-built and well-evaluated. **But a portfolio piece nobody runs is invisible.** A recruiter, a grad-school adcom, a hiring manager — none of them will install an MCP server to evaluate your work. They'll skim the README and decide in 30 seconds whether the project demonstrates skill.

This means the *demonstration surface* matters separately from the build:
- **Recorded ~3-min demo** (Loom or asciinema) of "ask Claude an MSU policy question, see the grounded answer with citation" embedded in README at the top.
- **Eval results published as a Markdown table in README**, not buried in a `.json` file.
- **A short blog-post-style "what I learned"** writeup linked from README — shows engineering judgment, not just the artifact.

Failing to plan for the demonstration surface is the most likely way this project succeeds technically and fails as a portfolio piece.

### E3: The "reusable .edu template" claim is aspirational until someone reuses it.

PLAN.md and PRD.md both lean hard on "anyone can fork this and produce an MCP for their own university's policy site." **No one has actually done this.** The architecture *supports* it; that's not the same as having demonstrated it. If a reviewer asks "show me the second instantiation," the answer is "trust me, the abstraction is right" — which is the weakest possible answer.

Mitigations, ranked:
1. Actually fork it ourselves and produce a tiny proof-of-concept second source — even a 5-policy mock site would prove the framework holds. Best signal.
2. Or label it honestly: "designed for reuse, not yet validated for reuse." Costs nothing and avoids the credibility trap.
3. The course catalog v2.0 in the roadmap is the natural validation, but it doesn't help v1.0 launch.

### E4: Model progress risk — this MCP may be obsolete in 24 months.

Claude 4.7 today can't reliably answer MSU policy questions without grounding. Claude 5 / 6 might be trained on enough .edu-policy-style data, or have strong enough native retrieval, that domain-specific MCPs look like the cassette tape of LLM tooling — useful for a moment, archival quickly. **For a portfolio piece, this means the artifact's relevance has a half-life.**

What to do:
- Date the artifact prominently: README front-matter includes "Built against Claude 4.7 / 2026-Q2." So a 2028 reviewer sees it as a snapshot of state-of-the-art at a moment, not a forever claim.
- Lean into the *engineering decisions* (eval-driven, hybrid retrieval, safety contract in tool descriptions, source isolation) as the durable demonstration. Those skills don't expire even if the specific MCP becomes obsolete.

### E5: Has MSU been told this exists?

Project is "unofficial" but the developer hasn't reached out to MSU's web/IT/communications team. There are two reasons not to:
- "Permissionless innovation" — the policies are public; we shouldn't need to ask.
- Risk of getting told "no" before we've shipped.

There's one strong reason to:
- **Professional courtesy.** A short note to MSU IT or Communications saying "I built a thing that helps people find your policies; it's clearly labeled unofficial; here's the URL" sets a much better tone than them discovering it via a confused student or a Reddit thread. It also makes T1 (takedown risk) much less likely.

This is uncomfortable because the project owner is presumably an MSU student/affiliate themselves, and reaching out feels like asking permission for something that might not need it. But the cost is one email; the upside is goodwill (or at minimum, no surprise).

---

## Go / No-Go Checklist

Use before tagging the v1.0 release.

- [ ] **T1 mitigated:** Project zip ships URL list + script, not bundled PDFs.
- [ ] **T2 mitigated:** Eval set includes ≥ 15 questions sourced from real MSU community channels (Reddit, FAQs, etc.) or written by a non-author.
- [ ] **T3 mitigated:** README says "0 errors observed at n=50" with the lower-bound math; no "99.99%" headline.
- [ ] **T4 mitigated:** Disclaimer text included as a `disclaimer` field in every `chain_find_relevant_policies` and `get_policy` response.
- [ ] **T5 mitigated:** Privacy section in README; stderr disclosure on startup when `OPENAI_API_KEY` is set.
- [ ] **F1–F4 plans documented** in `docs/post-launch-fast-follows.md` with assigned owner.
- [ ] **TR1–TR4 monitoring** wired (nightly eval, health_check fields, low-text PDF warnings).
- [ ] **E1 maintenance status** documented in README; STALENESS.md + dated eval badge in place.
- [ ] **E2 demonstration surface**: README has a recorded demo + eval table at the top.
- [ ] **E3 reuse claim**: either honest hedge in README, OR a second-source proof-of-concept committed.
- [ ] **E4 dating**: README header dates the project against current Claude version.
- [ ] **E5 outreach**: courtesy note sent to MSU web/comms team with link.
- [ ] **Rollback plan**: documented in `docs/release.md` — how to unpublish the npm package, remove from marketplace, etc.

---

## Suggested next steps

- Update PRD.md with mitigations for T1–T5 incorporated into §3 (Non-Goals — drop the bundled PDFs from the zip path), §6 (Solution Overview — embed disclaimer in tool response), and §7 (Open Questions — add the curator-bias question).
- Add launch-blocking Tigers to the sprint-1 task list as P0 work items.
- Consider a `STALENESS.md` and `docs/scraper-debug.md` as new artifacts.
