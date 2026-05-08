# Codex Adversarial Review

Target: working tree diff
Verdict: needs-attention

> **Resolution status (2026-05-08):** all four findings below have been closed. Six `experiment:` commits on this branch (`75244b9` → `fd4bfde`) addressed F1-F4; commit `ba7e67e` recorded the validation eval at k=5 with Sonnet judge. Composite eval pass count went **81/87 → 86/88** (+5 answer-pass). The "no-ship" verdict is lifted; `ROADMAP.md` Sprint 2 accuracy gates (≥99% retrieval, 0 answer errors) are still not fully met. See [`plan-codex-fixes.md`](./plan-codex-fixes.md) "Status (2026-05-08)" for per-finding closure detail and the open empirical-F2-calibration follow-up.

No-ship: the latest Sonnet eval still misses retrieval and answer correctness, and the implementation has fail-open retrieval/caching paths that can confidently return wrong or empty policy evidence. I could not save codex_review.md because the workspace is read-only.

Findings:
- [high] Conceptual questions degrade to title-only retrieval unless runtime embeddings work (msstate-policies/src/tools/chain_find_relevant.ts:29-32)
  `chain_find_relevant_policies` rebuilds the index from only index rows, then immediately searches it. At that point `bodyTokens` are empty and semantic search returns nothing when `OPENAI_API_KEY` is unset or the embedding call fails, so production falls back to title/number BM25 rather than policy-body retrieval. The latest Sonnet eval still misses the tornado conceptual case at k=5, returning OPs 12.09/11.11/03.07/31.01/03.06 instead of expected OP 01.04. This is a direct accuracy risk for weak-keyword policy questions.
  Recommendation: Make lexical retrieval index full policy text deterministically, not only titles. Load a prebuilt body index from the shipped corpus or warm/fetch bodies before search; treat missing query embeddings as degraded health and validate conceptual evals in BM25-only mode.
- [high] Retrieval has no confidence or scope gate before returning arbitrary policies (msstate-policies/src/tools/chain_find_relevant.ts:32-53)
  The chain tool returns full text for whatever `hybridSearch` ranks, with no minimum score, no margin check, and no out-of-scope response. For negative or low-confidence questions, the server still supplies plausible-looking policy text and relies on the downstream model to refuse. That is brittle: the stated goal is reducing code error and improving accuracy, but the tool itself has no way to say 'no relevant policy found' unless `fused.length === 0`, which is rare for natural-language queries with common tokens.
  Recommendation: Add calibrated no-answer logic using score thresholds, rank margins, and/or required lexical/semantic evidence. Return an explicit empty result with a refusal note when confidence is low, and include this in negative-case eval scoring at the MCP layer rather than only via LLM judge.
- [medium] Transient PDF/fallback failures can be cached as empty policy text (msstate-policies/src/scraper.ts:308-316)
  If PDF fetch/parse fails, the code falls back to the landing page; if that fallback also fails, it logs the error and returns an empty string. `fetchPolicy` then caches that `PolicyDocument` for the policy, so a transient fetch or parser failure can poison memory/disk cache with empty or non-authoritative evidence for up to the cache TTL. That failure mode is hard to detect from the answer path and directly undermines policy accuracy.
  Recommendation: Fail closed when both PDF and fallback extraction fail, and do not cache documents with empty or suspiciously short text. Return `isError` with health details so the model refuses instead of answering from missing evidence.
- [medium] Answer failures persist even when the expected policy is retrieved (msstate-policies/src/tools/chain_find_relevant.ts:53-72)
  The latest Sonnet eval reports only 32/37 answer passes, despite 37/38 retrieval passes. The chain tool hands the model entire top-k policy bodies without targeted matched passages or section boundaries, which increases distractor load and makes correct citation/quotation harder. The failed Sonnet cases include study abroad, FERPA/student records, graduate grievance, and faculty grievance where the expected OP was retrieved but the judged answer still failed.
  Recommendation: Return ranked evidence chunks around matched passages before or instead of whole documents, include section/page anchors where possible, and reduce distractors by surfacing the primary policy separately from secondary candidates. Gate release on answer-pass improvement, not just retrieval-pass improvement.

Next steps:
- Run evals in BM25-only mode with `OPENAI_API_KEY` unset; this is the likely default user install path.
- Add MCP-layer negative/no-answer scoring so refusal does not depend solely on the LLM.
- Re-run the Sonnet eval after retrieval changes and require zero conceptual retrieval misses before shipping.
