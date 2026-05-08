# Comparative retrieval-mode eval — 2026-05-08

Closes the Sprint 2 sub-DoD line "Hybrid retrieval... eval shows hybrid beats either method standalone, **OR config falls back to whichever wins**" (per [`ROADMAP.md`](../../ROADMAP.md) and Sprint 2 task 2.9 in [`PLAN.md`](../../PLAN.md)).

## Setup

Three eval runs, identical except for retrieval mode. All used the same 50-question eval set, k=5, Sonnet-4-6 judge, on commit `f5157e3` (env-var gate `MSSTATE_POLICIES_RETRIEVAL` controls the mode).

Mode selected via env var:
- `MSSTATE_POLICIES_RETRIEVAL=bm25` (or `OPENAI_API_KEY` unset) → BM25 only
- `MSSTATE_POLICIES_RETRIEVAL=embed` → cosine similarity over the prebuilt `dist/embeddings.json` only
- `MSSTATE_POLICIES_RETRIEVAL=hybrid` (current default) → RRF fusion of both

## Results

| Mode | Retrieval | Answer | Refusal | Composite | Eval cost |
|---|---:|---:|---:|---:|---:|
| **BM25 only** | 37/38 | 37/38 | 12/12 | **86/88** | $0.8177 |
| Hybrid (RRF) | 36/38 | 36/38 | 12/12 | **84/88** | $0.8185 |
| **Embed only** | 37/38 | 37/38 | 12/12 | **86/88** | $0.8276 |

Artifacts: `eval-2026-05-08-k5-sonnet-4-6-{bm25,hybrid,embed}.json`. Canonical `eval-2026-05-08-k5-sonnet-4-6.json` continues to point at the BM25 baseline.

## Per-mode failing questions

| Mode | Q | Expected | Returned (top-5) |
|---|---|---|---|
| BM25 | "Are there protocols if a tornado warning hits during my class?" | `01.04` | `12.09, 11.11, 03.07, 31.01, 03.06` |
| Hybrid | "Are there protocols if a tornado warning hits during my class?" | `01.04` | `12.09, 03.07, 91.100, 91.310, 03.04` |
| Hybrid | "What happens if I get cited for underage drinking at a tailgate?" | `91.119` | `03.04, 60.121, 60.324, 95.501, 91.123` |
| Embed | "Are there protocols if a tornado warning hits during my class?" | `01.04` | `03.07, 12.09, 03.06, 91.130, 91.122` |

The tornado case fails all three modes — corpus-boundary issue (OP 01.04 is a one-page meta-policy pointing at the external CEMP at `emergency.msstate.edu`; its text contains zero tornado-adjacent words). See [`REVIEW-2026-05-08.md`](./REVIEW-2026-05-08.md) "tornado fail correctly graded" for the full reasoning.

The unique hybrid failure is "underage drinking at a tailgate." The embedding signal pulled `03.04` (Sexual Misconduct) to top-1 — `tailgate` and `cited` apparently embed near consent / Title IX language — and `60.121` (HR personnel rule) and `60.324` to top-2/3, ejecting the canonical `91.119` (Sanctions for Alcohol and Drug Offenses) from top-5. BM25 alone catches it at rank 2; embed alone catches it at top-1. Fusing the two ranks via RRF averaged out the canonical hit's lead.

## Why hybrid is worse

RRF gives equal weight to each signal's rank position. With only 218 policies in the corpus and weak-keyword conceptual queries:
- A wrong-but-conceptually-close policy can be top-1 in *either* signal, contributing `1/(60+1)` to the fused score.
- The right policy might be top-1 in one signal but top-3 in the other, contributing `1/61 + 1/63`.
- Two weak signals pointing at adjacent-but-wrong policies can outvote one strong single-signal hit.

The codex F2 finding ("no confidence gate") is part of this: if we had a continuous fused-confidence signal, we could downweight the hybrid path when the single-signal hit is much more confident. We don't, so the fusion is a coin-flip when both signals are mediocre.

## Per-spec resolution

`PLAN.md` §"Search" / Sprint 2 task 2.9: *"if RRF underperforms either method on its own, fall back to whichever wins on the eval set. The eval gates the choice."*

The eval gates the choice. **BM25-only and embed-only tie at 86/88.** BM25 is operationally simpler (no `OPENAI_API_KEY` needed at runtime; works on a clean install) and fails on the same case as embed-only (the tornado corpus-boundary case). **Recommendation: default the retrieval mode to `bm25`.** Hybrid and embed-only stay available via env var for callers who specifically want them.

This is *not* baked in by this commit; the doc describes the eval finding and the recommendation. Flipping the default in `getRetrievalMode()` is a one-line change with broad UX impact (e.g. users who deliberately set `OPENAI_API_KEY` to "use embeddings" would silently fall back to BM25); the call belongs to the maintainer.

## What to do if/when you flip the default

1. Edit `msstate-policies/src/search.ts` `getRetrievalMode()`: change the fallback `return "hybrid"` to `return "bm25"`.
2. Update the `tests/retrieval-mode.test.ts` assertion ("default is hybrid when env var unset") to assert `bm25`.
3. Update README.md to document the env var and the choice.
4. `npm test`, `npm run typecheck`, `npm run build`, commit, push.

No re-eval needed — the BM25-only result is already validated.

## What this run does NOT tell you

- **Variance**: each mode ran once. Sonnet-judge scoring has small per-run variance. Retrieval pass count is deterministic given the corpus and query embeddings; the answer/refusal pass count can shift ±1 across runs from judge noise.
- **Bigger / different eval sets**: 50 questions over 218 policies is small. A 100-question set with more conceptual stress-test cases might reveal hybrid wins that this set doesn't surface. (Sprint 2 task 2.1 — externally-sourced ≥15 questions — would be a place to add those; see [`SOURCES.md`](./SOURCES.md).)
- **Production query mix**: real users' questions skew differently than author-written eval questions. The 86/88 number is the eval ceiling, not necessarily the field-deployment ceiling.
