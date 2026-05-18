# Program Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new tools — `match_online_program` (profile → ranked program shortlist) and `estimate_program_cost` (slug + credits → total-cost rollup) — so prospective students can self-qualify against MSU Online offerings.

**Architecture:** Pure-derived tools over the existing `OnlineCorpus`. No new corpus sources, no new scraping, no network calls at request time. Scoring is deterministic (no LLM): keyword overlap on career goal + level filter + budget/time hard constraints + state-authorization cross-reference. Cost estimator multiplies the program's already-baked per-credit rate by a user-supplied credit count plus baked fees. Both tools mirror to the Cloudflare Worker switch dispatcher. ONL5/ONL6 security checks updated; CLAUDE.md and README.md document the addition.

**Tech Stack:** TypeScript 5.5, zod 3.23, `zodToJsonSchema`, esbuild bundle, node:test runner via tsx. No new dependencies.

---

## Read Before Starting

1. `CLAUDE.md` § "Reading order" + § "CORPUS RULE" — no training data, no synthetic facts.
2. `msstate-policies/src/online/types.ts` — current `OnlineProgram` shape.
3. `msstate-policies/src/online/search.ts` — `tokenize`, `PROGRAM_STOP_WORDS`, `filterPrograms`, `resolveProgram`. Reuse these.
4. `msstate-policies/src/tools/list_online_programs.ts` + `get_online_program.ts` — tool-file pattern (zod Input, `name`/`description`/`inputSchema`/`zodSchema`/`handler`).
5. `worker/src/index.ts` — search for `case "list_online_programs":` to see the worker dispatch shape that the new tools must mirror.
6. `msstate-policies/eval/online.jsonl` — JSONL eval format used by `scripts/run-eval.mjs`.
7. `tools/security-checklist.sh` — block starting at `# Online module checks (ONL1-ONL5...)`.

## File Structure

**New files:**
- `msstate-policies/src/online/matcher.ts` — pure functions: `scoreMatch(profile, program) → MatchScore`, `rankPrograms(programs, profile) → MatchedProgram[]`, `estimateCost(program, credits, includeApplicationFee) → CostEstimate`. No I/O, no MCP types.
- `msstate-policies/src/tools/match_online_program.ts` — MCP tool wrapper around `rankPrograms`.
- `msstate-policies/src/tools/estimate_program_cost.ts` — MCP tool wrapper around `estimateCost`.
- `msstate-policies/tests/online/matcher.test.ts` — unit tests for `scoreMatch`, `rankPrograms`, `estimateCost`.
- `msstate-policies/tests/online/tool-match-online-program.test.ts` — integration tests for the MCP tool.
- `msstate-policies/tests/online/tool-estimate-program-cost.test.ts` — integration tests for the MCP tool.

**Modified files:**
- `msstate-policies/src/online/types.ts` — add `MatcherProfile`, `MatchedProgram`, `CostEstimate` exported types.
- `msstate-policies/src/index.ts` — import + register both tools in `TOOLS`; extend rule 6 in `SERVER_INSTRUCTIONS`.
- `worker/src/index.ts` — add tool descriptors + dispatch cases (mirrors the inline pattern used by the existing online tools).
- `msstate-policies/eval/online.jsonl` — append matcher/estimator cases.
- `tools/security-checklist.sh` — update ONL5 to count 7 tool files (was 5); add ONL6 (10 pts) gating allowlist + disclaimer presence in the two new tools.
- `CLAUDE.md` — append "Corpus extension (2026-05-18) — program matcher (v1.2.2)" addendum block.
- `README.md` — bump tool list to 27.
- `docs/BUILD.md` — append a one-paragraph note under the most recent extension block.
- `msstate-policies/package.json` — bump `version` to `1.2.2`.

## Scope check

Two tools, one feature: program matching for prospective students. Both touch only the existing online module and share `MatcherProfile`/`CostEstimate` types — they live together. The citation-card and semester-planner features are separate plans (`2026-05-18-citation-card.md`, `2026-05-18-semester-planner.md`).

---

## Task 1: Add matcher + estimator types

**Files:**
- Modify: `msstate-policies/src/online/types.ts:32` (after `MAX_QUERY_CHARS` const)

- [ ] **Step 1: Append new exported types**

```typescript
// Appended after MAX_QUERY_CHARS, before the existing `DegreeLevel` type alias.

/**
 * Caller-supplied profile for match_online_program. Every field is optional;
 * the matcher degrades gracefully when fields are absent (no field = no
 * constraint on that axis). NEVER infer fields from training data — only
 * use what the user provided.
 */
export interface MatcherProfile {
  career_goal?: string;          // free-text, tokenized + matched against program name + short_description
  level_preference?: DegreeLevel; // hard filter when present
  budget_usd?: number;            // hard cap on estimated total-cost when credits + per_credit are known
  time_budget_months?: number;    // soft signal (no per-program duration in corpus; lowers score for doctoral when small)
  state?: string;                 // 2-letter postal code; cross-referenced with state-authorization info page
  estimated_credits?: number;     // optional override; defaults to 30 (master/cert), 120 (bachelor) when null
  include_application_fee?: boolean; // default false; flipping to true adds the per-program application fee to the estimate
}

export interface CostEstimate {
  slug: string;
  name: string;
  credits_used: number;
  credits_source: "user_supplied" | "default_master_30" | "default_bachelor_120" | "default_doctoral_60";
  per_credit_usd: number | null;
  instructional_fee_per_credit_usd: number | null;
  application_fee_usd: number | null;
  application_fee_included: boolean;
  tuition_total_usd: number | null;
  instructional_fee_total_usd: number | null;
  total_usd: number | null;
  notes: string[];                // e.g., "per_credit_usd missing — total cannot be computed"
  source_url: string;
  raw_prose: string;
}

export interface MatchedProgram {
  slug: string;
  name: string;
  degree_level: DegreeLevel;
  fit_score: number;              // 0–100, deterministic from scoreMatch
  fit_reasons: string[];          // e.g., ["matches career_goal: 'data'", "within budget: ~$22,500 < $25,000"]
  application_deadline_next: { term: string; date_text: string } | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  estimated_total_usd: number | null;
  estimated_total_credits: number | null;
  state_authorization_flag: "ok" | "unknown" | "check_state_authorization_page";
  url: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd msstate-policies && npm run typecheck`
Expected: PASS (no new files reference these yet).

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/online/types.ts
git commit -m "feat(online): add MatcherProfile, CostEstimate, MatchedProgram types"
```

---

## Task 2: TDD `estimateCost` pure function

**Files:**
- Create: `msstate-policies/src/online/matcher.ts`
- Create: `msstate-policies/tests/online/matcher.test.ts`

- [ ] **Step 1: Write the failing tests for estimateCost**

Create `msstate-policies/tests/online/matcher.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "../../src/online/matcher.js";
import type { OnlineProgram, DegreeLevel } from "../../src/online/types.js";

function prog(over: Partial<OnlineProgram> = {}): OnlineProgram {
  return {
    slug: "mba",
    name: "Master of Business Administration",
    degree_level: "master" as DegreeLevel,
    format: "Fully online",
    short_description: "Accelerated MBA",
    url: "https://www.online.msstate.edu/program/mba",
    tuition: {
      per_credit_usd: 750,
      instructional_fee_per_credit_usd: 50,
      application_fee_domestic_usd: 60,
      application_fee_international_usd: 80,
      raw_prose: "$750/credit + $50 instructional fee",
    },
    contacts: [], application_deadlines: [], admission_requirements: "",
    entrance_exams: null, accreditation: null, forms: [], raw_sections: {},
    parse_warnings: [], retrieved_at: "2026-05-18T00:00:00.000Z",
    ...over,
  };
}

describe("estimateCost", () => {
  test("computes tuition + instructional fee, excludes application fee by default", () => {
    const r = estimateCost(prog(), 30, false);
    assert.equal(r.credits_used, 30);
    assert.equal(r.credits_source, "user_supplied");
    assert.equal(r.tuition_total_usd, 22500);          // 750 * 30
    assert.equal(r.instructional_fee_total_usd, 1500); // 50 * 30
    assert.equal(r.application_fee_included, false);
    assert.equal(r.total_usd, 24000);
    assert.equal(r.application_fee_usd, 60);
  });
  test("includes application fee when flag set", () => {
    const r = estimateCost(prog(), 30, true);
    assert.equal(r.application_fee_included, true);
    assert.equal(r.total_usd, 24060);
  });
  test("defaults to 30 credits for master when credits null", () => {
    const r = estimateCost(prog({ degree_level: "master" }), null, false);
    assert.equal(r.credits_used, 30);
    assert.equal(r.credits_source, "default_master_30");
  });
  test("defaults to 120 credits for bachelor when credits null", () => {
    const r = estimateCost(prog({ degree_level: "bachelor" }), null, false);
    assert.equal(r.credits_used, 120);
    assert.equal(r.credits_source, "default_bachelor_120");
  });
  test("returns null total + note when per_credit_usd missing", () => {
    const p = prog({ tuition: { ...prog().tuition, per_credit_usd: null } });
    const r = estimateCost(p, 30, false);
    assert.equal(r.tuition_total_usd, null);
    assert.equal(r.total_usd, null);
    assert.ok(r.notes.some((n) => /per_credit_usd missing/.test(n)));
  });
  test("returns null instructional fee component when missing but still computes tuition", () => {
    const p = prog({ tuition: { ...prog().tuition, instructional_fee_per_credit_usd: null } });
    const r = estimateCost(p, 30, false);
    assert.equal(r.tuition_total_usd, 22500);
    assert.equal(r.instructional_fee_total_usd, null);
    assert.equal(r.total_usd, 22500);
  });
  test("rejects negative credits", () => {
    assert.throws(() => estimateCost(prog(), -1, false), /credits must be >= 0/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd msstate-policies && npx tsx --test tests/online/matcher.test.ts`
Expected: All FAIL with `Cannot find module '../../src/online/matcher.js'`.

- [ ] **Step 3: Implement minimal `estimateCost`**

Create `msstate-policies/src/online/matcher.ts`:

```typescript
/**
 * Pure scoring + cost-estimation helpers over the OnlineCorpus.
 * No I/O, no MCP types. Imported by both the stdio tool wrappers and the
 * Worker mirror.
 *
 * Corpus rule (CLAUDE.md): never substitute training data for a missing
 * field. When a required input is null, emit a note and return null totals.
 */
import type {
  OnlineProgram,
  CostEstimate,
  MatcherProfile,
  MatchedProgram,
  DegreeLevel,
} from "./types.js";

function defaultCreditsFor(level: DegreeLevel): { credits: number; source: CostEstimate["credits_source"] } {
  switch (level) {
    case "bachelor":   return { credits: 120, source: "default_bachelor_120" };
    case "doctoral":   return { credits: 60,  source: "default_doctoral_60" };
    default:           return { credits: 30,  source: "default_master_30" };
  }
}

export function estimateCost(
  program: OnlineProgram,
  credits: number | null,
  includeApplicationFee: boolean,
): CostEstimate {
  if (credits !== null && credits < 0) {
    throw new Error("credits must be >= 0");
  }
  const notes: string[] = [];
  const used = credits === null
    ? defaultCreditsFor(program.degree_level)
    : { credits, source: "user_supplied" as const };

  const perCredit = program.tuition.per_credit_usd;
  const instructional = program.tuition.instructional_fee_per_credit_usd;
  const applicationFee = program.tuition.application_fee_domestic_usd;

  const tuitionTotal = perCredit !== null ? perCredit * used.credits : null;
  const instructionalTotal = instructional !== null ? instructional * used.credits : null;

  if (perCredit === null) notes.push("per_credit_usd missing on this program's page — total cannot be computed");
  if (instructional === null) notes.push("instructional_fee_per_credit_usd missing — component omitted from total");
  if (credits === null) notes.push(`credits not supplied; defaulted to ${used.credits} for ${program.degree_level} programs`);

  let total: number | null = null;
  if (tuitionTotal !== null) {
    total = tuitionTotal + (instructionalTotal ?? 0);
    if (includeApplicationFee && applicationFee !== null) total += applicationFee;
  }

  return {
    slug: program.slug,
    name: program.name,
    credits_used: used.credits,
    credits_source: used.source,
    per_credit_usd: perCredit,
    instructional_fee_per_credit_usd: instructional,
    application_fee_usd: applicationFee,
    application_fee_included: includeApplicationFee && applicationFee !== null,
    tuition_total_usd: tuitionTotal,
    instructional_fee_total_usd: instructionalTotal,
    total_usd: total,
    notes,
    source_url: program.url,
    raw_prose: program.tuition.raw_prose,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/online/matcher.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/online/matcher.ts msstate-policies/tests/online/matcher.test.ts
git commit -m "feat(online): add estimateCost pure helper with TDD"
```

---

## Task 3: TDD `rankPrograms` pure function

**Files:**
- Modify: `msstate-policies/src/online/matcher.ts` (append)
- Modify: `msstate-policies/tests/online/matcher.test.ts` (append)

- [ ] **Step 1: Append failing tests for rankPrograms**

Append to `msstate-policies/tests/online/matcher.test.ts`:

```typescript
import { rankPrograms } from "../../src/online/matcher.js";

describe("rankPrograms", () => {
  const PROGRAMS = [
    prog({ slug: "mba", name: "Master of Business Administration", degree_level: "master",
      short_description: "Accelerated MBA for working professionals" }),
    prog({ slug: "ms-cyber-security", name: "M.S. in Cyber Security", degree_level: "master",
      short_description: "Cybersecurity master's, fully online" }),
    prog({ slug: "bsee", name: "Bachelor in Electrical Engineering", degree_level: "bachelor",
      short_description: "BSEE delivered online" }),
  ];

  test("ranks by career_goal keyword overlap", () => {
    const r = rankPrograms(PROGRAMS, { career_goal: "cyber security" }, null);
    assert.equal(r[0].slug, "ms-cyber-security");
    assert.ok(r[0].fit_reasons.some((x) => /career_goal/.test(x)));
  });
  test("hard-filters by level_preference", () => {
    const r = rankPrograms(PROGRAMS, { level_preference: "bachelor" }, null);
    assert.equal(r.length, 1);
    assert.equal(r[0].slug, "bsee");
  });
  test("budget cap drops over-budget programs from top results", () => {
    // 30 credits * $750/cr = $22,500 tuition + $1,500 inst fee = $24,000
    const r = rankPrograms(PROGRAMS, { career_goal: "business", budget_usd: 10_000 }, null);
    const mba = r.find((x) => x.slug === "mba");
    assert.ok(mba === undefined || mba.fit_score < 50, "MBA must be filtered or low-scored when over budget");
  });
  test("state_authorization_flag defaults to unknown when no auth list provided", () => {
    const r = rankPrograms(PROGRAMS, { state: "CA" }, null);
    assert.ok(r.every((x) => x.state_authorization_flag === "unknown"));
  });
  test("state_authorization_flag is ok when state present in restricted-list shape", () => {
    // The state-authorization page mentions states in body; the matcher
    // accepts an explicit allowlist or a "no restrictions known" sentinel.
    const r = rankPrograms(PROGRAMS, { state: "MS" }, { authorized_states: ["MS", "AL", "TN"] });
    assert.ok(r.every((x) => x.state_authorization_flag === "ok"));
  });
  test("state_authorization_flag is check_state_authorization_page when state not in allowlist", () => {
    const r = rankPrograms(PROGRAMS, { state: "CA" }, { authorized_states: ["MS", "AL"] });
    assert.ok(r.every((x) => x.state_authorization_flag === "check_state_authorization_page"));
  });
  test("returns up to 5 results sorted by fit_score desc", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      prog({ slug: `p${i}`, name: `Program ${i} data analytics`, short_description: "data" }));
    const r = rankPrograms(many, { career_goal: "data analytics" }, null);
    assert.ok(r.length <= 5);
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].fit_score >= r[i].fit_score);
  });
  test("estimated_total_usd populated when per_credit present", () => {
    const r = rankPrograms(PROGRAMS, { career_goal: "business" }, null);
    const mba = r.find((x) => x.slug === "mba");
    assert.ok(mba && mba.estimated_total_usd !== null);
  });
  test("application_deadline_next picks first non-empty deadline", () => {
    const p = prog({ application_deadlines: [{ term: "Fall", date_text: "August 1" }] });
    const r = rankPrograms([p], { career_goal: "mba" }, null);
    assert.deepEqual(r[0].application_deadline_next, { term: "Fall", date_text: "August 1" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd msstate-policies && npx tsx --test tests/online/matcher.test.ts`
Expected: 9 rankPrograms tests FAIL with `rankPrograms is not exported`.

- [ ] **Step 3: Implement rankPrograms**

Append to `msstate-policies/src/online/matcher.ts`:

```typescript
const TOKEN_SPLIT = /[\s\-_/.,;:()\[\]{}!?"'`<>|@#$%^&*=+]+/;

function tokenize(s: string): string[] {
  return s.normalize("NFKC").toLowerCase().split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export interface StateAuthorization {
  authorized_states: string[]; // 2-letter postal codes from the state-authorization info page
}

const MAX_MATCHES = 5;

export function rankPrograms(
  programs: OnlineProgram[],
  profile: MatcherProfile,
  stateAuth: StateAuthorization | null,
): MatchedProgram[] {
  // Hard filter: level
  let candidates = profile.level_preference
    ? programs.filter((p) => p.degree_level === profile.level_preference)
    : programs;

  const goalTokens = profile.career_goal ? new Set(tokenize(profile.career_goal)) : null;
  const includeAppFee = profile.include_application_fee ?? false;

  const scored = candidates.map((p) => {
    const reasons: string[] = [];
    let score = 0;

    if (goalTokens && goalTokens.size > 0) {
      const haystack = new Set([...tokenize(p.name), ...tokenize(p.short_description)]);
      let hits = 0;
      for (const t of goalTokens) if (haystack.has(t)) hits++;
      const goalScore = Math.min(60, (hits / goalTokens.size) * 60);
      score += goalScore;
      if (hits > 0) reasons.push(`matches career_goal tokens (${hits}/${goalTokens.size})`);
    } else {
      score += 30; // neutral score when no career_goal supplied
    }

    // Cost score (0-30): under budget = +30, otherwise scaled
    const cost = estimateCost(p, profile.estimated_credits ?? null, includeAppFee);
    if (profile.budget_usd !== undefined && cost.total_usd !== null) {
      if (cost.total_usd <= profile.budget_usd) {
        score += 30;
        reasons.push(`within budget: $${cost.total_usd.toLocaleString()} <= $${profile.budget_usd.toLocaleString()}`);
      } else {
        const overshoot = (cost.total_usd - profile.budget_usd) / profile.budget_usd;
        score += Math.max(0, 30 - overshoot * 60);
        reasons.push(`over budget: $${cost.total_usd.toLocaleString()} > $${profile.budget_usd.toLocaleString()}`);
      }
    } else {
      score += 15; // neutral when no budget supplied or cost not computable
    }

    // Time score (0-10): doctoral penalised when time_budget_months small
    if (profile.time_budget_months !== undefined) {
      if (p.degree_level === "doctoral" && profile.time_budget_months < 36) score -= 10;
      else if (p.degree_level === "bachelor" && profile.time_budget_months < 24) score -= 5;
      else { score += 10; reasons.push(`level fits time budget (${profile.time_budget_months}mo)`); }
    } else {
      score += 5;
    }

    let stateFlag: MatchedProgram["state_authorization_flag"] = "unknown";
    if (profile.state) {
      if (!stateAuth) {
        stateFlag = "unknown";
      } else if (stateAuth.authorized_states.includes(profile.state.toUpperCase())) {
        stateFlag = "ok";
        reasons.push(`state ${profile.state.toUpperCase()} in authorized list`);
      } else {
        stateFlag = "check_state_authorization_page";
        reasons.push(`state ${profile.state.toUpperCase()} not in authorized list — confirm via state-authorization page`);
      }
    }

    const primary = p.contacts[0] ?? null;
    const nextDeadline = p.application_deadlines[0] ?? null;

    const matched: MatchedProgram = {
      slug: p.slug,
      name: p.name,
      degree_level: p.degree_level,
      fit_score: Math.max(0, Math.min(100, Math.round(score))),
      fit_reasons: reasons,
      application_deadline_next: nextDeadline,
      primary_contact_name: primary?.name ?? null,
      primary_contact_email: primary?.email ?? null,
      estimated_total_usd: cost.total_usd,
      estimated_total_credits: cost.credits_used,
      state_authorization_flag: stateFlag,
      url: p.url,
    };
    return matched;
  });

  scored.sort((a, b) => b.fit_score - a.fit_score);
  return scored.slice(0, MAX_MATCHES);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/online/matcher.test.ts`
Expected: All tests PASS (7 estimateCost + 9 rankPrograms = 16 total).

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/online/matcher.ts msstate-policies/tests/online/matcher.test.ts
git commit -m "feat(online): add rankPrograms with budget, level, state-auth, and goal scoring"
```

---

## Task 4: Build the `estimate_program_cost` MCP tool

**Files:**
- Create: `msstate-policies/src/tools/estimate_program_cost.ts`
- Create: `msstate-policies/tests/online/tool-estimate-program-cost.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/online/tool-estimate-program-cost.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { estimate_program_cost } from "../../src/tools/estimate_program_cost.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../../src/online/types.js";
import type { OnlineCorpus, OnlineProgram, DegreeLevel } from "../../src/online/types.js";

function prog(over: Partial<OnlineProgram> = {}): OnlineProgram {
  return {
    slug: "mba", name: "Master of Business Administration",
    degree_level: "master" as DegreeLevel, format: "Fully online",
    short_description: "",
    url: "https://www.online.msstate.edu/program/mba",
    tuition: { per_credit_usd: 750, instructional_fee_per_credit_usd: 50,
      application_fee_domestic_usd: 60, application_fee_international_usd: 80,
      raw_prose: "$750/cr" },
    contacts: [], application_deadlines: [], admission_requirements: "",
    entrance_exams: null, accreditation: null, forms: [], raw_sections: {},
    parse_warnings: [], retrieved_at: "x",
    ...over,
  };
}

function corpus(programs: OnlineProgram[]): OnlineCorpus {
  return {
    builtAt: "2026-05-18T00:00:00.000Z",
    source: "https://www.online.msstate.edu/",
    programs,
    admissions_process: { url: "x", central_contact: { name: "x", title: "x", email: null, phone: null },
      shared_prelude: "", sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" },
      application_fee_tiers: [], external_apply_urls: [], retrieved_at: "x" },
    staff: [], info_pages: [], staff_to_programs: [],
  };
}

async function call(args: unknown) {
  const res = await estimate_program_cost.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("estimate_program_cost tool", () => {
  test("computes total with disclaimer and corpus_built_at", async () => {
    setOnlineCorpus(corpus([prog()]));
    const r = await call({ slug: "mba", credits: 30 });
    assert.equal(r.disclaimer, ONLINE_DISCLAIMER);
    assert.equal(r.estimate.total_usd, 24000);
    assert.equal(r.estimate.credits_used, 30);
    assert.equal(r.corpus_built_at, "2026-05-18T00:00:00.000Z");
  });
  test("returns not_found_reason for unknown slug", async () => {
    setOnlineCorpus(corpus([prog()]));
    const r = await call({ slug: "nope" });
    assert.equal(r.estimate, null);
    assert.match(r.not_found_reason, /no program with slug 'nope'/i);
  });
  test("uses default credits when omitted", async () => {
    setOnlineCorpus(corpus([prog()]));
    const r = await call({ slug: "mba" });
    assert.equal(r.estimate.credits_used, 30);
    assert.equal(r.estimate.credits_source, "default_master_30");
  });
  test("includes application fee when flag set", async () => {
    setOnlineCorpus(corpus([prog()]));
    const r = await call({ slug: "mba", credits: 30, include_application_fee: true });
    assert.equal(r.estimate.total_usd, 24060);
  });
  test("rejects negative credits via zod", async () => {
    setOnlineCorpus(corpus([prog()]));
    await assert.rejects(() => call({ slug: "mba", credits: -1 }));
  });
  test("rejects slug longer than MAX_QUERY_CHARS", async () => {
    setOnlineCorpus(corpus([prog()]));
    await assert.rejects(() => call({ slug: "x".repeat(MAX_QUERY_CHARS + 1) }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/online/tool-estimate-program-cost.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/estimate_program_cost.js'`.

- [ ] **Step 3: Write the tool**

Create `msstate-policies/src/tools/estimate_program_cost.ts`:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getProgramBySlug, getOnlineCorpus } from "../online/corpus.js";
import { estimateCost } from "../online/matcher.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    slug: z.string().min(1).max(MAX_QUERY_CHARS),
    credits: z.number().int().min(0).max(500).optional(),
    include_application_fee: z.boolean().optional(),
  })
  .strict();

export const estimate_program_cost = {
  name: "estimate_program_cost",
  description:
    "Estimate the total cost of an MSU Online program: per_credit × credits + per-credit instructional fee, optionally + application fee. " +
    "Provide `slug` (exact, from list_online_programs); `credits` (int 0–500) is OPTIONAL — when omitted, defaults to 30 (master/cert/specialist), 120 (bachelor), or 60 (doctoral). " +
    "MSU Online does NOT publish total required credits in a structured field for every program; for an exact number, consult the program page (raw_prose is included in the response). " +
    "`include_application_fee` defaults to false. " +
    "Response carries the online disclaimer, source_url, and any explanatory notes when fields are missing. " +
    "Out-of-state? MSU Online tuition is largely flat-rate; the published per_credit_usd is what applies to most residency cases.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const program = getProgramBySlug(input.slug);
    const corpus = getOnlineCorpus();
    if (!program) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: ONLINE_DISCLAIMER,
            estimate: null,
            not_found_reason: `No program with slug '${input.slug}' in the corpus. Use list_online_programs to find valid slugs.`,
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        }],
      };
    }
    const estimate = estimateCost(
      program,
      input.credits ?? null,
      input.include_application_fee ?? false,
    );
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          disclaimer: ONLINE_DISCLAIMER,
          estimate,
          not_found_reason: null,
          corpus_built_at: corpus?.builtAt ?? null,
        }, null, 2),
      }],
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/online/tool-estimate-program-cost.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/estimate_program_cost.ts msstate-policies/tests/online/tool-estimate-program-cost.test.ts
git commit -m "feat(online): add estimate_program_cost MCP tool"
```

---

## Task 5: Build the `match_online_program` MCP tool

**Files:**
- Create: `msstate-policies/src/tools/match_online_program.ts`
- Create: `msstate-policies/tests/online/tool-match-online-program.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/online/tool-match-online-program.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { match_online_program } from "../../src/tools/match_online_program.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import { ONLINE_DISCLAIMER } from "../../src/online/types.js";
import type { OnlineCorpus, OnlineProgram, OnlineInfoPage, DegreeLevel } from "../../src/online/types.js";

function prog(slug: string, level: DegreeLevel, name: string, short: string): OnlineProgram {
  return {
    slug, name, degree_level: level, format: "Fully online",
    short_description: short, url: `https://www.online.msstate.edu/program/${slug}`,
    tuition: { per_credit_usd: 750, instructional_fee_per_credit_usd: 50,
      application_fee_domestic_usd: 60, application_fee_international_usd: 80, raw_prose: "" },
    contacts: [{ name: "Dr. Advisor", title: "Coord", email: "advisor@msstate.edu", phone: null }],
    application_deadlines: [{ term: "Fall", date_text: "August 1" }],
    admission_requirements: "", entrance_exams: null, accreditation: null,
    forms: [], raw_sections: {}, parse_warnings: [], retrieved_at: "x",
  };
}

function infoPage(slug: string, body: string): OnlineInfoPage {
  return { slug, title: slug, url: `x/${slug}`, body_markdown: body, retrieved_at: "x" };
}

function corpus(programs: OnlineProgram[], info_pages: OnlineInfoPage[] = []): OnlineCorpus {
  return {
    builtAt: "2026-05-18T00:00:00.000Z",
    source: "https://www.online.msstate.edu/",
    programs, info_pages,
    admissions_process: { url: "x", central_contact: { name: "x", title: "x", email: null, phone: null },
      shared_prelude: "", sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" },
      application_fee_tiers: [], external_apply_urls: [], retrieved_at: "x" },
    staff: [], staff_to_programs: [],
  };
}

async function call(args: unknown) {
  const res = await match_online_program.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("match_online_program tool", () => {
  test("returns up to 5 ranked matches with disclaimer", async () => {
    setOnlineCorpus(corpus([
      prog("mba", "master", "MBA", "business"),
      prog("ms-cs", "master", "MS CS", "computer science"),
    ]));
    const r = await call({ career_goal: "business" });
    assert.equal(r.disclaimer, ONLINE_DISCLAIMER);
    assert.equal(r.matches[0].slug, "mba");
    assert.ok(r.matches[0].fit_score > 0);
    assert.equal(r.matches[0].primary_contact_email, "advisor@msstate.edu");
  });
  test("filters by level_preference", async () => {
    setOnlineCorpus(corpus([
      prog("mba", "master", "MBA", "business"),
      prog("bsee", "bachelor", "BSEE", "engineering"),
    ]));
    const r = await call({ level_preference: "bachelor" });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].slug, "bsee");
  });
  test("state_authorization_flag uses state-authorization info page when state provided", async () => {
    // Fixture info-page body must contain a 2-letter code recognized by the
    // parser. Format chosen: "Authorized states: MS, AL, TN" line.
    setOnlineCorpus(corpus(
      [prog("mba", "master", "MBA", "business")],
      [infoPage("state-authorization", "Authorized states: MS, AL, TN")],
    ));
    const r = await call({ career_goal: "business", state: "MS" });
    assert.equal(r.matches[0].state_authorization_flag, "ok");
  });
  test("state_authorization_flag flags states not in list", async () => {
    setOnlineCorpus(corpus(
      [prog("mba", "master", "MBA", "business")],
      [infoPage("state-authorization", "Authorized states: MS, AL, TN")],
    ));
    const r = await call({ career_goal: "business", state: "CA" });
    assert.equal(r.matches[0].state_authorization_flag, "check_state_authorization_page");
  });
  test("empty profile returns at least the neutral-scored programs", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "MBA", "business")]));
    const r = await call({});
    assert.ok(r.matches.length >= 1);
  });
  test("rejects oversize career_goal via zod", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "MBA", "business")]));
    await assert.rejects(() => call({ career_goal: "x".repeat(5000) }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/online/tool-match-online-program.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/match_online_program.js'`.

- [ ] **Step 3: Write the tool with state-auth parser**

Create `msstate-policies/src/tools/match_online_program.ts`:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  listAllPrograms,
  getOnlineCorpus,
  getAllInfoPages,
} from "../online/corpus.js";
import { rankPrograms, type StateAuthorization } from "../online/matcher.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../online/types.js";

const Input = z
  .object({
    career_goal: z.string().max(MAX_QUERY_CHARS).optional(),
    level_preference: z
      .enum(["bachelor", "master", "specialist", "doctoral", "certificate", "endorsement"])
      .optional(),
    budget_usd: z.number().min(0).max(1_000_000).optional(),
    time_budget_months: z.number().int().min(1).max(120).optional(),
    state: z.string().regex(/^[A-Za-z]{2}$/).optional(),
    estimated_credits: z.number().int().min(0).max(500).optional(),
    include_application_fee: z.boolean().optional(),
  })
  .strict();

const US_STATE_RE = /\b([A-Z]{2})\b/g;
const ALL_50 = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);

function parseStateAuthorization(): StateAuthorization | null {
  const page = getAllInfoPages().find((p) => p.slug === "state-authorization");
  if (!page) return null;
  const matches = new Set<string>();
  for (const m of page.body_markdown.matchAll(US_STATE_RE)) {
    if (ALL_50.has(m[1])) matches.add(m[1]);
  }
  if (matches.size === 0) return null;
  return { authorized_states: [...matches] };
}

export const match_online_program = {
  name: "match_online_program",
  description:
    "Rank MSU Online programs against a prospective-student profile. ALL fields optional — supply only what the user has stated. " +
    "`career_goal` (free text — keyword overlap vs. program name + short_description), " +
    "`level_preference` (HARD filter: bachelor / master / specialist / doctoral / certificate / endorsement), " +
    "`budget_usd` (soft cap — programs over budget score lower but still appear; see estimate_program_cost for breakdown), " +
    "`time_budget_months` (penalises doctoral < 36mo and bachelor < 24mo), " +
    "`state` (2-letter postal code; cross-referenced against the state-authorization info page when present), " +
    "`estimated_credits` (optional override for cost estimation; defaults per degree level), " +
    "`include_application_fee` (default false). " +
    "Returns up to 5 matches sorted by fit_score (0–100) with fit_reasons, estimated_total_usd, application_deadline_next, primary_contact_name/email, and state_authorization_flag (ok / unknown / check_state_authorization_page). " +
    "Does NOT predict admission probability — only ranks fit. Always carries the online disclaimer.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const programs = listAllPrograms();
    const stateAuth = input.state ? parseStateAuthorization() : null;
    const matches = rankPrograms(programs, {
      career_goal: input.career_goal,
      level_preference: input.level_preference,
      budget_usd: input.budget_usd,
      time_budget_months: input.time_budget_months,
      state: input.state,
      estimated_credits: input.estimated_credits,
      include_application_fee: input.include_application_fee,
    }, stateAuth);
    const corpus = getOnlineCorpus();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          disclaimer: ONLINE_DISCLAIMER,
          matches,
          state_authorization_source: stateAuth ? "state-authorization info page" : null,
          corpus_built_at: corpus?.builtAt ?? null,
        }, null, 2),
      }],
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/online/tool-match-online-program.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/match_online_program.ts msstate-policies/tests/online/tool-match-online-program.test.ts
git commit -m "feat(online): add match_online_program MCP tool"
```

---

## Task 6: Register both tools in stdio server

**Files:**
- Modify: `msstate-policies/src/index.ts:46-50` (imports block) and `:92-118` (TOOLS array) and `:73-89` (SERVER_INSTRUCTIONS)

- [ ] **Step 1: Add imports**

Edit `msstate-policies/src/index.ts`, after line 50 (the `list_programs_by_staff` import):

```typescript
import { match_online_program } from "./tools/match_online_program.js";
import { estimate_program_cost } from "./tools/estimate_program_cost.js";
```

- [ ] **Step 2: Register in TOOLS array**

In the `TOOLS` const, insert `match_online_program` and `estimate_program_cost` immediately after `list_programs_by_staff,` (line 114):

```typescript
  list_programs_by_staff,
  match_online_program,
  estimate_program_cost,
```

- [ ] **Step 3: Update SERVER_INSTRUCTIONS rule 6**

Edit rule 6 in `SERVER_INSTRUCTIONS` (line 82) — replace the rule with:

```
6. Online-program / online-admissions / online-student-services questions ("does MSU have an online MBA?", "how do I apply to MSU online?", "who's the advisor for the online psychology program?", "what's the application deadline for the online MS in Cybersecurity?", "does MSU online operate in my state?", "military assistance for MSU online", "which online program fits me?", "how much does an online master's cost?") → list_online_programs / get_online_program / get_online_admissions_process / find_online_info / list_programs_by_staff / match_online_program / estimate_program_cost, picked by question shape. Use match_online_program when the user describes a profile (career goal, budget, level, state) and wants a shortlist; use estimate_program_cost when the user names a specific program and asks "how much". Distinction from policies/courses/tuition: the online module covers MSU's ONLINE program offerings via online.msstate.edu — distinct from the broader policy/course/tuition corpus. Online-specific tuition rates from controller.msstate.edu stay under get_msu_tuition_rate.
```

- [ ] **Step 4: Run all tests**

Run: `cd msstate-policies && npm test`
Expected: All tests pass, including the new matcher / tool-estimate / tool-match suites.

- [ ] **Step 5: Run typecheck + build**

Run: `cd msstate-policies && npm run typecheck && npm run build`
Expected: Build succeeds; `dist/index.js` rebuilt with both new tools bundled.

- [ ] **Step 6: Commit**

```bash
git add msstate-policies/src/index.ts msstate-policies/dist/
git commit -m "feat(online): register match_online_program + estimate_program_cost in stdio server"
```

---

## Task 7: Mirror both tools in the Cloudflare Worker

**Files:**
- Modify: `worker/src/index.ts` (tool descriptors block near line 1599; dispatcher switch near line 2167; SERVER_INSTRUCTIONS near line 2434)

- [ ] **Step 1: Add tool descriptors**

In `worker/src/index.ts`, locate the tool-descriptor list (search for `name: "list_programs_by_staff"`). Append two new entries with the same `description` strings used in the stdio tool files (copy verbatim from `msstate-policies/src/tools/match_online_program.ts` and `estimate_program_cost.ts`). `inputSchema` should be the JSON-schema form. Mirror the pattern of existing online entries — same indentation, same field order.

- [ ] **Step 2: Add dispatcher switch cases**

After `case "list_programs_by_staff":` block, add two new cases. The matcher case must re-implement (not import — the Worker is a separate bundle) the `parseStateAuthorization` + `rankPrograms` call chain. For minimum drift, copy the helper bodies from `src/online/matcher.ts` into the Worker as a `function rankProgramsWorker(...)`. The estimator case copies `estimateCost`. Wire both behind the existing `MAX_QUERY_CHARS` length cap (search for `MAX_QUERY_CHARS` in the Worker for the existing pattern).

Implementation skeleton for each case:

```typescript
case "match_online_program": {
  const args = req.params.arguments ?? {};
  if (typeof args.career_goal === "string" && args.career_goal.length > MAX_QUERY_CHARS) {
    return reject(req.id, "career_goal exceeds max length");
  }
  // ... mirror handler logic from src/tools/match_online_program.ts
}

case "estimate_program_cost": {
  const args = req.params.arguments ?? {};
  if (typeof args.slug === "string" && args.slug.length > MAX_QUERY_CHARS) {
    return reject(req.id, "slug exceeds max length");
  }
  // ... mirror handler logic from src/tools/estimate_program_cost.ts
}
```

- [ ] **Step 3: Update Worker `SERVER_INSTRUCTIONS`**

Around line 2434 in `worker/src/index.ts`, replace rule 6 with the identical text used in Task 6 Step 3 — keep stdio + worker single source of truth.

- [ ] **Step 4: Run worker smoke checks**

Run: `cd worker && npm test 2>&1 | tail -40` (or whatever the worker uses — check `worker/package.json`'s test script before running).
Expected: All worker tests still pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): mirror match_online_program + estimate_program_cost dispatchers"
```

---

## Task 8: Add eval cases

**Files:**
- Modify: `msstate-policies/eval/online.jsonl` (append)

- [ ] **Step 1: Append 12 cases — 6 matcher, 6 estimator**

Use `find_online_info` / `list_online_programs` / live MSU pages to confirm expected slugs before authoring. NEVER fabricate program names — every `expected_slug` must exist in the current corpus.

Append (one JSON object per line — no trailing comma):

```jsonl
{"kind":"program_match","desc":"business career → MBA top","args":{"name":"match_online_program","arguments":{"career_goal":"business","level_preference":"master"}},"expect":{"top_slug_one_of":["mba"]}}
{"kind":"program_match","desc":"cybersecurity master","args":{"name":"match_online_program","arguments":{"career_goal":"cyber security","level_preference":"master"}},"expect":{"top_slug_contains":"cyber"}}
{"kind":"program_match","desc":"data analytics master","args":{"name":"match_online_program","arguments":{"career_goal":"data analytics"}},"expect":{"matches_min":1}}
{"kind":"program_match","desc":"engineering bachelor filter","args":{"name":"match_online_program","arguments":{"career_goal":"engineering","level_preference":"bachelor"}},"expect":{"all_match_level":"bachelor"}}
{"kind":"program_match","desc":"empty profile returns >=1","args":{"name":"match_online_program","arguments":{}},"expect":{"matches_min":1}}
{"kind":"program_match","desc":"state CA flagged when not in auth list","args":{"name":"match_online_program","arguments":{"career_goal":"business","state":"CA"}},"expect":{"state_flag_in":["unknown","check_state_authorization_page","ok"]}}
{"kind":"program_cost","desc":"MBA cost default credits","args":{"name":"estimate_program_cost","arguments":{"slug":"mba"}},"expect":{"estimate_credits_used":30,"estimate_total_usd_min":1000}}
{"kind":"program_cost","desc":"MBA cost with credits override","args":{"name":"estimate_program_cost","arguments":{"slug":"mba","credits":36}},"expect":{"estimate_credits_used":36}}
{"kind":"program_cost","desc":"MBA cost include app fee","args":{"name":"estimate_program_cost","arguments":{"slug":"mba","include_application_fee":true}},"expect":{"estimate_application_fee_included":true}}
{"kind":"program_cost","desc":"bachelor default credits = 120","args":{"name":"estimate_program_cost","arguments":{"slug":"bsee"}},"expect":{"estimate_credits_used":120}}
{"kind":"program_cost","desc":"unknown slug returns not_found_reason","args":{"name":"estimate_program_cost","arguments":{"slug":"definitely-not-a-program"}},"expect":{"estimate_null":true,"not_found_reason_contains":"definitely-not-a-program"}}
{"kind":"program_cost","desc":"doctoral default credits = 60","args":{"name":"estimate_program_cost","arguments":{"slug":"phd-engineering-cise"}},"expect":{"estimate_credits_used":60}}
```

**Note:** The slugs `mba`, `bsee`, `phd-engineering-cise` are guesses based on the existing eval set. Before merging, run `npx tsx -e 'import {setOnlineCorpus, listAllPrograms} from "./msstate-policies/src/online/corpus.js"; ...'` against the baked corpus (or query the live tool) to confirm. If `phd-engineering-cise` doesn't exist, substitute any doctoral slug returned by `list_online_programs({level: "doctoral"})`. Per the corpus rule, do NOT guess slugs.

- [ ] **Step 2: Extend `scripts/run-eval.mjs` to handle the new `expect` keys**

Add (or update) the assertion branches in the harness for the new `expect` keys: `top_slug_one_of`, `top_slug_contains`, `matches_min`, `all_match_level`, `state_flag_in`, `estimate_credits_used`, `estimate_total_usd_min`, `estimate_application_fee_included`, `estimate_null`, `not_found_reason_contains`. Follow the existing assertion-helper pattern (search `expect.matched_name_contains` for the closest reference).

- [ ] **Step 3: Run the deterministic suite**

Run: `cd msstate-policies && node ../scripts/run-eval.mjs --suite online --no-judge`
Expected: All new cases pass; no regressions on existing online cases.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/eval/online.jsonl scripts/run-eval.mjs
git commit -m "test(eval): add 12 matcher/estimator cases to online suite"
```

---

## Task 9: Security checklist updates (ONL5 + new ONL6)

**Files:**
- Modify: `tools/security-checklist.sh` (online block ~line 580)

- [ ] **Step 1: Update ONL5 count**

Find the ONL5 check (greps for `ONLINE_DISCLAIMER` references across `msstate-policies/src/tools/`). The current count is 5 tool files (set after v1.1.1 added `list_programs_by_staff.ts`). Bump to **7**.

- [ ] **Step 2: Add ONL6 (10 pts) — matcher allowlist guard**

Append after the ONL5 block:

```bash
# ONL6 (10 pts): match_online_program never echoes raw program data sourced
# outside the OnlineCorpus. Guarantee: handler reads only from
# listAllPrograms() + getAllInfoPages(). No fetch / no fs / no process.env.
ONL6_OK=0
if [ -f msstate-policies/src/tools/match_online_program.ts ] \
   && [ -f msstate-policies/src/tools/estimate_program_cost.ts ]; then
  BAD=$(grep -nE 'fetch\(|require\(|process\.env|child_process|fs\.' \
    msstate-policies/src/tools/match_online_program.ts \
    msstate-policies/src/tools/estimate_program_cost.ts \
    msstate-policies/src/online/matcher.ts 2>/dev/null | wc -l | tr -d ' ')
  if [ "$BAD" = "0" ]; then ONL6_OK=1; fi
fi
if [ "$ONL6_OK" = "1" ]; then
  SCORE=$((SCORE+10))
  note "PASS" "ONL6 matcher/estimator never call fetch/require/env/fs/child_process" 10
else
  note "FAIL" "ONL6 matcher/estimator made a forbidden runtime call" 10
fi
```

- [ ] **Step 3: Update score targets**

Update the score targets in `CLAUDE.md` section "Security notes" and the summary lines in `tools/security-checklist.sh` header — bump from **292 → 302**. CI hard-gate remains at `>= 100`. Same change to README.md / docs/BUILD.md where 292 appears.

Search for current references:
```bash
grep -rn "292" CLAUDE.md README.md docs/BUILD.md tools/security-checklist.sh msstate-policies/README.md
```

- [ ] **Step 4: Run the checklist**

Run: `bash tools/security-checklist.sh | tail -1`
Expected: `302`.

- [ ] **Step 5: Commit**

```bash
git add tools/security-checklist.sh CLAUDE.md README.md docs/BUILD.md
git commit -m "chore(security): ONL5 -> 7 files, add ONL6 (matcher purity); score 292 -> 302"
```

---

## Task 10: Docs + version bump + final smoke

**Files:**
- Modify: `CLAUDE.md` (append corpus extension)
- Modify: `README.md` (tool count 25 → 27)
- Modify: `msstate-policies/README.md` (mirror)
- Modify: `docs/BUILD.md` (extension note)
- Modify: `msstate-policies/package.json` (version 1.2.0 → 1.2.2)

- [ ] **Step 1: Append CLAUDE.md addendum**

Append after the v1.1.1 corpus-extension block (end of "Corpus extension" section):

```markdown
### Corpus extension (2026-05-18) — program matcher (v1.2.2)

Adds 2 derived tools (`match_online_program`, `estimate_program_cost`) over
the existing online corpus. No new corpus sources. Tool count 25 -> 27.

**`match_online_program(profile)`** — ranks up to 5 programs by deterministic
keyword + budget + time + state scoring. Reads OnlineProgram[] + state-authorization
info page only. Does NOT predict admission probability. Carries ONLINE_DISCLAIMER.

**`estimate_program_cost(slug, credits?, include_application_fee?)`** —
per_credit × credits + per-credit instructional fee. Required credits not
published by every program; defaults applied per degree level (master/cert 30,
bachelor 120, doctoral 60). Notes string surfaces every default applied.

**Security checks updated:** ONL5 references 7 tool files (was 5). New ONL6
(10 pts): matcher + estimator + helper never call fetch/require/env/fs/
child_process. Score 292 -> 302.
```

- [ ] **Step 2: Bump tool count in READMEs**

In `README.md` and `msstate-policies/README.md`, replace every literal `25 tools` / `25 MCP tools` with `27 tools` / `27 MCP tools`. Add the two new tools to the per-domain table (Online column: 5 → 7).

- [ ] **Step 3: Append docs/BUILD.md note**

Append a single paragraph under the most recent extension block in `docs/BUILD.md`:

```
### v1.2.2 (2026-05-18) — Program matcher + cost estimator

Adds match_online_program (profile → ranked shortlist) and estimate_program_cost
(slug + credits → total-cost rollup) over the existing OnlineCorpus. Both tools
are pure-derived — no new scraping, no new corpus sources. State-authorization
flag cross-references the state-authorization info page. Cost estimator applies
degree-level defaults when credits are not supplied, with explanatory notes.
Tool count 25 -> 27. Security score 292 -> 302 (ONL5 file-count bump + new
ONL6 matcher-purity check).
```

- [ ] **Step 4: Bump version**

In `msstate-policies/package.json`, change `"version": "1.2.0"` to `"version": "1.2.2"` (1.2.1 was reserved for the prior eval-suite branch per CLAUDE.md).

- [ ] **Step 5: Full rebuild + checklist + tests**

Run:
```bash
cd msstate-policies && npm run build && npm test
cd .. && bash tools/security-checklist.sh | tail -1
```
Expected: All tests pass. Security score reads `302`.

- [ ] **Step 6: Smoke the bundled tools via tools/list**

Run: `node msstate-policies/dist/index.js < scripts/list-tools-stdin.json 2>/dev/null | head -50`
(If no fixture exists, create a minimal JSON-RPC `initialize` + `tools/list` payload — pattern is documented in `msstate-policies/tests/stdio-bundle-*.ts`.)
Expected: Response includes `match_online_program` and `estimate_program_cost` in the tools array.

- [ ] **Step 7: Commit + tag**

```bash
git add CLAUDE.md README.md msstate-policies/README.md docs/BUILD.md msstate-policies/package.json msstate-policies/dist/
git commit -m "release: v1.2.2 program matcher + cost estimator (27 tools, score 302)"
```

---

## Self-Review Checklist (run before declaring done)

1. **Spec coverage:** Both feature tools (`match_online_program`, `estimate_program_cost`) appear in TOOLS, Worker dispatcher, SERVER_INSTRUCTIONS (both copies), and have eval cases ≥ 6 each.
2. **Type consistency:** `MatcherProfile`, `MatchedProgram`, `CostEstimate`, `StateAuthorization` referenced identically in matcher.ts, both tool files, both test files, and Worker mirror.
3. **No placeholders:** Every test step shows actual code, every commit shows a message, every grep shows a command. No "TBD" / "similar to above" remain.
4. **Corpus rule:** No new fetch / no new training-data assumption. All values come from the existing OnlineCorpus.
5. **Security:** Score increases by exactly 10 (ONL6) plus ONL5 still passes; total 302.
6. **Disclaimer:** Both new tools emit `ONLINE_DISCLAIMER` on every response path (matched + not_found + error).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-program-matcher.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
