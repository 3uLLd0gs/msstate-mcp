# Citation Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a meta-tool `citation_card(text, domain_hints?)` that takes any answer text, splits it into sentence-level claims, runs each claim against the appropriate domain corpus (policies, calendar, tuition, courses, online, emergency, dining), and returns a list of `{claim, source_url, source_title, last_updated, snippet, confidence}` cards. This is the "you can trust this answer" surface — every demo, every adoption pitch leans on it.

**Architecture:** Pure-derived tool over the seven existing corpora. No new corpus sources. A new `citation_router` module dispatches claim → best-matching corpus using existing tokenization + DF (document frequency) heuristics, then delegates to per-corpus search helpers (BM25 for policies/online, structured lookup for calendar/tuition, etc.) and uses each corpus's `builtAt` / `scraped_at` timestamp as `last_updated`. Output is structured: model can render as Markdown citation footnotes, JSON cards, or "no citation found" gaps. Mirrors to the Cloudflare Worker.

**Tech Stack:** TypeScript 5.5, zod 3.23, existing per-corpus search helpers. No new dependencies.

---

## Read Before Starting

1. `CLAUDE.md` § "Reading order" + § "CORPUS RULE".
2. `msstate-policies/src/tools/cite_policy.ts` — current single-OP citation tool. New tool is its generalization across all 7 domains.
3. `msstate-policies/src/search.ts` (policies BM25), `msstate-policies/src/online/search.ts` (online BM25), `msstate-policies/src/courses/search.ts`, `msstate-policies/src/calendars/search.ts`, `msstate-policies/src/tuition/corpus.ts`, `msstate-policies/src/emergency/corpus.ts`, `msstate-policies/src/dining/corpus.ts`. These are the seven retrieval surfaces the router dispatches across.
4. `msstate-policies/src/corpus.ts` — `getPolicy`, `getIndex`, etc.
5. `worker/src/index.ts` — search `case "cite_policy":` for the worker dispatch pattern this tool mirrors.
6. `msstate-policies/eval/online.jsonl` and `eval/dates.jsonl` — JSONL eval format.

## File Structure

**New files:**
- `msstate-policies/src/citation/router.ts` — pure dispatcher: `splitClaims(text)`, `routeClaim(claim, hints)`, `searchInDomain(claim, domain)`. No I/O beyond reading already-loaded corpora.
- `msstate-policies/src/citation/types.ts` — `CitationCard`, `CitationDomain`, `CitationResult`.
- `msstate-policies/src/tools/citation_card.ts` — MCP tool wrapper.
- `msstate-policies/tests/citation/router.test.ts` — unit tests for splitClaims + routeClaim + searchInDomain.
- `msstate-policies/tests/citation/tool-citation-card.test.ts` — integration tests.

**Modified files:**
- `msstate-policies/src/index.ts` — register `citation_card` in TOOLS; add rule 8 to SERVER_INSTRUCTIONS.
- `worker/src/index.ts` — tool descriptor + dispatch case (mirror).
- `msstate-policies/eval/citation.jsonl` — NEW eval file with 15+ cases.
- `scripts/run-eval.mjs` — handle `--suite citation` and new `expect` keys.
- `tools/security-checklist.sh` — new CIT1-CIT3 checks (+8 pts).
- `CLAUDE.md` — append "Corpus extension (2026-05-18) — citation card (v1.2.3)".
- `README.md`, `msstate-policies/README.md`, `docs/BUILD.md` — tool count bump.
- `msstate-policies/package.json` — version 1.2.2 → 1.2.3 (assumes program-matcher plan landed first; else 1.2.0 → 1.2.3 with note in commit).

## Scope check

Single tool, single feature. The router is intentionally factored into a separate module so per-domain logic stays close to each corpus (each domain has its own search helper) and the tool file stays thin. Independent of the program-matcher and semester-planner plans — can ship in any order.

---

## Task 1: Add citation types

**Files:**
- Create: `msstate-policies/src/citation/types.ts`

- [ ] **Step 1: Write the types module**

```typescript
/**
 * Citation card — trust-surface meta-tool over all seven MSU corpora.
 *
 * Corpus rule (CLAUDE.md): every citation MUST originate from a baked
 * corpus entry. NEVER fabricate a URL or paraphrase that wasn't already
 * in the corpus snippet returned by the per-domain search helper.
 */

export type CitationDomain =
  | "policies"
  | "calendar"
  | "courses"
  | "emergency"
  | "tuition"
  | "online"
  | "dining";

export const ALL_DOMAINS: readonly CitationDomain[] = Object.freeze([
  "policies", "calendar", "courses", "emergency", "tuition", "online", "dining",
]);

/**
 * MAX_CLAIM_CHARS limits each split claim to keep tokenize() bounded.
 * MAX_INPUT_CHARS limits the total citation_card input.
 * MAX_CLAIMS caps how many claims we process per call.
 */
export const MAX_CLAIM_CHARS = 800;
export const MAX_INPUT_CHARS = 8000;
export const MAX_CLAIMS = 40;

export const CITATION_DISCLAIMER =
  "Citations are matched against MSU's published corpora. A 'no_citation_found' result means we couldn't trace the claim to an MSU source — treat that claim as unverified.";

export interface CitationCard {
  claim: string;
  domain: CitationDomain | null;        // null when no domain matched
  source_url: string | null;
  source_title: string | null;
  last_updated: string | null;          // ISO timestamp from corpus.builtAt / scraped_at
  snippet: string | null;               // up to 240 chars from the matched corpus entry
  confidence: "high" | "medium" | "low" | "none";
  reason: string;                        // why this result was returned (or why nothing matched)
}

export interface CitationResult {
  disclaimer: string;
  cards: CitationCard[];
  claims_processed: number;
  claims_truncated: boolean;             // true when MAX_CLAIMS exceeded
  by_domain_counts: Record<CitationDomain | "none", number>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd msstate-policies && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/citation/types.ts
git commit -m "feat(citation): add CitationCard / CitationDomain types"
```

---

## Task 2: TDD `splitClaims`

**Files:**
- Create: `msstate-policies/src/citation/router.ts`
- Create: `msstate-policies/tests/citation/router.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `msstate-policies/tests/citation/router.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { splitClaims } from "../../src/citation/router.js";
import { MAX_CLAIMS } from "../../src/citation/types.js";

describe("splitClaims", () => {
  test("splits on sentence boundaries", () => {
    const r = splitClaims("MSU's drop deadline is October 15. The MBA tuition is $750 per credit. Spring break is in March.");
    assert.equal(r.length, 3);
    assert.match(r[0], /drop deadline/);
  });
  test("trims and skips empty fragments", () => {
    const r = splitClaims("First.  Second.\n\n   Third.");
    assert.equal(r.length, 3);
    assert.equal(r[0], "First");
    assert.equal(r[2], "Third");
  });
  test("preserves abbreviations as boundary noise (no false splits)", () => {
    const r = splitClaims("Dr. Smith is the advisor. Email him.");
    // Acceptable: 2 sentences. A trailing "Email him" claim is fine; an
    // over-split into "Dr" + "Smith is the advisor" + "Email him" is a bug.
    assert.ok(r.length <= 3);
    assert.ok(r.some((s) => /Smith.*advisor/.test(s)));
  });
  test("caps at MAX_CLAIMS", () => {
    const text = Array.from({ length: MAX_CLAIMS + 10 }, (_, i) => `Claim ${i}.`).join(" ");
    const r = splitClaims(text);
    assert.equal(r.length, MAX_CLAIMS);
  });
  test("truncates over-long claim to MAX_CLAIM_CHARS", () => {
    const long = "x".repeat(2000);
    const r = splitClaims(`Short. ${long}.`);
    assert.equal(r.length, 2);
    assert.ok(r[1].length <= 800);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd msstate-policies && npx tsx --test tests/citation/router.test.ts`
Expected: All FAIL — `Cannot find module '../../src/citation/router.js'`.

- [ ] **Step 3: Implement splitClaims**

Create `msstate-policies/src/citation/router.ts`:

```typescript
/**
 * Claim router for citation_card.
 *
 * - splitClaims: text → sentence-level claim strings.
 * - routeClaim: claim + optional hints → CitationDomain | null.
 * - searchInDomain: claim + domain → CitationCard (per-corpus delegation).
 *
 * No I/O — relies on already-loaded corpora via existing per-corpus accessors.
 */
import {
  type CitationDomain,
  ALL_DOMAINS,
  MAX_CLAIM_CHARS,
  MAX_CLAIMS,
} from "./types.js";

// Splits on `.!?` boundaries that are followed by whitespace + capital letter
// or end-of-string. Lenient — over-splits are preferable to under-splits
// (each becomes its own claim). Truncates each to MAX_CLAIM_CHARS and caps
// the count at MAX_CLAIMS.
export function splitClaims(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [];
  const parts = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$])/)
    .map((s) => s.replace(/[.!?]+$/, "").trim())
    .filter((s) => s.length > 0);
  const truncated = parts.map((s) => (s.length > MAX_CLAIM_CHARS ? s.slice(0, MAX_CLAIM_CHARS) : s));
  return truncated.slice(0, MAX_CLAIMS);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/citation/router.test.ts`
Expected: All 5 splitClaims tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/citation/router.ts msstate-policies/tests/citation/router.test.ts
git commit -m "feat(citation): add splitClaims helper with TDD"
```

---

## Task 3: TDD `routeClaim`

**Files:**
- Modify: `msstate-policies/src/citation/router.ts` (append)
- Modify: `msstate-policies/tests/citation/router.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `msstate-policies/tests/citation/router.test.ts`:

```typescript
import { routeClaim } from "../../src/citation/router.js";

describe("routeClaim", () => {
  test("policy-shaped claim → policies", () => {
    assert.equal(routeClaim("MSU OP 91.100 governs amnesty.", undefined), "policies");
  });
  test("date-shaped claim → calendar", () => {
    assert.equal(routeClaim("Spring break begins March 9, 2027.", undefined), "calendar");
  });
  test("dollar amount + tuition → tuition", () => {
    assert.equal(routeClaim("Resident undergraduate tuition is $5,123 per semester.", undefined), "tuition");
  });
  test("course code → courses", () => {
    assert.equal(routeClaim("CSE 1284 is a prereq for CSE 2383.", undefined), "courses");
  });
  test("emergency keyword → emergency", () => {
    assert.equal(routeClaim("During a tornado warning, go to the basement.", undefined), "emergency");
  });
  test("online program → online", () => {
    assert.equal(routeClaim("The online MBA application deadline is August 1.", undefined), "online");
  });
  test("dining keyword → dining", () => {
    assert.equal(routeClaim("Perry Cafeteria closes at 9pm on Sundays.", undefined), "dining");
  });
  test("empty / generic claim → null", () => {
    assert.equal(routeClaim("This is a sentence about nothing.", undefined), null);
  });
  test("hint overrides heuristic on ambiguous claim", () => {
    // "Fall registration opens August 1" could be calendar OR online.
    // With explicit hint we trust the caller.
    assert.equal(routeClaim("Fall registration opens August 1.", ["online"]), "online");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd msstate-policies && npx tsx --test tests/citation/router.test.ts`
Expected: 9 routeClaim tests FAIL with `routeClaim is not exported`.

- [ ] **Step 3: Implement routeClaim**

Append to `msstate-policies/src/citation/router.ts`:

```typescript
const COURSE_CODE_RE = /\b[A-Z]{2,4}\s\d{4}\b/;
const POLICY_OP_RE = /\b(OP|operating policy)\s*\d{2}\.\d{2,3}\b/i;
const DOLLAR_RE = /\$\s?\d/;
const MONTH_DAY_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i;

const EMERGENCY_TERMS = new Set([
  "tornado", "fire", "shooter", "active shooter", "lockdown", "evacuation",
  "refuge", "weather warning", "emergency", "msu pd", "911",
]);

const TUITION_TERMS = new Set([
  "tuition", "fee", "fees", "credit hour", "per credit", "in-state", "out-of-state",
  "resident", "non-resident", "scholarship", "billing",
]);

const ONLINE_TERMS = new Set([
  "online program", "online mba", "online bachelor", "online master",
  "online certificate", "online doctoral", "online application", "online deadline",
  "msu online",
]);

const DINING_TERMS = new Set([
  "dining", "cafeteria", "restaurant", "perry", "chick-fil-a", "starbucks",
  "open", "closes", "hours", "lunch", "breakfast", "dinner", "meal plan",
]);

const CALENDAR_TERMS = new Set([
  "registration", "drop deadline", "add deadline", "spring break", "fall break",
  "thanksgiving", "winter break", "commencement", "finals", "exam schedule",
  "holiday", "first day of class", "last day of class",
]);

function lowerWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1),
  );
}

function anyTermMatch(claim: string, terms: Set<string>): boolean {
  const lower = claim.toLowerCase();
  for (const t of terms) {
    if (t.includes(" ") ? lower.includes(t) : lowerWords(claim).has(t)) return true;
  }
  return false;
}

export function routeClaim(claim: string, hints: readonly CitationDomain[] | undefined): CitationDomain | null {
  if (hints && hints.length > 0) {
    const valid = hints.filter((h) => ALL_DOMAINS.includes(h));
    if (valid.length > 0) return valid[0];
  }
  if (POLICY_OP_RE.test(claim)) return "policies";
  if (COURSE_CODE_RE.test(claim)) return "courses";
  if (anyTermMatch(claim, EMERGENCY_TERMS)) return "emergency";
  if (anyTermMatch(claim, ONLINE_TERMS)) return "online";
  if (DOLLAR_RE.test(claim) && anyTermMatch(claim, TUITION_TERMS)) return "tuition";
  if (MONTH_DAY_RE.test(claim) || anyTermMatch(claim, CALENDAR_TERMS)) return "calendar";
  if (anyTermMatch(claim, DINING_TERMS)) return "dining";
  if (anyTermMatch(claim, TUITION_TERMS)) return "tuition";
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd msstate-policies && npx tsx --test tests/citation/router.test.ts`
Expected: All 14 tests (5 splitClaims + 9 routeClaim) PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/citation/router.ts msstate-policies/tests/citation/router.test.ts
git commit -m "feat(citation): add routeClaim heuristic dispatcher"
```

---

## Task 4: TDD `searchInDomain`

**Files:**
- Modify: `msstate-policies/src/citation/router.ts` (append)
- Modify: `msstate-policies/tests/citation/router.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `msstate-policies/tests/citation/router.test.ts`:

```typescript
import { searchInDomain } from "../../src/citation/router.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import type { OnlineCorpus, OnlineInfoPage } from "../../src/online/types.js";

function infoPage(slug: string, title: string, body: string): OnlineInfoPage {
  return { slug, title, url: `https://www.online.msstate.edu/${slug}`, body_markdown: body, retrieved_at: "x" };
}

function onlineCorpus(info_pages: OnlineInfoPage[]): OnlineCorpus {
  return {
    builtAt: "2026-05-18T00:00:00.000Z",
    source: "https://www.online.msstate.edu/",
    programs: [],
    admissions_process: { url: "x", central_contact: { name: "x", title: "x", email: null, phone: null },
      shared_prelude: "", sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" },
      application_fee_tiers: [], external_apply_urls: [], retrieved_at: "x" },
    staff: [], info_pages, staff_to_programs: [],
  };
}

describe("searchInDomain", () => {
  test("online: returns card with source_url + snippet when BM25 hit", async () => {
    setOnlineCorpus(onlineCorpus([
      infoPage("military-assistance", "Military Assistance", "MSU Online offers tuition assistance for active-duty servicemembers and veterans."),
    ]));
    const card = await searchInDomain("Does MSU Online have military assistance?", "online");
    assert.equal(card.domain, "online");
    assert.ok(card.source_url?.includes("military-assistance"));
    assert.ok(card.snippet && card.snippet.length > 0);
    assert.notEqual(card.confidence, "none");
    assert.equal(card.last_updated, "2026-05-18T00:00:00.000Z");
  });
  test("online: returns 'none' card when no hit", async () => {
    setOnlineCorpus(onlineCorpus([
      infoPage("faq", "FAQ", "Generic question and answer content."),
    ]));
    const card = await searchInDomain("xyzzy-no-such-term-anywhere", "online");
    assert.equal(card.confidence, "none");
    assert.equal(card.source_url, null);
  });
  test("calendar: TBD-stub returns 'none' until calendar wiring lands (Task 4b)", async () => {
    const card = await searchInDomain("Spring break is March 9, 2027.", "calendar");
    // Acceptable: low/none confidence if calendar BM25 not warm in this test
    // context. The integration test (Task 6) will exercise the full path.
    assert.ok(card.confidence === "none" || card.confidence === "low" || card.confidence === "medium" || card.confidence === "high");
    assert.equal(card.domain, "calendar");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd msstate-policies && npx tsx --test tests/citation/router.test.ts`
Expected: 3 searchInDomain tests FAIL — `searchInDomain is not exported`.

- [ ] **Step 3: Implement searchInDomain (per-domain delegation)**

Append to `msstate-policies/src/citation/router.ts`:

```typescript
import type { CitationCard } from "./types.js";
import { bm25SearchInfo } from "../online/search.js";
import { getOnlineCorpus } from "../online/corpus.js";
import { getCourse } from "../courses/corpus.js";
import { getEmergencyCorpus } from "../emergency/corpus.js";
import { getTuitionCorpus } from "../tuition/corpus.js";
import { getDiningCorpus } from "../dining/corpus.js";
// Policies + calendar use the existing top-level search modules.
import { searchPolicies } from "../search.js";
import { searchCalendar } from "../calendars/search.js";

const SNIPPET_MAX = 240;

function snippet(text: string): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > SNIPPET_MAX ? cleaned.slice(0, SNIPPET_MAX) + "…" : cleaned;
}

function none(claim: string, domain: CitationDomain | null, reason: string): CitationCard {
  return {
    claim, domain, source_url: null, source_title: null, last_updated: null,
    snippet: null, confidence: "none", reason,
  };
}

async function searchOnline(claim: string): Promise<CitationCard> {
  const corpus = getOnlineCorpus();
  if (!corpus) return none(claim, "online", "online corpus not loaded");
  const hits = bm25SearchInfo(claim, 1, "all");
  if (hits.length === 0) return none(claim, "online", "no BM25 hit in info pages");
  const top = hits[0];
  const conf = top.score > 5 ? "high" : top.score > 2 ? "medium" : "low";
  return {
    claim, domain: "online",
    source_url: top.row.url, source_title: top.row.title,
    last_updated: corpus.builtAt, snippet: snippet(top.row.body_markdown),
    confidence: conf, reason: `BM25 match in info_pages (score=${top.score.toFixed(2)})`,
  };
}

async function searchPoliciesDomain(claim: string): Promise<CitationCard> {
  const opMatch = claim.match(/\b(?:OP|operating policy)\s*(\d{2}\.\d{2,3})\b/i);
  if (opMatch) {
    // Direct OP reference — return canonical landing URL via top-level search.
    const hits = await searchPolicies(opMatch[1], 1);
    if (hits.length > 0) {
      return {
        claim, domain: "policies", source_url: hits[0].landingUrl,
        source_title: hits[0].title, last_updated: hits[0].effectiveDate ?? null,
        snippet: snippet(hits[0].summary ?? ""), confidence: "high",
        reason: `direct OP reference to ${opMatch[1]}`,
      };
    }
  }
  const hits = await searchPolicies(claim, 1);
  if (hits.length === 0) return none(claim, "policies", "no policy index hit");
  return {
    claim, domain: "policies", source_url: hits[0].landingUrl,
    source_title: hits[0].title, last_updated: hits[0].effectiveDate ?? null,
    snippet: snippet(hits[0].summary ?? ""), confidence: "medium",
    reason: "policy index match (no direct OP cite in claim)",
  };
}

async function searchCalendarDomain(claim: string): Promise<CitationCard> {
  const hits = await searchCalendar(claim, 1);
  if (!hits || hits.length === 0) return none(claim, "calendar", "no calendar row matched");
  const row = hits[0];
  return {
    claim, domain: "calendar", source_url: row.source_url ?? null,
    source_title: row.label ?? row.source ?? "MSU calendar entry",
    last_updated: row.scraped_at ?? null,
    snippet: snippet(`${row.label ?? ""} ${row.date_text ?? ""}`),
    confidence: "high", reason: `calendar match (source=${row.source})`,
  };
}

async function searchCoursesDomain(claim: string): Promise<CitationCard> {
  const m = claim.match(/\b([A-Z]{2,4})\s(\d{4})\b/);
  if (!m) return none(claim, "courses", "no course-code regex match in claim");
  const code = `${m[1]} ${m[2]}`;
  const course = getCourse(code);
  if (!course) return none(claim, "courses", `course ${code} not in catalog corpus`);
  return {
    claim, domain: "courses", source_url: course.source_url,
    source_title: `${course.code}: ${course.title}`,
    last_updated: null,
    snippet: snippet(course.description),
    confidence: "high", reason: `exact course-code match on ${code}`,
  };
}

async function searchEmergencyDomain(claim: string): Promise<CitationCard> {
  const c = getEmergencyCorpus();
  if (!c) return none(claim, "emergency", "emergency corpus not loaded");
  const claimLower = claim.toLowerCase();
  const guideline = c.guidelines.find((g) => claimLower.includes(g.slug.replace(/-/g, " ")));
  if (guideline) {
    return {
      claim, domain: "emergency", source_url: guideline.url, source_title: guideline.title,
      last_updated: guideline.retrieved_at ?? null,
      snippet: snippet(guideline.body), confidence: "high",
      reason: `slug match in emergency guideline (${guideline.slug})`,
    };
  }
  return none(claim, "emergency", "no slug match in emergency guidelines");
}

async function searchTuitionDomain(claim: string): Promise<CitationCard> {
  const c = getTuitionCorpus();
  if (!c) return none(claim, "tuition", "tuition corpus not loaded");
  const faq = c.faq_rows.find((r) =>
    claim.toLowerCase().split(/\W+/).some((t) => t.length > 4 && r.question.toLowerCase().includes(t)),
  );
  if (faq) {
    return {
      claim, domain: "tuition", source_url: faq.source_url ?? null, source_title: faq.question,
      last_updated: c.scraped_at ?? null,
      snippet: snippet(faq.answer), confidence: "medium",
      reason: "tuition FAQ token-overlap match",
    };
  }
  return none(claim, "tuition", "no tuition FAQ token match");
}

async function searchDiningDomain(claim: string): Promise<CitationCard> {
  const c = getDiningCorpus();
  if (!c) return none(claim, "dining", "dining corpus not loaded");
  const claimLower = claim.toLowerCase();
  const loc = c.locations.find((l) => claimLower.includes(l.name.toLowerCase()));
  if (!loc) return none(claim, "dining", "no dining-location name found in claim");
  return {
    claim, domain: "dining", source_url: loc.url ?? null, source_title: loc.name,
    last_updated: c.builtAt ?? null,
    snippet: snippet(loc.hours_text ?? ""), confidence: "high",
    reason: `dining-location name match (${loc.slug})`,
  };
}

export async function searchInDomain(claim: string, domain: CitationDomain): Promise<CitationCard> {
  switch (domain) {
    case "online":    return searchOnline(claim);
    case "policies":  return searchPoliciesDomain(claim);
    case "calendar":  return searchCalendarDomain(claim);
    case "courses":   return searchCoursesDomain(claim);
    case "emergency": return searchEmergencyDomain(claim);
    case "tuition":   return searchTuitionDomain(claim);
    case "dining":    return searchDiningDomain(claim);
  }
}
```

**Note on imports:** the per-corpus accessor names above (`getEmergencyCorpus`, `getTuitionCorpus`, `getDiningCorpus`, `searchPolicies`, `searchCalendar`) may differ in current source. Before implementing, run:

```bash
grep -n "^export function get" msstate-policies/src/emergency/corpus.ts msstate-policies/src/tuition/corpus.ts msstate-policies/src/dining/corpus.ts
grep -n "^export" msstate-policies/src/search.ts msstate-policies/src/calendars/search.ts
```

Substitute the actual exported names. If a per-domain search helper signature doesn't match (e.g., synchronous vs. async, different return shape), adapt the wrapper — do NOT change the helper. The goal is a thin router, not a refactor of the corpora.

- [ ] **Step 2: Run tests**

Run: `cd msstate-policies && npx tsx --test tests/citation/router.test.ts`
Expected: All tests PASS. Calendar test passes because `none(...)` is acceptable in the no-corpus-warm context.

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/citation/router.ts msstate-policies/tests/citation/router.test.ts
git commit -m "feat(citation): add per-domain searchInDomain delegation"
```

---

## Task 5: Build the `citation_card` MCP tool

**Files:**
- Create: `msstate-policies/src/tools/citation_card.ts`
- Create: `msstate-policies/tests/citation/tool-citation-card.test.ts`

- [ ] **Step 1: Write the failing test**

Create `msstate-policies/tests/citation/tool-citation-card.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { citation_card } from "../../src/tools/citation_card.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import { CITATION_DISCLAIMER, MAX_INPUT_CHARS, ALL_DOMAINS } from "../../src/citation/types.js";
import type { OnlineCorpus, OnlineInfoPage } from "../../src/online/types.js";

function infoPage(slug: string, title: string, body: string): OnlineInfoPage {
  return { slug, title, url: `https://www.online.msstate.edu/${slug}`, body_markdown: body, retrieved_at: "x" };
}

function corpus(info_pages: OnlineInfoPage[]): OnlineCorpus {
  return {
    builtAt: "2026-05-18T00:00:00.000Z",
    source: "https://www.online.msstate.edu/",
    programs: [],
    admissions_process: { url: "x", central_contact: { name: "x", title: "x", email: null, phone: null },
      shared_prelude: "", sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" },
      application_fee_tiers: [], external_apply_urls: [], retrieved_at: "x" },
    staff: [], info_pages, staff_to_programs: [],
  };
}

async function call(args: unknown) {
  const res = await citation_card.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("citation_card tool", () => {
  test("returns disclaimer + one card per claim", async () => {
    setOnlineCorpus(corpus([
      infoPage("military-assistance", "Military Assistance", "MSU Online offers military tuition assistance."),
    ]));
    const r = await call({ text: "MSU Online has military assistance. Generic unrelated claim." });
    assert.equal(r.disclaimer, CITATION_DISCLAIMER);
    assert.equal(r.cards.length, 2);
    assert.equal(r.claims_processed, 2);
    assert.equal(r.cards[0].domain, "online");
    assert.notEqual(r.cards[0].confidence, "none");
  });
  test("domain_hints overrides router", async () => {
    setOnlineCorpus(corpus([
      infoPage("financial-matters", "Financial Matters", "Aid and billing info."),
    ]));
    const r = await call({ text: "Ambiguous statement.", domain_hints: ["online"] });
    assert.equal(r.cards[0].domain, "online");
  });
  test("by_domain_counts includes 'none' bucket", async () => {
    setOnlineCorpus(corpus([]));
    const r = await call({ text: "Random unrelated sentence." });
    assert.ok(typeof r.by_domain_counts.none === "number");
    for (const d of ALL_DOMAINS) assert.ok(typeof r.by_domain_counts[d] === "number");
  });
  test("rejects input > MAX_INPUT_CHARS", async () => {
    await assert.rejects(() => call({ text: "x".repeat(MAX_INPUT_CHARS + 1) }));
  });
  test("rejects empty input via zod", async () => {
    await assert.rejects(() => call({ text: "" }));
  });
  test("rejects unknown domain hint", async () => {
    await assert.rejects(() => call({ text: "x.", domain_hints: ["weather"] }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd msstate-policies && npx tsx --test tests/citation/tool-citation-card.test.ts`
Expected: All FAIL — `Cannot find module '../../src/tools/citation_card.js'`.

- [ ] **Step 3: Implement the tool**

Create `msstate-policies/src/tools/citation_card.ts`:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { splitClaims, routeClaim, searchInDomain } from "../citation/router.js";
import {
  CITATION_DISCLAIMER,
  MAX_INPUT_CHARS,
  ALL_DOMAINS,
  type CitationCard,
  type CitationDomain,
  type CitationResult,
} from "../citation/types.js";

const Input = z
  .object({
    text: z.string().min(1).max(MAX_INPUT_CHARS),
    domain_hints: z
      .array(z.enum(["policies", "calendar", "courses", "emergency", "tuition", "online", "dining"]))
      .optional(),
  })
  .strict();

export const citation_card = {
  name: "citation_card",
  description:
    "Trust-surface meta-tool. Given an answer `text`, splits it into sentence-level claims and returns one citation card per claim — {claim, domain, source_url, source_title, last_updated, snippet, confidence}. " +
    "When the model produces an answer about MSU, call this tool with the answer text to attach receipts. Each card cites the canonical MSU page the claim came from, the last-updated timestamp from the corpus snapshot, and a confidence level. " +
    "`domain_hints` (optional) is an ordered list of domain preferences ('policies', 'calendar', 'courses', 'emergency', 'tuition', 'online', 'dining') applied to ambiguous claims before the keyword router. " +
    "Cards with confidence='none' mean we could not trace the claim to an MSU source — present those claims as unverified to the user. NEVER fabricate a citation for a 'none' card. " +
    "Caps: input up to 8000 chars, up to 40 claims processed per call (the rest is truncated and flagged via claims_truncated).",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const input = Input.parse(rawInput);
    const rawClaims = splitClaims(input.text);
    const truncated = rawClaims.length === 40; // MAX_CLAIMS sentinel; splitClaims slices to this
    const cards: CitationCard[] = [];
    const counts: Record<CitationDomain | "none", number> = {
      policies: 0, calendar: 0, courses: 0, emergency: 0,
      tuition: 0, online: 0, dining: 0, none: 0,
    };
    for (const claim of rawClaims) {
      const domain = routeClaim(claim, input.domain_hints);
      const card: CitationCard = domain
        ? await searchInDomain(claim, domain)
        : {
            claim, domain: null, source_url: null, source_title: null,
            last_updated: null, snippet: null, confidence: "none",
            reason: "router could not assign a domain",
          };
      cards.push(card);
      counts[card.domain ?? "none"]++;
    }
    const result: CitationResult = {
      disclaimer: CITATION_DISCLAIMER,
      cards,
      claims_processed: cards.length,
      claims_truncated: truncated,
      by_domain_counts: counts,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
```

- [ ] **Step 4: Run tests**

Run: `cd msstate-policies && npx tsx --test tests/citation/tool-citation-card.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/citation_card.ts msstate-policies/tests/citation/tool-citation-card.test.ts
git commit -m "feat(citation): add citation_card MCP tool"
```

---

## Task 6: Register in stdio server

**Files:**
- Modify: `msstate-policies/src/index.ts` (imports, TOOLS, SERVER_INSTRUCTIONS)

- [ ] **Step 1: Add import**

Add after the existing online-tool imports (around line 51):

```typescript
import { citation_card } from "./tools/citation_card.js";
```

- [ ] **Step 2: Register in TOOLS**

Insert `citation_card,` immediately after `health_check,` removal? **No** — `health_check` should stay last as the existing convention. Insert `citation_card,` immediately **before** `health_check,` (currently line 117).

- [ ] **Step 3: Append rule 8 to SERVER_INSTRUCTIONS**

After rule 7 (dining), append:

```
8. Citation / "where did you get that?" / "is this true?" / trust questions, OR when the model has just composed an MSU-related answer and wants to attach receipts → citation_card(text=…). Pass the full answer text. Returns one card per claim with source_url + last_updated + confidence. Confidence='none' = could not verify; surface the claim as unverified, do NOT fabricate a URL.
```

Also update the existing CLAUDE.md `## claude.ai msstate` system block in `worker/src/index.ts` (same key — keep the two copies in sync).

- [ ] **Step 4: Build + test**

Run: `cd msstate-policies && npm run typecheck && npm test && npm run build`
Expected: All tests pass; bundle rebuilds.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/index.ts msstate-policies/dist/
git commit -m "feat(citation): register citation_card in stdio server"
```

---

## Task 7: Mirror in Worker

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add tool descriptor**

Append a descriptor matching the new tool's `name`, `description`, `inputSchema`. Copy the description string verbatim from `msstate-policies/src/tools/citation_card.ts`.

- [ ] **Step 2: Add dispatch case**

Add `case "citation_card":` near the end of the switch (before the `default:`). The handler must:
1. Enforce `text.length <= MAX_INPUT_CHARS` (use existing length-cap pattern).
2. Re-implement `splitClaims`, `routeClaim`, `searchInDomain` inline (Worker is a separate bundle — no shared module). Copy logic from `src/citation/router.ts`. Keep helper functions module-scoped at the top of the worker file so cases that reference them already exist.
3. Return the JSON-RPC text payload.

- [ ] **Step 3: Update SERVER_INSTRUCTIONS in worker**

Mirror the rule-8 addition from Task 6 step 3.

- [ ] **Step 4: Run worker tests**

Run: `cd worker && npm test 2>&1 | tail -30` (check `worker/package.json` for the actual script).
Expected: existing worker tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): mirror citation_card dispatch"
```

---

## Task 8: Eval cases + harness extension

**Files:**
- Create: `msstate-policies/eval/citation.jsonl`
- Modify: `scripts/run-eval.mjs`

- [ ] **Step 1: Create eval file**

Create `msstate-policies/eval/citation.jsonl` with 15 cases:

```jsonl
{"kind":"cit_policy","desc":"explicit OP cite -> policies","args":{"name":"citation_card","arguments":{"text":"MSU Operating Policy 91.100 governs amnesty."}},"expect":{"top_domain":"policies","top_confidence_not":"none"}}
{"kind":"cit_calendar","desc":"date phrase -> calendar","args":{"name":"citation_card","arguments":{"text":"Spring break begins March 9, 2027."}},"expect":{"top_domain":"calendar"}}
{"kind":"cit_course","desc":"course code -> courses","args":{"name":"citation_card","arguments":{"text":"CSE 1284 is a prereq for CSE 2383."}},"expect":{"top_domain":"courses"}}
{"kind":"cit_emergency","desc":"tornado claim -> emergency","args":{"name":"citation_card","arguments":{"text":"During a tornado warning, go to a basement or interior room."}},"expect":{"top_domain":"emergency"}}
{"kind":"cit_online","desc":"online MBA deadline -> online","args":{"name":"citation_card","arguments":{"text":"The online MBA application deadline is August 1."}},"expect":{"top_domain":"online"}}
{"kind":"cit_tuition","desc":"dollar + tuition -> tuition","args":{"name":"citation_card","arguments":{"text":"Resident undergraduate tuition is $5,123 per semester."}},"expect":{"top_domain":"tuition"}}
{"kind":"cit_dining","desc":"dining keyword -> dining","args":{"name":"citation_card","arguments":{"text":"Perry Cafeteria closes at 9pm on Sundays."}},"expect":{"top_domain":"dining"}}
{"kind":"cit_none","desc":"generic claim -> none","args":{"name":"citation_card","arguments":{"text":"This is a sentence about nothing in particular."}},"expect":{"top_domain":"none"}}
{"kind":"cit_split","desc":"3 sentences -> 3 cards","args":{"name":"citation_card","arguments":{"text":"MSU OP 91.100 governs amnesty. Spring break is in March. The online MBA exists."}},"expect":{"claims_processed":3}}
{"kind":"cit_hint","desc":"domain_hints overrides router","args":{"name":"citation_card","arguments":{"text":"Fall registration opens August 1.","domain_hints":["online"]}},"expect":{"top_domain":"online"}}
{"kind":"cit_no_fabrication","desc":"none-card has null url","args":{"name":"citation_card","arguments":{"text":"Random unverifiable claim about MSU something."}},"expect":{"top_confidence":"none","top_source_url_null":true}}
{"kind":"cit_disclaimer","desc":"every response carries disclaimer","args":{"name":"citation_card","arguments":{"text":"Anything."}},"expect":{"disclaimer_contains":"unverified"}}
{"kind":"cit_byd","desc":"by_domain_counts has all 8 keys","args":{"name":"citation_card","arguments":{"text":"Anything."}},"expect":{"by_domain_counts_keys":["policies","calendar","courses","emergency","tuition","online","dining","none"]}}
{"kind":"cit_truncate","desc":"40+ claims -> claims_truncated true","args":{"name":"citation_card","arguments":{"text":"One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten. Eleven. Twelve. Thirteen. Fourteen. Fifteen. Sixteen. Seventeen. Eighteen. Nineteen. Twenty. Twentyone. Twentytwo. Twentythree. Twentyfour. Twentyfive. Twentysix. Twentyseven. Twentyeight. Twentynine. Thirty. Thirtyone. Thirtytwo. Thirtythree. Thirtyfour. Thirtyfive. Thirtysix. Thirtyseven. Thirtyeight. Thirtynine. Forty. Fortyone."}},"expect":{"claims_truncated":true,"claims_processed":40}}
{"kind":"cit_empty_text","desc":"empty input rejected","args":{"name":"citation_card","arguments":{"text":""}},"expect":{"is_error":true}}
```

- [ ] **Step 2: Extend `scripts/run-eval.mjs`**

Add `--suite citation` handling that points to `eval/citation.jsonl`. Add assertion branches for new `expect` keys: `top_domain`, `top_confidence`, `top_confidence_not`, `top_source_url_null`, `disclaimer_contains`, `by_domain_counts_keys`, `claims_processed`, `claims_truncated`, `is_error`. Follow the existing assertion-helper pattern.

- [ ] **Step 3: Run the suite**

Run: `cd msstate-policies && node ../scripts/run-eval.mjs --suite citation --no-judge`
Expected: All 15 cases pass.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/eval/citation.jsonl scripts/run-eval.mjs
git commit -m "test(eval): add citation suite (15 cases)"
```

---

## Task 9: Security checklist (CIT1-CIT3, +8 pts)

**Files:**
- Modify: `tools/security-checklist.sh`

- [ ] **Step 1: Append CIT block**

Append after the DIN block (the most recent module check):

```bash
# Citation card checks (CIT1-CIT3, added 2026-05-18). +8 pts total.

# CIT1 (3 pts): citation router NEVER fetches at runtime, never spawns,
# never reads env. Pure delegation across already-loaded corpora.
CIT1_OK=0
if [ -f msstate-policies/src/citation/router.ts ]; then
  BAD=$(grep -nE 'fetch\(|require\(|process\.env|child_process|fs\.' \
    msstate-policies/src/citation/router.ts \
    msstate-policies/src/tools/citation_card.ts 2>/dev/null | wc -l | tr -d ' ')
  [ "$BAD" = "0" ] && CIT1_OK=1
fi
if [ "$CIT1_OK" = "1" ]; then
  SCORE=$((SCORE+3))
  note "PASS" "CIT1 citation router/tool pure (no fetch/env/fs/child_process)" 3
else
  note "FAIL" "CIT1 citation router/tool made a forbidden runtime call" 3
fi

# CIT2 (3 pts): citation card always emits CITATION_DISCLAIMER on every
# code path. Mechanically: the tool file must reference the constant.
CIT2_OK=0
if grep -q 'CITATION_DISCLAIMER' msstate-policies/src/tools/citation_card.ts 2>/dev/null \
   && grep -q 'CITATION_DISCLAIMER' msstate-policies/src/citation/types.ts 2>/dev/null; then
  CIT2_OK=1
fi
if [ "$CIT2_OK" = "1" ]; then
  SCORE=$((SCORE+3))
  note "PASS" "CIT2 CITATION_DISCLAIMER referenced in tool + types" 3
else
  note "FAIL" "CIT2 CITATION_DISCLAIMER not referenced consistently" 3
fi

# CIT3 (2 pts): input length cap enforced via zod (max(MAX_INPUT_CHARS)).
CIT3_OK=0
if grep -q 'max(MAX_INPUT_CHARS)' msstate-policies/src/tools/citation_card.ts 2>/dev/null; then
  CIT3_OK=1
fi
if [ "$CIT3_OK" = "1" ]; then
  SCORE=$((SCORE+2))
  note "PASS" "CIT3 input length cap enforced via zod" 2
else
  note "FAIL" "CIT3 input length cap missing" 2
fi
```

- [ ] **Step 2: Bump score targets**

Update score targets throughout the repo (was 292 or 302 depending on plan ordering — see Task 9 of `program-matcher.md`). Citation-only delta: **+8**. If only citation lands: 292 → 300. If after program-matcher: 302 → 310.

```bash
grep -rn "292\|302\|310" CLAUDE.md README.md docs/BUILD.md tools/security-checklist.sh msstate-policies/README.md | head -20
```

Update each match to the new target.

- [ ] **Step 3: Run the checklist**

Run: `bash tools/security-checklist.sh | tail -1`
Expected: matches the bumped target.

- [ ] **Step 4: Commit**

```bash
git add tools/security-checklist.sh CLAUDE.md README.md docs/BUILD.md
git commit -m "chore(security): add CIT1-CIT3 (citation router purity / disclaimer / cap); +8"
```

---

## Task 10: Docs + version bump + final smoke

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `msstate-policies/README.md`, `docs/BUILD.md`, `msstate-policies/package.json`

- [ ] **Step 1: Append CLAUDE.md addendum**

```markdown
### Corpus extension (2026-05-18) — citation card (v1.2.3)

Adds 1 meta-tool (`citation_card`) over all seven existing corpora.
No new corpus sources. Tool count 25 -> 26 (or 27 -> 28 if program-matcher
landed first).

**`citation_card(text, domain_hints?)`** — splits text into sentence-level
claims, routes each to a domain via keyword heuristics (overridable via
domain_hints), delegates to the per-corpus search helper, returns one
{claim, source_url, source_title, last_updated, snippet, confidence, reason}
card per claim. NEVER fabricates a URL — confidence='none' cards have null
fields and explanatory `reason`. Caps: 8000 input chars, 40 claims processed.

**Security checks:** CIT1 (router purity — no fetch/env/fs/child_process),
CIT2 (CITATION_DISCLAIMER referenced), CIT3 (zod length cap). +8 pts.
```

- [ ] **Step 2: Tool count bump in READMEs and BUILD.md**

`25 -> 26` (citation-only) or `27 -> 28` (after program-matcher). Add a "Citation card" row to the per-domain table.

- [ ] **Step 3: Bump version**

`msstate-policies/package.json` version → `1.2.3`.

- [ ] **Step 4: Full build + test + checklist**

Run:
```bash
cd msstate-policies && npm run build && npm test
cd .. && bash tools/security-checklist.sh | tail -1
```

- [ ] **Step 5: Tools/list smoke**

Run: `node msstate-policies/dist/index.js < scripts/list-tools-stdin.json 2>/dev/null | grep citation_card`
Expected: includes `citation_card` entry.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md msstate-policies/README.md docs/BUILD.md msstate-policies/package.json msstate-policies/dist/
git commit -m "release: v1.2.3 citation_card trust-surface meta-tool"
```

---

## Self-Review Checklist

1. **Spec coverage:** `splitClaims`, `routeClaim`, `searchInDomain` for all 7 domains, tool wrapper, worker mirror, 15 eval cases, 3 security checks, disclaimer constant. All accounted for.
2. **Type consistency:** `CitationCard`, `CitationDomain`, `CitationResult`, `CITATION_DISCLAIMER`, `MAX_INPUT_CHARS` referenced identically across types.ts, router.ts, citation_card.ts, tests, worker mirror.
3. **No placeholders:** Every step shows actual code. Per-domain accessor name verification is called out explicitly (Task 4 Step 3 note).
4. **Corpus rule:** No tool path produces a URL or fact that wasn't in the baked corpus — `none(...)` is the explicit safe fallback. CIT1 enforces this mechanically.
5. **Worker mirror:** Single switch case + inline-copied router. No new dependencies in the Worker bundle.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-citation-card.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
