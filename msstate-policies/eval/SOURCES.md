# Eval question sources

This file documents the provenance of every question in [`questions.jsonl`](./questions.jsonl), per the Sprint 2 DoD line in [`ROADMAP.md`](../../ROADMAP.md) and the corpus rule in [`CLAUDE.md`](../../CLAUDE.md).

The corpus rule (mirrored from `CLAUDE.md` and `PLAN.md`):

> Every fact this server returns — policy text, OP numbers, effective dates, responsible offices, citations, **eval-question expected answers**, anything — must trace back to an HTTP fetch of `policies.msstate.edu` made by *this* server. No Claude memory, no `WebSearch`, no Wayback Machine, no third-party mirror, no AI-generated summary.

## Authorship of the current 50 questions

**Authored against the live MSU policy index at <https://www.policies.msstate.edu/current> on 2026-05-07.** Every `expected_op_numbers` value was confirmed by searching the live `/current` index for the relevant title, *not* recalled from training data.

| Bucket | Count | What they look like |
|---|---:|---|
| Student-life — direct (title-keyword overlap) | 10 | "What is MSU's hazing policy?" → `91.208`. The query term ("hazing") is in the policy title. |
| Academic — direct | 10 | "What's the policy on final examinations?" → `12.04`. |
| HR / faculty / staff — direct | 10 | "What governs employee leave and leave without pay?" → `60.201`. |
| Conceptual — weak title overlap | 8 | "Can my RA write me up for lighting a candle in my dorm room?" → `91.100` (Code of Student Conduct — no candle/dorm/RA in the title). Tests hybrid retrieval: BM25 alone won't always surface these. |
| Negative cases — no MSU OP applies | 12 | "What's the weather forecast for Starkville next weekend?" → `null`. Tests the refusal-correctness sub-metric. At least 3 are deliberately "policy-shaped" (e.g. governor of Mississippi, post office hours) so the LLM is tempted to fabricate. |

50 total = 38 positive (`expected_op_numbers` non-empty) + 12 negative. Matches the split in [`PLAN.md`](../../PLAN.md) §"Eval set".

### Per-question provenance trail

Each row in `questions.jsonl` has a `notes` field that names the source policy by its landing path on `policies.msstate.edu`:

```json
{"q":"What is MSU's hazing policy?","expected_op_numbers":["91.208"],"notes":"From /policy/91208"}
```

Negative-case rows (`negative: true`, `expected_op_numbers: null`) have a `notes` field explaining why the question is out of scope (e.g. "Weather is not in MSU policy scope").

## What's NOT yet done — Tiger T2 (open)

The Sprint 2 DoD requires "≥ 15 externally sourced (Tiger T2)" questions. **Currently the count is 0.** All 50 questions were author-written by reading the live policy index and are *not* drawn from real user questions in the wild. The eval risks self-flattery: the author wrote the questions knowing the answers, so retrieval may look easier than it would on questions composed by someone with the actual JTBD.

[`PRE_MORTEM.md`](../../PRE_MORTEM.md) Tiger T2 names this risk. The fix is to source ≥ 15 questions from places where MSU community members ask things in their own voice:

| Source | What to look for | Attribution to record |
|---|---|---|
| `r/msstate` (Reddit) | Threads where someone asks a policy question in plain language and gets pointed to an OP | Thread URL + post date |
| MSU advising / financial aid / dean-of-students FAQ pages | Public Q&A that paraphrases an OP | URL + last-modified if visible |
| MSU Bullies (Facebook) — public posts | Threads asking "is X allowed", "what's the rule on Y" | Post URL or screenshot date |
| Blind-author cohort | A non-author friend asked to skim the OP index and write 5 questions, told only the topic, not the policy text | Initials + date asked |

Per the corpus rule:
- **The question text** can come from anywhere — community phrasing is the *whole point*.
- **The `expected_op_numbers`** must still be looked up against the live `/current` index, not guessed. If a sourced question doesn't have a clear OP answer, mark it `negative: true` instead of guessing.
- Don't summarize or paraphrase third-party text into the question; preserve the original phrasing where possible.

When this work happens, expand this file with a per-question source URL or short attribution string, and bump `questions.jsonl` accordingly.

## Why this file exists

The Sprint 2 DoD line is half-checked once `questions.jsonl` reaches 50; the other half is the externally-sourced bucket above. This file makes the gap visible so it can't quietly slip past v0.2.0-beta.
