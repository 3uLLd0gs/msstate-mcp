# Product Strategy: msstate-mcp

**Date:** 2026-05-14
**Stage:** Shipping (v1.1.0 live on npm + Cloudflare Worker; 24 tools, 7 domains)
**Author:** Minsub Lee (mminsub90)

---

## 1. Vision

Anyone in the MSU community — student, faculty, staff, prospect, parent — can ask an AI assistant a Mississippi State question and get the *exact* answer MSU publishes, with a citation back to msstate.edu, without ever wading through Drupal navigation, broken search, or scattered PDFs. No hallucinations, no out-of-date answers, no "general university knowledge" substitutions.

> **Tagline:** *The only MCP that knows MSU the way MSU does.*

---

## 2. Target Segments

| Segment | Size (MSU) | Pain Level | Current Alternative | Priority |
|---|---|---|---|---|
| **Undergraduate students** | ~17k | High — daily friction with dates, courses, fees | Search engines, asking Reddit, calling offices | **P0** |
| **Graduate students + applicants** | ~5k | High — admissions, prereqs, deadlines | Email graduate school, scattered web pages | **P0** |
| **Faculty + adjuncts** | ~1.4k | Medium — HR forms, research compliance, travel | Calling HR/Controller, Outlook archive | **P1** |
| **Staff (non-academic)** | ~2.5k | Medium — same as faculty minus research | Same as faculty | **P1** |
| **Prospective students + parents** | ~30k inquiries/yr | High — admissions process, cost, programs | admissions.msstate.edu, college-comparison sites | **P0** |
| **Alumni** | ~150k+ | Low — episodic (transcripts, events) | Manual lookup; alumni portal | **P2 (defer)** |
| **General public + athletics fans** | unbounded | Low | hailstate.com, general search | **P3 (out of scope)** |

**Primary segments:** students (undergrad + grad + prospective) and the AI-using faculty/staff subset.

**Explicitly NOT serving:**
- Athletics fans (hailstate.com is a commercial subdomain; not in corpus rule).
- People wanting personalized data ("show me MY grades / MY bill") — requires SSO, breaks zero-PII contract.
- People wanting to *do* things (register for a course, pay tuition) — read-only by design.

---

## 3. Pain Points & Value Created

**For students:**
- *Pain:* MSU publishes accurate info but it's spread across 50+ subdomains with inconsistent search. A simple "when is fall convocation?" requires 4–5 clicks through registrar.
- *Value:* One natural-language question, verbatim answer from MSU's own page with citation.

**For faculty/staff:**
- *Pain:* HR/benefits/travel policies live in PDFs and Drupal pages that are hard to navigate. Even staff often don't know what they can claim or how to file.
- *Value:* The AI assistant they already use (Claude, ChatGPT) can answer "what's the per-diem rate for in-state travel?" with the actual MSU policy verbatim.

**For prospects/parents:**
- *Pain:* "Does MSU have an online MBA?", "What's the deadline for fall?", "Do you operate in California?" — answers exist on online.msstate.edu but discovery is fragmented. Generic AI assistants hallucinate or cite the wrong school.
- *Value:* Grounded answers, citing the actual MSU page they would have read if they'd known where to look.

---

## 4. Value Propositions (JTBD)

**For an undergraduate student:**
> *When* I have a quick question about a date, course, fee, or policy, *I want to* ask my AI assistant a one-liner, *so I can* keep working on my paper instead of trawling msstate.edu.

**For a graduate prospect:**
> *When* I'm comparing online programs, *I want* program-specific advisor names, deadlines, and admission requirements, *so I can* decide whether to apply this cycle without 30 minutes of clicking.

**For a faculty member:**
> *When* I need to file travel reimbursement or check a research compliance rule, *I want* the actual MSU policy verbatim, *so I can* avoid getting it kicked back by Controller.

**For a staff member:**
> *When* a student or colleague asks me something outside my office's scope, *I want* a quick MSU-grounded answer to forward, *so I can* not have to look it up myself.

---

## 5. Strategic Trade-offs

| We Choose | Over | Because |
|---|---|---|
| **Baked snapshot, rebuilt weekly** | Live per-request fetching | Predictable latency, no MSU rate-limit problem, zero PII, atomic build-time validation (13+ abort sites per module) |
| **Read-only, no SSO** | Authenticated personalization | No auth surface = no attack surface; never PII-handling; trivial to audit |
| **MCP protocol + 3 surfaces** (npm, plugin, Worker) | Standalone web app | Meets the user where they already are (Claude, ChatGPT, Cursor); no UX to maintain |
| **Corpus rule** (everything from msstate.edu) | "Helpful, possibly wrong" general knowledge | The whole grounding story collapses if we let training-data leak in; this is the moat |
| **Domain modules + tight selectors** | Generic site scraper | Each MSU subdomain has different Drupal templates; tight parsers = high precision; loose = wrong-info nightmare |
| **Strict TypeScript + 436 unit tests + eval suites + 13+ build aborts** | Move fast, ship anything | Wrong answers are the worst-case failure mode (especially on emergency, tuition, dates) |
| **Open source** | Closed/SaaS | Trust + community contributions + makes MSU comfortable with the unofficial-but-careful framing |
| **Unofficial badge** | Pursuing official MSU partnership today | An official endorsement comes after trust is earned; pursuing it pre-trust risks slow legal review killing momentum |

---

## 6. Key Metrics

**North Star:** *Grounded-answer rate* — % of MSU-domain questions answered with at least one verbatim MSU-citation field populated, no training-data fallback. Target: ≥ 95%.

**Input metrics (levers we move):**
1. **Tool count** — each tool adds answerable question space (24 → 28 by end of year)
2. **Corpus freshness** — days since last successful build (target: ≤ 7)
3. **Eval pass rate** — per-suite (90% threshold)
4. **Catalog/calendar parse quality** — count of programs/courses with `parse_warnings` (downward trend per release)
5. **Distribution reach** — installs + Worker daily requests (proxies for actual usage; not yet measured)

**Health metrics (guardrails):**
- Security checklist score: **≥ 284** (Linux CI) — never regress
- `npm audit` high/critical: **0**
- Build aborts firing across modules ≥ 50 canonical-string sites
- 0 hallucinated answers in any eval suite (every answer must trace to a source URL)
- 0 outbound network calls at runtime (build-time scraping only; `SYN4 = 10 pts`)

---

## 7. Growth Engine

**Acquisition channels (today + roadmap):**

1. **MCP marketplace discovery** — Claude Code plugin marketplace, OpenAI connector store, Anthropic's MCP registry. *Currently:* listed implicitly via npm. *Next:* submit to official registries when they stabilize.
2. **Word-of-mouth in MSU subreddits / Discord** — students share AI tricks; a working MSU MCP is sticky.
3. **MSU IT/Help Desk endorsement** — if/when MSU's own ITS notices and recommends, distribution multiplies. Pre-requisite: trust track record (90+ days zero incidents).
4. **Faculty hand-offs** — a professor recommending it to grad students is high-value. Target: 2–3 faculty advocates in computer science / engineering by end of semester.
5. **Open-source GitHub** — README that lets a Python/JS developer at MSU clone and extend in a weekend.

**Activation:** the moment a user gets one correct, cited answer to a question that previously required clicking through msstate.edu, they're activated. Single tool call.

**Expansion:** add modules (Tier 1 below) so that *more* of the user's daily MSU questions land in the assistant. Each new module = 30–50 new questions answerable.

---

## 8. Core Capabilities

| Capability | Build / Buy / Partner | Investment | Timeline |
|---|---|---|---|
| **Per-domain Drupal scrapers + parsers** | Build | Core IP — already 6 modules done | Ongoing (2–4 weeks per new module) |
| **Build-time validation pipeline (canonical-abort strings)** | Build | Already in place | Maintain |
| **Eval framework + suite runner** | Build | Already in place; per-module suites | Add suite per new module |
| **MCP protocol implementation** | Use SDK (Anthropic) | Maintained upstream | Track upstream releases |
| **Cloudflare Worker deployment** | Build (own JSON-RPC dispatch mirror) | Maintain — duplicate of stdio dispatch | Refactor in v2 if duplication burden grows |
| **Corpus rebuild scheduling** | Buy / partner | Currently manual — automate via GitHub Actions cron | 2 weeks |
| **Distribution: npm + Cloudflare + plugin** | Use | All 3 already in place | Maintain |
| **Anthropic-powered synonym expansion** | Buy (build-time only) | $ trivial | Maintain |
| **Brand / trust signaling** | Build (README + SECURITY.md + open-source signals) | Ongoing | Compound over time |
| **Telemetry (anonymous)** | TBD — currently zero | Significant ($$ + trust trade-off) | Q4 decision |

---

## 9. Defensibility

The moat is **operational + relational**, not technological. Anyone *could* scrape msstate.edu; few have the discipline to do it right and the patience to keep it right.

| Moat type | Strength | Why |
|---|---|---|
| **Corpus discipline** | **Strong** | The corpus rule + canonical-abort string convention + per-module parse_warnings is hard to bootstrap. A copycat would ship hallucinations early and lose trust. |
| **Build-time validation depth** | **Strong** | 13+ abort sites per module catch silent regressions. Replicating this for 6 modules is 6–8 weeks of work. |
| **MSU-specific parser tuning** | **Medium-strong** | Each Drupal subdomain has its own quirks (the v1.0.1 advisingBlock + quickInner fallback chain is institutional knowledge). |
| **Open source + trust signal** | **Medium** | Being open-source IS the moat for a school-data MCP — closed-source competitors look untrustworthy. Hard to compete with by going closed. |
| **First-mover among MSU community** | **Medium** | Distribution lock-in: students share what works. The 2nd MSU MCP gets compared against this one. |
| **Network effects** | **Weak** | No user-generated value loop today. |
| **Switching costs** | **Weak** | Easy to switch — MCP is interchangeable. Must compete on accuracy/coverage. |
| **Data partnerships with MSU** | **Aspirational** | An official data feed from MSU IT would be the ultimate moat. Pre-requisite: 6–12 months of zero-incident track record. |

**Honest assessment:** the moat is *care*, not code. Sustaining it requires the maintainer to keep caring. Codifying that care into the build pipeline (which this repo does) is what makes it survivable.

---

## Strategic Risks

1. **MSU restructures Drupal templates** (e.g., new theme rollout) → multiple parsers break at once → 1–2 week scramble. *Mitigation:* per-module parse_warnings + build aborts catch this at build time, not at user-facing time.
2. **MSU sends a cease-and-desist** for unofficial use of their brand → forced rename or shutdown. *Mitigation:* careful "unofficial" disclaimer everywhere; corpus rule means we don't republish — we cite; offer to hand the project to MSU IT if asked.
3. **General-purpose LLMs improve enough at MSU-specific Q&A** (e.g., GPT-7 has good MSU coverage) → value of grounding drops. *Mitigation:* the corpus rule + recency + verbatim-citation contract is something a generic LLM can't credibly promise. Lean into that.
4. **Cloudflare Worker free tier maxes out** → cost spike. *Mitigation:* Cloudflare cost is essentially $0 at current volume; would need 50M+ requests/month to hit paid tier. Plenty of runway.
5. **Maintainer burnout** — single-maintainer projects die. *Mitigation:* build for hand-off-ability (the per-module structure makes it tractable for a contributor to own one domain).

---

## Roadmap: Candidate New Tools (Ranked by ROI)

Each entry is a self-contained MCP module like the existing 6.

### **Tier 1 — Build next (high frequency × accessible source × clear schema)**

| # | Module | Source | Why now | Est. effort | Tools |
|---|---|---|---|---|---|
| **1** | **Dining** | dining.msstate.edu | Daily query for ~6k on-campus students; "is Perry open?", "what's tonight's menu?" | 1 week | `get_msu_dining_hours`, `find_msu_dining_menu`, `list_msu_dining_locations` |
| **2** | **Library** | library.msstate.edu | Daily for grad students + ~8k+ regular users; hours + study room availability + research guides | 1 week | `get_msu_library_hours`, `find_msu_library_resource`, `list_msu_library_databases` |
| **3** | **Campus directory** | directory.msstate.edu (if accessible) OR people.msstate.edu | Constant need; "who's the chair of CSE?", "what's Dr. X's phone?" | 1 week | `find_msu_person`, `get_msu_office_contact` |
| **4** | **Counseling + wellness** | counseling.msstate.edu, longest.msstate.edu | High-stakes when needed; emergency-tool-style disclaimer pattern fits | 1 week | `find_msu_wellness_resource`, `get_msu_counseling_contact` |

### **Tier 2 — High value, moderate complexity**

| # | Module | Source | Why | Est. effort | Tools |
|---|---|---|---|---|---|
| **5** | **HR + benefits** | hrm.msstate.edu | Faculty/staff pain point; opens "AI helps staff" framing for institutional pitch | 2 weeks | `find_msu_hr_benefit`, `find_msu_hr_form`, `get_msu_hr_policy` |
| **6** | **Career services** | career.msstate.edu | Senior-year students + grad students; intersects with handshake but the policies are MSU's | 2 weeks | `find_msu_career_resource`, `list_msu_career_events` |
| **7** | **IT helpdesk knowledge base** | its.msstate.edu | "How do I reset my NetID?", "what's Canvas downtime?" — high frequency, low ambiguity | 2 weeks | `find_msu_it_solution`, `get_msu_it_status` |
| **8** | **Travel + expense policy** | controller.msstate.edu/travel | Faculty/staff specific; intersects with current tuition module's host | 1 week | `get_msu_travel_policy`, `find_msu_per_diem_rate` |

### **Tier 3 — Niche / sensitive (do after Tier 1)**

| # | Module | Source | Why | Notes |
|---|---|---|---|---|
| 9 | Housing (dorms, room rates) | housing.msstate.edu | Current module covers events only; full housing data is bigger | Prospect-heavy |
| 10 | Research compliance + IRB | research.msstate.edu (403 today) | Faculty-only; sensitive; gated source | Defer until access tested |
| 11 | Title IX + accessibility | accessibility.msstate.edu | High-stakes; emergency-style disclaimer required | Sensitive |
| 12 | Student org directory | myState OAS | Engagement use case, low criticality | Lower ROI |

### **Strategically declining**

| Module | Why not |
|---|---|
| Athletics scheduling | hailstate.com is commercial; not strictly msstate.edu corpus |
| Banner-authenticated tools | Requires SSO; breaks zero-PII contract |
| News / press releases | Search engines do this well already |
| Alumni events | Low frequency, low criticality |

---

## Next Steps

1. **Validate Tier 1 with users (1 week):** post in r/msstate or one MSU dev Discord — "what would you ask an MSU AI?" — score answers against the Tier 1 list.
2. **Build module 1 (Dining) as pilot (2 weeks):** dining is the smallest scope, fastest feedback loop, and a daily-touch use case. Use the same module pattern as `online/`.
3. **Define eval suite + 13+ build aborts before shipping each Tier 1 module** — never break the validation contract.
4. **Pursue MSU IT informational meeting (Q2):** not asking for endorsement, just informing. Sets foundation for eventual partnership.
5. **Define telemetry decision** (Q4): currently zero. Need basic usage signal to know what's working. Anonymous + opt-in only.

---

## Strategic Risks Summary (1-pager version)

- **Drupal restructure** — handled by build aborts, but a 1–2 week rebuild.
- **Brand/legal** — disclaimer-everywhere posture; corpus rule = cite not republish.
- **Generic LLM improvement** — verbatim-citation contract is the differentiator.
- **Maintainer continuity** — per-module structure is the hand-off vector.
