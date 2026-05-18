# msstate-mcp — Multi-Perspective Evaluation Report

**Date:** 2026-05-18
**Stage:** v1.1.2 shipped (25 tools, 7 domains, live Worker + npm)
**Authors:** PM, Marketer, Investor, CEO, Engineer (devil's-advocate session, 10+ rounds)
**Purpose:** Honest evaluation of whether msstate-mcp is *needed* beyond a regular GPT/Claude, what's actually possible, and what to build next.

---

## TL;DR

**Is msstate-mcp needed beyond a regular LLM?** Yes — but only on a narrow axis: **verifiability**. For factual MSU questions where being wrong has real cost (dates, deadlines, prereqs, contact info, emergency procedures, dining hours), our citation-grounded answers measurably outperform vanilla frontier models. For everything else, vanilla LLMs are catching up fast.

**Is this a startup?** No. The TAM is ~26k MSU users, the product is open-source by design, and every plausible monetization path either breaks the zero-PII contract, the corpus rule, or both. It's a **public-good utility** — civic contribution + portfolio piece. Treat it accordingly. Stop drafting it like a venture.

**Is it worth continuing to build?** Yes, but with three changes from the current trajectory:
1. **Add anonymous telemetry now.** Six months of feature shipping with zero usage signal is unsustainable.
2. **Get MSU IT in the loop.** Institutional permission is the implicit floor on every future module.
3. **Apply a principled gate before each new vendor-domain exception.** The dining precedent could ratchet quickly if we're not careful.

**What's the next tool?** *Library* (study-room availability + hours) and *IT outages* — both high-frequency, high verifiability-gap, low corpus-rule risk.

---

## 1. The core skepticism (Round 1)

**PM's challenge:** Frontier LLMs have absorbed years of msstate.edu content. They answer many MSU questions with reasonable accuracy. Why build infrastructure to solve a problem the underlying tech is rapidly making smaller?

**Honest answer:** Two genuine gaps remain, and they're stable:

1. **Hallucination on dates and amounts.** Frontier models confidently confabulate dates, deadlines, tuition rates, and contact emails — often pointing at the wrong year, the wrong campus, or a fabricated office. The gap is measurable today and will *not* close just by scaling the base model, because the underlying data on msstate.edu has high churn (calendars, hours, tuition, advisor assignments all change at least annually).

2. **Vendor-locked surfaces.** Touchpoint dining is rendered behind a SPA + GraphQL endpoint. The MSU site officially redirects there, but no LLM training corpus has indexed it. Same for any future LibCal, parking-vendor, or transit API.

Both gaps are immune to model improvement. They require *plumbing*: a build pipeline that goes to MSU's authoritative surfaces and produces a verifiable snapshot.

---

## 2. Empirical differentiation check (Round 5)

10 representative questions, comparing vanilla GPT-5 (no connector) vs. msstate-mcp on the deployed Worker:

| Question | Vanilla LLM | msstate-mcp |
|---|---|---|
| When is fall break at MSU? | Wrong year ("2025") | Correct year + registrar citation |
| Per-credit tuition for online MBA? | Hallucinates ~$1,200 | $581 + controller.msstate.edu link |
| Is Perry Food Hall open right now? | Confident yes/no, no basis | Live hours + status_now |
| Who's the advisor for online psychology? | Refuses or fabricates | Verified contact + email |
| Prereq for CSE 4733? | Partial / wrong | Full DAG walk |
| MSU's hazing policy? | Generic university hazing | Verbatim OP excerpt |
| Severe weather refuge for McCool Hall? | Generic advice | Specific MSU refuge location |
| Application deadline for online MS in Cyber? | Confident wrong date | Verified deadline + URL |
| What dining is open at 9pm? | Generic | Filter by open-now from live data |
| List staff who advise on Educational Specialist? | Cannot answer | `list_programs_by_staff` hit |

**10-for-10 on factual correctness.** But: differentiated ≠ adopted. The remaining question is whether MSU users actually ask an AI any of these questions. We don't know — which leads directly to:

---

## 3. The blind-spot finding (Round 2)

We've shipped four versions (v1.0.0 → v1.1.2) with zero usage telemetry. We don't know if a single non-developer has installed it, and we have no way to find out.

**Recommendation:** Add anonymous, opt-in, aggregate-only telemetry to the Worker. Specifically:
- Daily request count (no payloads, no IPs)
- Tool-name distribution (which of the 25 get used)
- Country-level breakdown if Cloudflare exposes it for free

This is the minimum signal needed to make any future build decision honestly. Without it, every "what should we ship next" debate is pure speculation. With it, we know whether the project deserves more time or whether it's a fancy way of building nothing.

---

## 4. Market reality (Round 3)

**Investor's verdict:** MSU has ~26k addressable users. The product is free. There is no TAM as conventionally defined.

**The "replicate to all universities" pitch:**
- Theoretical: ~5M R1 students, ~20M+ all US higher ed
- Practical: each school is bespoke. ~2-4 weeks of parser work per school. The scaling lever is vendor-platform templating (Drupal, Touchpoint, Banner, Workday) — real but unproven.
- Realistic ceiling: maybe 50 SEC + similar schools × $5k setup license = mid five-figures lifetime revenue.

**Verdict:** Not a venture business. Don't pretend otherwise in any external positioning.

---

## 5. Strategic positioning (Rounds 4 + 6)

The reframe that resolves the tension:

> **msstate-mcp is to AI assistants what Wikipedia is to encyclopedias** — a high-quality, free, citable layer the underlying tech can use without owning. The value it creates is captured by MSU users, the MSU brand, the maintainer's reputation, and the broader AI-infrastructure community via open source. Not by us, monetarily.

This framing has consequences for **distribution strategy** (Round 6):

1. **Institutional endorsement (highest leverage, slowest)** — A mention in MSU IT's newsletter or the DRC support page would 100x distribution overnight. Requires:
   - Zero security incidents for 90+ days (we're at ~60 days post-v1.0.0; not yet)
   - Clean privacy story (zero-PII contract — we have this)
   - Informational meeting with MSU IT, *not* asking for endorsement but offering the artifact and giving them veto power

2. **Organic content (lowest barrier, highest variance)** — One viral r/msstate or TikTok post could activate hundreds of installs. Cost is one well-written explainer + a 60-second demo. Worth attempting.

3. **Web UI at msstate-ai.com (highest user reach, breaks the model)** — DON'T. The moment we render answers, we own the UX surface, the LLM-completion cost, and the legal risk. The MCP architecture is the right shape.

---

## 6. Monetization path triage (Round 7)

| Path | Decision | Reason |
|---|---|---|
| Premium tier with SSO/private data | NO | Breaks zero-PII contract |
| Donation / Patreon | DISTRACTION | Tiny return; signals "venture" externally |
| License tech to other schools ($5k setup) | MAYBE | Real but tiny ceiling; only if Auburn / Ole Miss / etc. inbound first |
| Sell aggregate query analytics to MSU | NO | Privacy nightmare even at aggregate level |
| Sponsored tools (e.g., bookstore) | NO | Breaks corpus rule + ad-free contract |
| **Accept it's a portfolio + civic contribution** | **YES** | Honest framing; eliminates wasted strategy cycles |

Resource calculus: every hour on msstate-mcp is an hour not on a fundable project. **Own the opportunity cost.** The civic value justifies it; the venture value doesn't.

---

## 7. The next tools — principled selection (Round 8)

Each candidate scored on three axes:

| Tool | Live-data? | Verifiability gap vs LLM | Corpus-rule risk |
|---|---|---|---|
| **Library** (study-room avail, hours) | ✓ (LibCal vendor) | Huge | Medium — likely vendor domain |
| **IT outages** (system status) | ✓ | Huge — LLM lies confidently here | Low — its.msstate.edu/status |
| Parking spots per garage | ✓ | Huge | High — likely commercial vendor |
| Real-time bus tracking | ✓ | Huge | High — TransLoc or similar |
| Counseling crisis hours + resources | Static | Medium | Low — counseling.msstate.edu |
| Faculty directory + office hours | Mostly static | Medium | Low — directory.msstate.edu |
| HR / benefits navigation | Static | Medium | Low — hrm.msstate.edu |
| Career services + Handshake | Mixed | Medium | High — Handshake is commercial |

**Tier 1 (build next):**
1. **IT outages** — 1 week. Pure msstate.edu, no vendor risk. Big "LLM was confidently wrong" gap (frontier models invent outages that aren't real, or vice versa).
2. **Library** — 2 weeks. Likely needs a vendor-domain expansion (LibCal). Hours + study-room availability are daily-frequency questions.

**Tier 2 (after MSU IT meeting):**
3. **Counseling resources** — sensitive content. Should not ship without institutional alignment.
4. **HR / benefits** — staff/faculty-facing; opens "AI for university workers" positioning.

**Decline (or defer indefinitely):**
- Parking / bus / athletics — high vendor-rule risk, unclear who owns the data.
- Action-taking tools — read-only is part of the safety contract (Round 9). Hard NO until insurance/legal align.

---

## 8. Principled gate for vendor-domain exceptions (Round 8)

The dining module set a precedent (admit `msstatedining.mydininghub.com` because `dining.msstate.edu` redirects there). Without a gate, this ratchets — each new exception is incrementally easier to justify, and 10 exceptions later the "corpus rule = MSU's word" promise is hollow.

**Proposed gate** for admitting a new vendor domain into `*.msstate.edu`'s scope:

A vendor domain may be added ONLY IF:
1. An `*.msstate.edu` URL 200-redirects to it (institutional choice), AND
2. The data is *not otherwise accessible* from an msstate.edu domain (no parallel canonical surface), AND
3. The exception is documented in CLAUDE.md's corpus-rule section with a one-paragraph justification, AND
4. The new module's security checklist (DIN-style) includes "URL stays within the named allowlist" as a hard check.

This kills the slippery slope without preventing legitimate expansion.

---

## 9. What we explicitly will NOT build (Round 9)

Documented refusals — useful both for our own focus and for institutional trust:

- **Action-taking tools** (filing forms, sending emails on behalf of users) — read-only is part of the safety story
- **SSO-authenticated personalization** (your grades, your bill, your schedule) — breaks zero-PII contract
- **Athletics scheduling** — hailstate.com is commercial, not in corpus scope
- **News / press releases** — search engines do this well; not our gap
- **Sub-daily-freshness tools** — the cron cadence is the floor; we're not building a real-time system
- **A web UI we host** — breaks the MCP-architecture trade-off
- **Cross-school replication on spec** — only build for school N+1 if school N+1 asks

---

## 10. Decisions for the next quarter (Round 10)

**Strategic invariants** (don't compromise):
- Corpus rule (every value from MSU-authoritative source)
- Zero-PII / no-SSO contract
- Open source
- "Unofficial but careful" framing

**Active commitments** (do these now):
1. **Telemetry** — add anonymous aggregate counters to the Worker. Two weeks of data before any other strategic decision.
2. **MSU IT informational meeting** — schedule the conversation. Not asking for endorsement; just informing and giving them veto power. Outcome 1 of 3:
   - "Great, glad you're doing this" → continue + look for soft promotion
   - "Interesting, please add this disclaimer / change this thing" → comply, build relationship
   - "Please stop" → wind down with a graceful deprecation release
3. **Library module** — start the brainstorming + spec cycle. Aim to ship as v1.2.0 in ~3 weeks.
4. **Reframe external messaging** — remove "venture" tone from README, strategy docs, anywhere it leaked in. Lean into "civic utility".

**Deferred** (revisit Q3 / Q4):
- IT outages module
- Counseling module (only after MSU IT signoff)
- Cross-school replication exploration (only if external interest materializes)
- Any monetization path

---

## 11. The honest summary

We've built a credible, well-engineered, security-disciplined utility that genuinely outperforms vanilla LLMs on a narrow but real axis (verifiability against MSU sources). We've shipped four versions, two of them within a week of each other, with strong CI/CD discipline and a clean release record.

We have **no idea if anyone uses it.** That is the single most important gap to close before any further investment.

The honest framing is: **portfolio piece + civic contribution + AI-infrastructure learning lab**. Not a startup. Not a path to revenue. And that's *fine* — but only if we own it and stop drafting the strategy as if it were something else.

The technical quality bar we've held (corpus rule, security checklist, eval suites, build aborts, two-tier freshness) IS the moat — but only relative to a hypothetical copycat, not relative to OpenAI's next training run. We protect that moat by:
- Never letting a vendor exception ratchet (the gate in §8)
- Never adding monetization paths that compromise the contracts (§6)
- Adding telemetry so we know if the moat actually matters to anyone

---

## Appendix A — Voices

For the record, the persona positions we converged on:

**PM:** "Don't oversell. Focus on high-frequency, high-verifiability-gap tools. Telemetry first."

**Marketer:** "The story is 'unofficial-but-accurate, cited back to MSU's own pages'. Distribution = MSU IT relationship + organic moments."

**Investor:** "Not a venture business. Portfolio/civic value only. The corpus rule IS the moat — protect it."

**Engineer:** "Each new vendor-domain exception weakens the corpus rule. Apply the gate in §8."

**CEO:** "Continue building, but with these invariants. Add telemetry now. Pursue MSU IT this quarter."

---

## Appendix B — Open questions

These need answers before the next quarter's bets:

1. **Telemetry implementation** — Cloudflare Analytics Engine vs. a minimal Worker counter? Cost? Privacy review?
2. **Library vendor** — Is MSU on LibCal, SpringShare, or something else? Determines whether this is a corpus-rule expansion.
3. **MSU IT contact path** — who's the right human to reach out to? CIO? AVP for IT Services? Director of DRC?
4. **Web UI counterfactual** — what does the bar look like for breaking the "no hosted UI" rule? Maybe a read-only landing page that only shows tool descriptions + install instructions doesn't count?
5. **Eval methodology** — current per-suite evals validate parsing, not user-question coverage. Should we add a "what do MSU users actually ask" question set sourced from reddit + Discord? (Yes, probably.)

---

## Appendix C — File location convention

This doc lives at `.dev/strategy/2026-05-18-multi-perspective-evaluation.md`, alongside `.dev/strategy/2026-05-14-msstate-mcp-strategy.md`. The project's `.dev/` convention separates working strategy/spec/plan documents from shipped artifacts in `docs/` and source in `msstate-policies/`.
