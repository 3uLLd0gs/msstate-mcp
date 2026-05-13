# Tuition Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 MCP tools (`get_msu_tuition_rate`, `get_msu_enrollment_fees`, `find_msu_tuition_faq`, `list_msu_tuition_campuses`) over a baked snapshot of 9 `*.msstate.edu` tuition pages, shipping as v0.8.0.

**Architecture:** New `msstate-policies/src/tuition/` module mirroring the v0.7.0 emergency module: frozen `TUITION_ROOTS` allowlist, build-time scraper, baked corpus loaded via esbuild `define` on stdio + via `corpus.tuition` on Worker. Mandatory `TUITION_DISCLAIMER` on every response. 12-pt security checklist extension (TUI1-TUI5).

**Tech Stack:** TypeScript / Node 18+ / esbuild / cheerio / zod / `@modelcontextprotocol/sdk` / Cloudflare Workers / `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-05-13-tuition-tools-design.md` (read this before starting).

**Read-before-touching invariants** (from `CLAUDE.md`):
1. **Corpus rule** — every value comes from `*.msstate.edu`. No training data, no third-party mirrors.
2. **stderr-only logging** — `stdout` is reserved for MCP JSON-RPC framing on stdio surface.
3. **Security score 245 must not regress** — TUI1-TUI5 add 12 pts; expected post-PR = 257.

---

## Stage 0 — Fixtures (run first; everything else needs them)

### Task 0.1: Save HTML fixtures from the 9 source URLs

**Files:**
- Create: `msstate-policies/tests/fixtures/tuition/landing.html`
- Create: `msstate-policies/tests/fixtures/tuition/faq.html`
- Create: `msstate-policies/tests/fixtures/tuition/other-enrollment-costs.html`
- Create: `msstate-policies/tests/fixtures/tuition/select-your-campus.html`
- Create: `msstate-policies/tests/fixtures/tuition/starkville.html`
- Create: `msstate-policies/tests/fixtures/tuition/meridian.html`
- Create: `msstate-policies/tests/fixtures/tuition/mgccc.html`
- Create: `msstate-policies/tests/fixtures/tuition/online.html`
- Create: `msstate-policies/tests/fixtures/tuition/vetmed.html`

- [ ] **Step 1: Create fixture directory and fetch all 9 pages**

Run from repo root:

```bash
mkdir -p msstate-policies/tests/fixtures/tuition

UA="msstate-policies-mcp/0.8.0 (fixture-capture)"

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition" \
  > msstate-policies/tests/fixtures/tuition/landing.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions" \
  > msstate-policies/tests/fixtures/tuition/faq.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs" \
  > msstate-policies/tests/fixtures/tuition/other-enrollment-costs.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/select-your-campus" \
  > msstate-policies/tests/fixtures/tuition/select-your-campus.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus" \
  > msstate-policies/tests/fixtures/tuition/starkville.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/meridian-campus" \
  > msstate-policies/tests/fixtures/tuition/meridian.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates" \
  > msstate-policies/tests/fixtures/tuition/mgccc.html

curl -sS -A "$UA" "https://www.controller.msstate.edu/accountservices/tuition/online-education-rates" \
  > msstate-policies/tests/fixtures/tuition/online.html

curl -sS -A "$UA" "https://www.vetmed.msstate.edu/tuition" \
  > msstate-policies/tests/fixtures/tuition/vetmed.html
```

- [ ] **Step 2: Verify each file is non-empty HTML (not a WAF page)**

Run:

```bash
for f in msstate-policies/tests/fixtures/tuition/*.html; do
  size=$(wc -c < "$f")
  has_waf=$(grep -c "Just a moment" "$f" || true)
  echo "$f size=$size waf=$has_waf"
done
```

Expected: every line shows `size > 5000` and `waf=0`. If any file is small or shows `waf=1`, retry with a small delay and a different User-Agent. Do NOT proceed until clean.

- [ ] **Step 3: Commit fixtures**

```bash
git add msstate-policies/tests/fixtures/tuition/
git commit -m "test(tuition): capture HTML fixtures for 9 source pages"
```

---

## Stage 1 — `types.ts` (foundation; everything imports from it)

### Task 1.1: Write `types.ts` test first

**Files:**
- Create: `msstate-policies/tests/tuition/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/types.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  TUITION_ROOTS,
  TUITION_DISCLAIMER,
  MAX_QUERY_CHARS,
  EXPECTED_CAMPUS_SLUGS,
  TuitionWafError,
} from "../../src/tuition/types.js";

describe("tuition/types", () => {
  test("TUITION_ROOTS is frozen and msstate.edu-only", () => {
    assert.ok(Object.isFrozen(TUITION_ROOTS));
    for (const u of TUITION_ROOTS) {
      assert.match(u, /^https:\/\/www\.(controller|vetmed)\.msstate\.edu\//);
    }
  });
  test("TUITION_ROOTS contains exactly 9 URLs", () => {
    assert.equal(TUITION_ROOTS.length, 9);
  });
  test("TUITION_ROOTS includes vetmed tuition URL", () => {
    assert.ok(TUITION_ROOTS.includes("https://www.vetmed.msstate.edu/tuition"));
  });
  test("EXPECTED_CAMPUS_SLUGS has exactly 5 entries", () => {
    assert.equal(EXPECTED_CAMPUS_SLUGS.length, 5);
    for (const s of ["starkville", "meridian", "mgccc", "online", "vetmed"]) {
      assert.ok(EXPECTED_CAMPUS_SLUGS.includes(s as never), `missing: ${s}`);
    }
  });
  test("TUITION_DISCLAIMER mentions controller.msstate.edu", () => {
    assert.match(TUITION_DISCLAIMER, /controller\.msstate\.edu/);
    assert.match(TUITION_DISCLAIMER, /subject to change/i);
  });
  test("MAX_QUERY_CHARS is 4096 (project-wide cap)", () => {
    assert.equal(MAX_QUERY_CHARS, 4096);
  });
  test("TuitionWafError carries the offending URL", () => {
    const e = new TuitionWafError("https://www.controller.msstate.edu/foo");
    assert.equal(e.name, "TuitionWafError");
    assert.match(e.message, /WAF/);
    assert.equal(e.url, "https://www.controller.msstate.edu/foo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/types.test.ts
```

Expected: `FAIL` — `Cannot find module '../../src/tuition/types.js'`.

### Task 1.2: Implement `types.ts`

**Files:**
- Create: `msstate-policies/src/tuition/types.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// msstate-policies/src/tuition/types.ts
/**
 * Tuition module — types, frozen allowlist, mandatory disclaimer.
 *
 * Corpus rule (CLAUDE.md): every value here comes from a live
 * *.msstate.edu page (controller or vetmed). No training-data fallback.
 */

export const TUITION_ROOTS: readonly string[] = Object.freeze([
  "https://www.controller.msstate.edu/accountservices/tuition",
  "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions",
  "https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs",
  "https://www.controller.msstate.edu/accountservices/tuition/select-your-campus",
  "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus",
  "https://www.controller.msstate.edu/accountservices/tuition/meridian-campus",
  "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates",
  "https://www.controller.msstate.edu/accountservices/tuition/online-education-rates",
  "https://www.vetmed.msstate.edu/tuition",
]);

export type CampusSlug = "starkville" | "meridian" | "mgccc" | "online" | "vetmed";
export type Level = "undergrad" | "grad" | "dvm";
export type Residency = "resident" | "non_resident";
export type Term = "fall_spring" | "winter" | "summer" | "annual";
export type RateBasis = "per_credit_hour" | "per_semester_flat" | "annual_flat";
export type CreditHourBucket = "1-11" | "12-16" | "1-8" | "9+";

export const EXPECTED_CAMPUS_SLUGS: readonly CampusSlug[] = Object.freeze([
  "starkville",
  "meridian",
  "mgccc",
  "online",
  "vetmed",
]);

export const TUITION_DISCLAIMER =
  "Tuition rates are subject to change without notice. Always verify the current rate at https://www.controller.msstate.edu/accountservices/tuition before paying.";

export const MAX_QUERY_CHARS = 4096;

export interface LineItem {
  label: string;
  amount_usd: number;
}

export interface TuitionRateRow {
  campus: CampusSlug;
  level: Level;
  residency: Residency;
  term: Term;
  rate_basis: RateBasis;
  credit_hour_bucket: CreditHourBucket | null;
  amount_usd: number;
  line_items: LineItem[];
  effective_term: string;
  source_url: string;
  retrieved_at: string;
}

export type FeeKind = "college" | "program" | "course_distance";

export interface FeeRow {
  kind: FeeKind;
  label: string;
  per_credit_usd: number | null;
  full_time_cap_usd: number | null;
  flat_amount_usd: number | null;
  applicability_note: string;
  source_url: string;
  retrieved_at: string;
}

export interface FaqRow {
  question: string;
  answer: string;
  source_url: string;
  retrieved_at: string;
}

export interface CampusEntry {
  slug: CampusSlug;
  display_name: string;
  levels_offered: Level[];
  rate_basis: "per_credit_hour" | "annual_flat";
  source_url: string;
}

export interface TuitionCorpus {
  builtAt: string;
  source: "https://www.controller.msstate.edu/accountservices/tuition";
  rate_rows: TuitionRateRow[];
  fee_rows: FeeRow[];
  faq_rows: FaqRow[];
  campuses: CampusEntry[];
}

export class TuitionWafError extends Error {
  constructor(public readonly url: string) {
    super(`WAF challenge detected at ${url}`);
    this.name = "TuitionWafError";
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd msstate-policies && npx tsx --test tests/tuition/types.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/tuition/types.ts msstate-policies/tests/tuition/types.test.ts
git commit -m "feat(tuition): types, frozen allowlist, TUITION_DISCLAIMER"
```

---

## Stage 2 — Parsers (5 sub-stages, one per page type)

### Task 2.1: FAQ parser test

**Files:**
- Create: `msstate-policies/tests/tuition/parser-faq.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/parser-faq.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFaqHtml } from "../../src/tuition/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, "..", "fixtures", "tuition", "faq.html"),
  "utf8",
);
const URL = "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions";

describe("parseFaqHtml", () => {
  test("extracts at least 10 Q&A pairs from the fixture", () => {
    const rows = parseFaqHtml(FIXTURE, URL);
    assert.ok(rows.length >= 10, `got ${rows.length}`);
  });
  test("each row has non-empty question and answer", () => {
    const rows = parseFaqHtml(FIXTURE, URL);
    for (const r of rows) {
      assert.ok(r.question.length > 0);
      assert.ok(r.answer.length > 0);
    }
  });
  test("each row's source_url starts with the page URL", () => {
    const rows = parseFaqHtml(FIXTURE, URL);
    for (const r of rows) {
      assert.ok(r.source_url.startsWith(URL));
    }
  });
  test("includes the campus question", () => {
    const rows = parseFaqHtml(FIXTURE, URL);
    const found = rows.find((r) => /campus/i.test(r.question));
    assert.ok(found, "expected a question mentioning 'campus'");
  });
  test("returns empty array on input with no FAQ structure", () => {
    const rows = parseFaqHtml("<html><body><p>nothing</p></body></html>", URL);
    assert.deepEqual(rows, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-faq.test.ts
```

Expected: FAIL — `parseFaqHtml is not a function` (parser.ts doesn't exist yet).

### Task 2.2: FAQ parser implementation

**Files:**
- Create: `msstate-policies/src/tuition/parser.ts` (initially with only `parseFaqHtml` exported)

- [ ] **Step 1: Inspect the FAQ fixture's actual structure**

```bash
grep -E "h2|h3|details|summary" msstate-policies/tests/fixtures/tuition/faq.html | head -40
```

Note the heading element FAQ questions use. The MSU controller site is Drupal; questions usually live in `<h2>`/`<h3>` followed by `<p>`/`<div>` answer blocks, or inside `<details>`/`<summary>` accordion elements. Adapt the selector to whatever the fixture shows.

- [ ] **Step 2: Write `parseFaqHtml`**

```typescript
// msstate-policies/src/tuition/parser.ts
import { load as cheerioLoad } from "cheerio";
import type { FaqRow } from "./types.js";

const RETRIEVED_AT_PLACEHOLDER = "1970-01-01T00:00:00.000Z";

/**
 * Parse the tuition FAQ page. Returns one FaqRow per Q&A pair.
 *
 * Heuristic: find each <h2>/<h3>/<summary> in `main`, treat its text as a
 * question, and concatenate sibling content up to the next heading/summary
 * as the answer. `retrieved_at` is left as a placeholder — the scraper
 * overwrites it.
 */
export function parseFaqHtml(html: string, pageUrl: string): FaqRow[] {
  const $ = cheerioLoad(html);
  const out: FaqRow[] = [];
  const seen = new Set<string>();

  const HEADING_SEL = "main h2, main h3, main details > summary";
  $(HEADING_SEL).each((_, el) => {
    const $el = $(el);
    const question = $el.text().replace(/\s+/g, " ").trim();
    if (question.length < 5 || !question.includes("?")) return;
    if (seen.has(question)) return;
    seen.add(question);

    // Collect answer: if heading is inside <details>, take the rest of
    // <details>'s contents. Otherwise, walk forward through siblings until
    // the next heading at the same or shallower level.
    let answerParts: string[] = [];
    if (el.tagName === "summary") {
      const $details = $el.parent("details");
      // Clone and drop the summary, then take remaining text.
      const clone = $details.clone();
      clone.find("summary").remove();
      answerParts.push(clone.text());
    } else {
      const headingLevel = el.tagName === "h2" ? 2 : 3;
      let $cur = $el.next();
      while ($cur.length > 0) {
        const tag = ($cur[0] as { tagName?: string }).tagName ?? "";
        if (/^h[1-3]$/.test(tag)) {
          const curLevel = Number(tag.slice(1));
          if (curLevel <= headingLevel) break;
        }
        answerParts.push($cur.text());
        $cur = $cur.next();
      }
    }
    const answer = answerParts.join("\n").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (answer.length < 5) return;

    // Build anchor link if heading has an id.
    const id = $el.attr("id") ?? $el.parent("details").attr("id");
    const source_url = id ? `${pageUrl}#${id}` : pageUrl;

    out.push({
      question,
      answer,
      source_url,
      retrieved_at: RETRIEVED_AT_PLACEHOLDER,
    });
  });

  return out;
}
```

- [ ] **Step 3: Run FAQ tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-faq.test.ts
```

Expected: PASS (5 tests). If "expected a question mentioning 'campus'" fails, inspect the fixture and adjust the `HEADING_SEL`; do not commit until all 5 pass.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/tuition/parser.ts msstate-policies/tests/tuition/parser-faq.test.ts
git commit -m "feat(tuition): FAQ parser with anchor links"
```

### Task 2.3: Other-enrollment-costs (fees) parser test

**Files:**
- Create: `msstate-policies/tests/tuition/parser-fees.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/parser-fees.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeesHtml } from "../../src/tuition/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, "..", "fixtures", "tuition", "other-enrollment-costs.html"),
  "utf8",
);
const URL = "https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs";

describe("parseFeesHtml", () => {
  test("returns at least one college fee row", () => {
    const rows = parseFeesHtml(FIXTURE, URL);
    const college = rows.filter((r) => r.kind === "college");
    assert.ok(college.length >= 1, `got ${college.length} college rows`);
  });
  test("returns at least one program fee row", () => {
    const rows = parseFeesHtml(FIXTURE, URL);
    const program = rows.filter((r) => r.kind === "program");
    assert.ok(program.length >= 1, `got ${program.length} program rows`);
  });
  test("Engineering college fee has positive per_credit_usd", () => {
    const rows = parseFeesHtml(FIXTURE, URL);
    const eng = rows.find((r) => r.kind === "college" && /engineering/i.test(r.label));
    assert.ok(eng, "no Engineering college fee row");
    assert.ok(eng.per_credit_usd !== null && eng.per_credit_usd > 0, `per_credit_usd=${eng.per_credit_usd}`);
  });
  test("Honors College fee has flat_amount_usd of $75", () => {
    const rows = parseFeesHtml(FIXTURE, URL);
    const honors = rows.find((r) => /honors/i.test(r.label));
    assert.ok(honors, "no Honors College row");
    assert.equal(honors.flat_amount_usd, 75);
  });
  test("each row has source_url == page URL", () => {
    const rows = parseFeesHtml(FIXTURE, URL);
    for (const r of rows) assert.equal(r.source_url, URL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-fees.test.ts
```

Expected: FAIL — `parseFeesHtml is not a function`.

### Task 2.4: Fees parser implementation

**Files:**
- Modify: `msstate-policies/src/tuition/parser.ts` (append `parseFeesHtml`)

- [ ] **Step 1: Inspect the fees fixture's table structure**

```bash
grep -nE "<h2|<h3|<table" msstate-policies/tests/fixtures/tuition/other-enrollment-costs.html | head -30
```

Note the three sections ("College Fees", "Program Fees", "Course & Distance Fees") and the table column headers. Adapt selectors accordingly.

- [ ] **Step 2: Append `parseFeesHtml` to `parser.ts`**

```typescript
// Append to msstate-policies/src/tuition/parser.ts

import type { FeeRow, FeeKind } from "./types.js";

const HEADING_TO_KIND: Array<[RegExp, FeeKind]> = [
  [/college fees?/i, "college"],
  [/program fees?/i, "program"],
  [/course.*(distance|fees?)/i, "course_distance"],
];

const MONEY_RE = /\$?\s*([\d,]+(?:\.\d{2})?)/;

function parseMoney(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = MONEY_RE.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseFeesHtml(html: string, pageUrl: string): FeeRow[] {
  const $ = cheerioLoad(html);
  const out: FeeRow[] = [];

  $("main h2, main h3").each((_, h) => {
    const heading = $(h).text().trim();
    const match = HEADING_TO_KIND.find(([re]) => re.test(heading));
    if (!match) return;
    const kind: FeeKind = match[1];

    // Walk forward to find the next <table>; if a sibling-paragraph note
    // exists between heading and table, capture it as applicability_note.
    let note = "";
    let $cur = $(h).next();
    while ($cur.length > 0 && $cur[0] && ($cur[0] as { tagName?: string }).tagName !== "table") {
      const tag = ($cur[0] as { tagName?: string }).tagName ?? "";
      if (/^h[1-3]$/.test(tag)) return; // next section without a table; bail
      if (tag === "p") {
        const t = $cur.text().trim();
        if (t.length > 0) note = note ? `${note} ${t}` : t;
      }
      $cur = $cur.next();
    }
    if ($cur.length === 0) return;

    // Parse rows. Column layout varies; detect by header text.
    const $table = $cur;
    const headerCells = $table.find("thead th, tr:first-child th, tr:first-child td").map((_, c) => $(c).text().trim().toLowerCase()).get();
    const perCreditIdx = headerCells.findIndex((c) => /per.{0,4}credit|per.{0,4}hour/.test(c));
    const capIdx = headerCells.findIndex((c) => /cap|full.{0,4}time|semester/.test(c));
    const flatIdx = headerCells.findIndex((c) => /flat|amount|fee$/.test(c) && !/per/.test(c));
    const labelIdx = 0; // first column is always the label

    $table.find("tr").each((i, tr) => {
      if (i === 0) return; // header
      const cells = $(tr).find("td, th").map((_, c) => $(c).text().trim()).get();
      if (cells.length < 2) return;
      const label = cells[labelIdx];
      if (!label) return;
      const per_credit_usd = perCreditIdx >= 0 ? parseMoney(cells[perCreditIdx]) : null;
      const full_time_cap_usd = capIdx >= 0 ? parseMoney(cells[capIdx]) : null;
      const flat_amount_usd = flatIdx >= 0 ? parseMoney(cells[flatIdx]) : null;
      // If all three are null but there's a single dollar amount somewhere, treat it as flat.
      let fallbackFlat: number | null = null;
      if (per_credit_usd === null && full_time_cap_usd === null && flat_amount_usd === null) {
        for (const c of cells.slice(1)) {
          const m = parseMoney(c);
          if (m !== null) { fallbackFlat = m; break; }
        }
      }
      out.push({
        kind,
        label,
        per_credit_usd,
        full_time_cap_usd,
        flat_amount_usd: flat_amount_usd ?? fallbackFlat,
        applicability_note: note,
        source_url: pageUrl,
        retrieved_at: RETRIEVED_AT_PLACEHOLDER,
      });
    });
  });

  return out;
}
```

- [ ] **Step 3: Run fees tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-fees.test.ts
```

Expected: PASS (5 tests). If "Honors College fee has flat_amount_usd of $75" fails, the fixture's column layout may differ — adjust `flatIdx` detection regex and re-run.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/tuition/parser.ts msstate-policies/tests/tuition/parser-fees.test.ts
git commit -m "feat(tuition): fees parser for College/Program/Course-Distance tables"
```

---

### Task 2.5: Controller campus rate-table parser test

**Files:**
- Create: `msstate-policies/tests/tuition/parser-controller-rate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/parser-controller-rate.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseControllerRateHtml } from "../../src/tuition/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_STK = readFileSync(
  join(here, "..", "fixtures", "tuition", "starkville.html"), "utf8",
);
const URL_STK = "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus";
const FIXTURE_MGCCC = readFileSync(
  join(here, "..", "fixtures", "tuition", "mgccc.html"), "utf8",
);
const URL_MGCCC = "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates";

describe("parseControllerRateHtml — starkville (both levels)", () => {
  test("returns rows for both undergrad and grad", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    assert.ok(rows.some((r) => r.level === "undergrad"));
    assert.ok(rows.some((r) => r.level === "grad"));
  });
  test("every row has rate_basis=per_credit_hour", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    for (const r of rows) assert.equal(r.rate_basis, "per_credit_hour");
  });
  test("returns both residency variants for fall_spring undergrad 12-16", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    const r12 = rows.filter(
      (r) => r.level === "undergrad" && r.term === "fall_spring" && r.credit_hour_bucket === "12-16",
    );
    assert.ok(r12.some((r) => r.residency === "resident"));
    assert.ok(r12.some((r) => r.residency === "non_resident"));
  });
  test("every row has positive amount_usd and at least one line_item", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    for (const r of rows) {
      assert.ok(r.amount_usd > 0, `non-positive amount for ${JSON.stringify(r)}`);
      assert.ok(r.line_items.length > 0);
    }
  });
  test("effective_term is non-empty for every row", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    for (const r of rows) assert.ok(r.effective_term.length > 0);
  });
});

describe("parseControllerRateHtml — mgccc (undergrad-only)", () => {
  test("returns no grad rows for MGCCC", () => {
    const rows = parseControllerRateHtml(FIXTURE_MGCCC, "mgccc", URL_MGCCC);
    assert.equal(rows.filter((r) => r.level === "grad").length, 0);
  });
  test("returns undergrad rows for MGCCC", () => {
    const rows = parseControllerRateHtml(FIXTURE_MGCCC, "mgccc", URL_MGCCC);
    assert.ok(rows.filter((r) => r.level === "undergrad").length >= 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-controller-rate.test.ts
```

Expected: FAIL — `parseControllerRateHtml is not a function`.

### Task 2.6: Controller-rate parser implementation

**Files:**
- Modify: `msstate-policies/src/tuition/parser.ts` (append `parseControllerRateHtml`)

- [ ] **Step 1: Inspect the Starkville fixture's table layout**

```bash
grep -nE "<h2|<h3|<table|<caption" msstate-policies/tests/fixtures/tuition/starkville.html | head -40
```

Note: tables typically have a `<caption>` like "Fall 2026 or Spring 2027 (12-16 Credit Hours)" and a "Resident / Non-Resident" header row. The implementation below maps caption text to `(term, credit_hour_bucket)`.

- [ ] **Step 2: Append `parseControllerRateHtml` to `parser.ts`**

```typescript
// Append to msstate-policies/src/tuition/parser.ts

import type {
  TuitionRateRow,
  CampusSlug,
  Level,
  Term,
  CreditHourBucket,
  Residency,
  LineItem,
} from "./types.js";

interface CaptionInfo {
  level: Level | null;
  term: Term | null;
  bucket: CreditHourBucket | null;
  effective_term: string;
}

function classifyCaption(caption: string, currentLevel: Level): CaptionInfo {
  const c = caption.replace(/\s+/g, " ").trim();
  const lc = c.toLowerCase();
  let term: Term | null = null;
  if (/fall.*spring|spring.*fall|fall .*\d+.*spring/i.test(c)) term = "fall_spring";
  else if (/winter/i.test(lc)) term = "winter";
  else if (/summer/i.test(lc)) term = "summer";

  let bucket: CreditHourBucket | null = null;
  if (/1\s*-\s*11\b/.test(lc)) bucket = "1-11";
  else if (/12\s*-\s*16\b/.test(lc) || /12\+|12 or more/.test(lc)) bucket = "12-16";
  else if (/1\s*-\s*8\b/.test(lc)) bucket = "1-8";
  else if (/9\s*\+|9 or more/.test(lc)) bucket = "9+";

  return { level: currentLevel, term, bucket, effective_term: c };
}

export function parseControllerRateHtml(
  html: string,
  campus: CampusSlug,
  pageUrl: string,
): TuitionRateRow[] {
  const $ = cheerioLoad(html);
  const out: TuitionRateRow[] = [];

  // Determine each table's level by walking up to the nearest preceding
  // "Undergraduate Rates" / "Graduate Rates" heading.
  let currentLevel: Level = "undergrad";
  $("main h2, main h3, main table").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName;
    if (tag === "h2" || tag === "h3") {
      const t = $(el).text().toLowerCase();
      if (/graduate/.test(t)) currentLevel = "grad";
      else if (/undergrad/.test(t)) currentLevel = "undergrad";
      return;
    }
    // tag === "table"
    const $table = $(el);
    const captionText = $table.find("caption").text() || $table.prev("h3,h4,p").text() || "";
    const info = classifyCaption(captionText, currentLevel);
    if (!info.term) return; // not a rate table

    // Header row determines which columns are Resident vs Non-Resident.
    const headerCells = $table
      .find("tr").first().find("th, td")
      .map((_, c) => $(c).text().trim().toLowerCase()).get();
    const residentIdx = headerCells.findIndex((c) => /^resident/.test(c));
    const nonResidentIdx = headerCells.findIndex((c) => /non.?resident/.test(c));
    if (residentIdx < 0 || nonResidentIdx < 0) return;

    const residentLineItems: LineItem[] = [];
    const nonResidentLineItems: LineItem[] = [];
    let residentTotal: number | null = null;
    let nonResidentTotal: number | null = null;

    $table.find("tr").each((i, tr) => {
      if (i === 0) return;
      const cells = $(tr).find("td, th").map((_, c) => $(c).text().trim()).get();
      if (cells.length === 0) return;
      const label = cells[0];
      if (!label) return;
      const resAmt = parseMoney(cells[residentIdx]);
      const nonResAmt = parseMoney(cells[nonResidentIdx]);
      const isTotal = /total/i.test(label);
      if (isTotal) {
        residentTotal = resAmt;
        nonResidentTotal = nonResAmt;
        return;
      }
      if (resAmt !== null) residentLineItems.push({ label, amount_usd: resAmt });
      if (nonResAmt !== null) nonResidentLineItems.push({ label, amount_usd: nonResAmt });
    });

    // If no explicit Total row, sum the line items.
    if (residentTotal === null && residentLineItems.length > 0) {
      residentTotal = residentLineItems.reduce((s, l) => s + l.amount_usd, 0);
    }
    if (nonResidentTotal === null && nonResidentLineItems.length > 0) {
      nonResidentTotal = nonResidentLineItems.reduce((s, l) => s + l.amount_usd, 0);
    }

    const push = (residency: Residency, total: number, items: LineItem[]) => {
      out.push({
        campus,
        level: info.level!,
        residency,
        term: info.term!,
        rate_basis: "per_credit_hour",
        credit_hour_bucket: info.bucket,
        amount_usd: total,
        line_items: items,
        effective_term: info.effective_term,
        source_url: pageUrl,
        retrieved_at: RETRIEVED_AT_PLACEHOLDER,
      });
    };
    if (residentTotal !== null && residentTotal > 0) push("resident", residentTotal, residentLineItems);
    if (nonResidentTotal !== null && nonResidentTotal > 0) push("non_resident", nonResidentTotal, nonResidentLineItems);
  });

  return out;
}
```

- [ ] **Step 3: Run controller-rate tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-controller-rate.test.ts
```

Expected: PASS (7 tests). If any assertion fails, inspect the fixture and refine `classifyCaption` regexes or header detection. Do NOT proceed until all pass.

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/tuition/parser.ts msstate-policies/tests/tuition/parser-controller-rate.test.ts
git commit -m "feat(tuition): controller-campus rate parser (4 campuses, all terms)"
```

### Task 2.7: Vetmed rate parser test

**Files:**
- Create: `msstate-policies/tests/tuition/parser-vetmed-rate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/parser-vetmed-rate.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVetmedRateHtml } from "../../src/tuition/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, "..", "fixtures", "tuition", "vetmed.html"), "utf8",
);
const URL = "https://www.vetmed.msstate.edu/tuition";

describe("parseVetmedRateHtml", () => {
  test("returns at least two rate rows (resident + non-resident)", () => {
    const rows = parseVetmedRateHtml(FIXTURE, URL);
    assert.ok(rows.length >= 2);
  });
  test("every row has level=dvm and campus=vetmed", () => {
    const rows = parseVetmedRateHtml(FIXTURE, URL);
    for (const r of rows) {
      assert.equal(r.level, "dvm");
      assert.equal(r.campus, "vetmed");
    }
  });
  test("rate_basis is annual_flat or per_semester_flat", () => {
    const rows = parseVetmedRateHtml(FIXTURE, URL);
    for (const r of rows) {
      assert.ok(r.rate_basis === "annual_flat" || r.rate_basis === "per_semester_flat");
    }
  });
  test("credit_hour_bucket is null for every vetmed row", () => {
    const rows = parseVetmedRateHtml(FIXTURE, URL);
    for (const r of rows) assert.equal(r.credit_hour_bucket, null);
  });
  test("has both resident and non_resident rows", () => {
    const rows = parseVetmedRateHtml(FIXTURE, URL);
    assert.ok(rows.some((r) => r.residency === "resident"));
    assert.ok(rows.some((r) => r.residency === "non_resident"));
  });
  test("effective_term mentions Fall 2025", () => {
    const rows = parseVetmedRateHtml(FIXTURE, URL);
    assert.ok(rows.every((r) => /fall.*2025/i.test(r.effective_term)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-vetmed-rate.test.ts
```

Expected: FAIL — `parseVetmedRateHtml is not a function`.

### Task 2.8: Vetmed rate parser implementation

**Files:**
- Modify: `msstate-policies/src/tuition/parser.ts` (append `parseVetmedRateHtml`)

- [ ] **Step 1: Inspect the vetmed fixture**

```bash
grep -nE "<h2|<h3|<table|<caption|Semester Rate|Annual Rate|Resident|Effective" msstate-policies/tests/fixtures/tuition/vetmed.html | head -30
```

Vetmed has two separate tables ("Mississippi Resident Costs" and "Non-Resident Costs"), each with columns `[item] | Semester Rate | Annual Rate`. The "effective" line ("Effective Fall 2025 Semester through Summer 2026") sits as a `<p>` outside the tables.

- [ ] **Step 2: Append `parseVetmedRateHtml` to `parser.ts`**

```typescript
// Append to msstate-policies/src/tuition/parser.ts

function findEffectiveLine($: ReturnType<typeof cheerioLoad>): string {
  let found = "";
  $("main p, main h3, main h4").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (/^effective\b/i.test(t)) { found = t; return false; }
    return undefined;
  });
  return found || "Effective term not stated on source page";
}

export function parseVetmedRateHtml(html: string, pageUrl: string): TuitionRateRow[] {
  const $ = cheerioLoad(html);
  const out: TuitionRateRow[] = [];
  const effective_term = findEffectiveLine($);

  $("main table").each((_, table) => {
    const $table = $(table);
    const caption = ($table.find("caption").text() || $table.prev("h3,h4,p").text() || "").trim();
    const lc = caption.toLowerCase();
    let residency: Residency | null = null;
    if (/non.?resident/i.test(lc)) residency = "non_resident";
    else if (/resident/i.test(lc)) residency = "resident";
    if (!residency) return;

    const headerCells = $table.find("tr").first().find("th,td")
      .map((_, c) => $(c).text().trim().toLowerCase()).get();
    const semIdx = headerCells.findIndex((c) => /semester/.test(c) && !/per/.test(c));
    const annIdx = headerCells.findIndex((c) => /annual/.test(c));

    const semItems: LineItem[] = [];
    const annItems: LineItem[] = [];
    let semTotal: number | null = null;
    let annTotal: number | null = null;

    $table.find("tr").each((i, tr) => {
      if (i === 0) return;
      const cells = $(tr).find("td,th").map((_, c) => $(c).text().trim()).get();
      const label = cells[0];
      if (!label) return;
      const sem = semIdx >= 0 ? parseMoney(cells[semIdx]) : null;
      const ann = annIdx >= 0 ? parseMoney(cells[annIdx]) : null;
      if (/total/i.test(label)) { semTotal = sem; annTotal = ann; return; }
      if (sem !== null) semItems.push({ label, amount_usd: sem });
      if (ann !== null) annItems.push({ label, amount_usd: ann });
    });
    if (semTotal === null) semTotal = semItems.reduce((s, l) => s + l.amount_usd, 0) || null;
    if (annTotal === null) annTotal = annItems.reduce((s, l) => s + l.amount_usd, 0) || null;

    if (semTotal && semTotal > 0) {
      out.push({
        campus: "vetmed", level: "dvm", residency, term: "fall_spring",
        rate_basis: "per_semester_flat", credit_hour_bucket: null,
        amount_usd: semTotal, line_items: semItems,
        effective_term, source_url: pageUrl, retrieved_at: RETRIEVED_AT_PLACEHOLDER,
      });
    }
    if (annTotal && annTotal > 0) {
      out.push({
        campus: "vetmed", level: "dvm", residency, term: "annual",
        rate_basis: "annual_flat", credit_hour_bucket: null,
        amount_usd: annTotal, line_items: annItems,
        effective_term, source_url: pageUrl, retrieved_at: RETRIEVED_AT_PLACEHOLDER,
      });
    }
  });

  return out;
}
```

- [ ] **Step 3: Run vetmed-rate tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-vetmed-rate.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/tuition/parser.ts msstate-policies/tests/tuition/parser-vetmed-rate.test.ts
git commit -m "feat(tuition): vetmed flat-rate parser (DVM resident + non-resident)"
```

### Task 2.9: Campuses-list parser test

**Files:**
- Create: `msstate-policies/tests/tuition/parser-campuses.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/parser-campuses.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildCampusList } from "../../src/tuition/parser.js";
import type { TuitionRateRow } from "../../src/tuition/types.js";

function rate(campus: TuitionRateRow["campus"], level: TuitionRateRow["level"]): TuitionRateRow {
  return {
    campus, level, residency: "resident", term: "fall_spring",
    rate_basis: "per_credit_hour", credit_hour_bucket: "1-11",
    amount_usd: 1, line_items: [], effective_term: "x",
    source_url: "https://www.controller.msstate.edu/accountservices/tuition",
    retrieved_at: "1970-01-01T00:00:00.000Z",
  };
}

describe("buildCampusList", () => {
  test("returns 5 entries when all campuses have at least one row", () => {
    const list = buildCampusList([
      rate("starkville", "undergrad"), rate("starkville", "grad"),
      rate("meridian", "undergrad"),   rate("meridian", "grad"),
      rate("mgccc", "undergrad"),
      rate("online", "undergrad"),     rate("online", "grad"),
      { ...rate("vetmed", "dvm"), rate_basis: "annual_flat", credit_hour_bucket: null },
    ]);
    assert.equal(list.length, 5);
  });
  test("MGCCC entry has levels_offered=['undergrad'] only", () => {
    const list = buildCampusList([rate("mgccc", "undergrad")]);
    const mgccc = list.find((c) => c.slug === "mgccc");
    assert.ok(mgccc);
    assert.deepEqual(mgccc.levels_offered, ["undergrad"]);
  });
  test("vetmed entry has rate_basis=annual_flat", () => {
    const list = buildCampusList([
      { ...rate("vetmed", "dvm"), rate_basis: "annual_flat", credit_hour_bucket: null },
    ]);
    const vet = list.find((c) => c.slug === "vetmed");
    assert.ok(vet);
    assert.equal(vet.rate_basis, "annual_flat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-campuses.test.ts
```

Expected: FAIL — `buildCampusList is not a function`.

### Task 2.10: Campuses-list builder implementation

**Files:**
- Modify: `msstate-policies/src/tuition/parser.ts` (append `buildCampusList`)

- [ ] **Step 1: Append `buildCampusList`**

```typescript
// Append to msstate-policies/src/tuition/parser.ts

import type { CampusEntry, Level } from "./types.js";

const DISPLAY_NAMES: Record<CampusSlug, string> = {
  starkville: "Starkville Campus",
  meridian: "Meridian Campus",
  mgccc: "MGCCC — Engineering on the Coast",
  online: "MSU Online Education",
  vetmed: "College of Veterinary Medicine (DVM)",
};

const SOURCE_URLS: Record<CampusSlug, string> = {
  starkville: "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus",
  meridian:   "https://www.controller.msstate.edu/accountservices/tuition/meridian-campus",
  mgccc:      "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates",
  online:     "https://www.controller.msstate.edu/accountservices/tuition/online-education-rates",
  vetmed:     "https://www.vetmed.msstate.edu/tuition",
};

export function buildCampusList(rateRows: TuitionRateRow[]): CampusEntry[] {
  const byCampus = new Map<CampusSlug, { levels: Set<Level>; basis: "per_credit_hour" | "annual_flat" }>();
  for (const r of rateRows) {
    const entry = byCampus.get(r.campus) ?? {
      levels: new Set(),
      basis: r.campus === "vetmed" ? "annual_flat" : "per_credit_hour",
    };
    entry.levels.add(r.level);
    byCampus.set(r.campus, entry);
  }
  const out: CampusEntry[] = [];
  for (const slug of ["starkville", "meridian", "mgccc", "online", "vetmed"] as CampusSlug[]) {
    const e = byCampus.get(slug);
    if (!e) continue;
    out.push({
      slug,
      display_name: DISPLAY_NAMES[slug],
      levels_offered: Array.from(e.levels),
      rate_basis: e.basis,
      source_url: SOURCE_URLS[slug],
    });
  }
  return out;
}
```

- [ ] **Step 2: Run campuses-list tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/parser-campuses.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 3: Run ALL tuition parser tests together**

```bash
cd msstate-policies && npx tsx --test "tests/tuition/parser-*.test.ts"
```

Expected: all parser tests still PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add msstate-policies/src/tuition/parser.ts msstate-policies/tests/tuition/parser-campuses.test.ts
git commit -m "feat(tuition): build campus list from rate rows"
```

---

## Stage 3 — Scraper

### Task 3.1: Scraper test (mocked fetcher)

**Files:**
- Create: `msstate-policies/tests/tuition/scraper.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/scraper.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeAllTuition, isAllowedTuitionUrl, detectTuitionWaf } from "../../src/tuition/scraper.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "..", "fixtures", "tuition", name), "utf8");
}

const STUB: Record<string, string> = {
  "https://www.controller.msstate.edu/accountservices/tuition": fixture("landing.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions": fixture("faq.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs": fixture("other-enrollment-costs.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/select-your-campus": fixture("select-your-campus.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus": fixture("starkville.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/meridian-campus": fixture("meridian.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates": fixture("mgccc.html"),
  "https://www.controller.msstate.edu/accountservices/tuition/online-education-rates": fixture("online.html"),
  "https://www.vetmed.msstate.edu/tuition": fixture("vetmed.html"),
};

async function stubFetch(url: string): Promise<string> {
  if (!(url in STUB)) throw new Error(`unexpected url: ${url}`);
  return STUB[url];
}

describe("scraper.isAllowedTuitionUrl", () => {
  test("accepts every URL in TUITION_ROOTS", () => {
    for (const u of Object.keys(STUB)) assert.ok(isAllowedTuitionUrl(u), u);
  });
  test("rejects non-msstate hosts", () => {
    assert.equal(isAllowedTuitionUrl("https://example.com/foo"), false);
  });
  test("rejects http", () => {
    assert.equal(isAllowedTuitionUrl("http://www.controller.msstate.edu/accountservices/tuition"), false);
  });
});

describe("scraper.detectTuitionWaf", () => {
  test("flags Cloudflare challenge body", () => {
    assert.equal(detectTuitionWaf("<html>Just a moment...</html>"), true);
  });
  test("clean HTML returns false", () => {
    assert.equal(detectTuitionWaf("<html><body><h1>Tuition</h1></body></html>"), false);
  });
});

describe("scraper.scrapeAllTuition", () => {
  test("produces rate_rows, fee_rows, faq_rows, and 5 campuses", async () => {
    const r = await scrapeAllTuition({ fetchUrl: stubFetch });
    assert.ok(r.rate_rows.length >= 40, `got ${r.rate_rows.length} rate rows`);
    assert.ok(r.fee_rows.length >= 5, `got ${r.fee_rows.length} fee rows`);
    assert.ok(r.faq_rows.length >= 10, `got ${r.faq_rows.length} faq rows`);
    assert.equal(r.campuses.length, 5);
    assert.equal(r.anyError, false);
  });
  test("retrieved_at is set on every row", async () => {
    const r = await scrapeAllTuition({ fetchUrl: stubFetch });
    for (const row of [...r.rate_rows, ...r.fee_rows, ...r.faq_rows]) {
      assert.match(row.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
    }
  });
  test("flags anyError=true on per-source failure", async () => {
    const broken: typeof stubFetch = async (url) => {
      if (url.endsWith("/meridian-campus")) throw new Error("HTTP 500");
      return stubFetch(url);
    };
    const r = await scrapeAllTuition({ fetchUrl: broken });
    assert.equal(r.anyError, true);
    assert.match(r.per_source["meridian-campus"]?.error ?? "", /500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/scraper.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tuition/scraper.js'`.

### Task 3.2: Scraper implementation

**Files:**
- Create: `msstate-policies/src/tuition/scraper.ts`

- [ ] **Step 1: Write `scraper.ts`**

```typescript
// msstate-policies/src/tuition/scraper.ts
/**
 * Tuition scraper. Build-time only — never invoked at MCP request time.
 *
 * Pattern matches src/emergency/scraper.ts: URL allowlist + WAF detector +
 * retry-with-backoff + concurrency-capped pool.
 */
import {
  TUITION_ROOTS,
  TuitionWafError,
  type CampusEntry,
  type CampusSlug,
  type FaqRow,
  type FeeRow,
  type TuitionRateRow,
} from "./types.js";
import {
  buildCampusList,
  parseControllerRateHtml,
  parseFaqHtml,
  parseFeesHtml,
  parseVetmedRateHtml,
} from "./parser.js";

const ALLOWED_HOSTS = new Set(["www.controller.msstate.edu", "www.vetmed.msstate.edu"]);

export function isAllowedTuitionUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (!ALLOWED_HOSTS.has(u.host)) return false;
  return TUITION_ROOTS.some((root) => url === root || url.startsWith(`${root}/`));
}

export function detectTuitionWaf(body: string): boolean {
  if (body.includes("Just a moment...")) return true;
  if (body.includes("cf-chl-bypass")) return true;
  if (/<meta\s+http-equiv=["']refresh["'][^>]+url=[^>]*token=/i.test(body)) return true;
  return false;
}

const UA = "msstate-policies-mcp/0.8.0 (build-worker-corpus)";
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 2;
const JITTER_MIN_MS = 200;
const JITTER_MAX_MS = 600;
const FETCH_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 1500, 4000];

async function fetchOnce(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (detectTuitionWaf(text)) throw new TuitionWafError(url);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try { return await fetchOnce(url); }
    catch (err) {
      lastErr = err;
      if (err instanceof TuitionWafError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP\s+4\d{2}/.test(msg)) throw err;
      if (attempt < FETCH_RETRIES) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function jitter(): Promise<void> {
  const ms = JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
  return new Promise((r) => setTimeout(r, ms));
}

async function pool<I, O>(items: I[], conc: number, fn: (i: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
      await jitter();
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

const CAMPUS_URLS: Array<{ campus: CampusSlug; url: string }> = [
  { campus: "starkville", url: "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus" },
  { campus: "meridian",   url: "https://www.controller.msstate.edu/accountservices/tuition/meridian-campus" },
  { campus: "mgccc",      url: "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates" },
  { campus: "online",     url: "https://www.controller.msstate.edu/accountservices/tuition/online-education-rates" },
];
const VETMED_URL = "https://www.vetmed.msstate.edu/tuition";
const FAQ_URL = "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions";
const FEES_URL = "https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs";

export interface ScrapeAllOptions {
  fetchUrl?: (url: string) => Promise<string>;
}

export interface ScrapeAllResult {
  rate_rows: TuitionRateRow[];
  fee_rows: FeeRow[];
  faq_rows: FaqRow[];
  campuses: CampusEntry[];
  per_source: Record<string, { ok: boolean; error: string | null }>;
  anyError: boolean;
}

export async function scrapeAllTuition(opts: ScrapeAllOptions = {}): Promise<ScrapeAllResult> {
  const raw = opts.fetchUrl ?? fetchWithRetry;
  const fetcher = async (url: string): Promise<string> => {
    const html = await raw(url);
    if (detectTuitionWaf(html)) throw new TuitionWafError(url);
    return html;
  };
  const retrieved_at = new Date().toISOString();
  const per_source: Record<string, { ok: boolean; error: string | null }> = {};
  let anyError = false;

  // Controller campuses
  const campusResults = await pool(CAMPUS_URLS, CONCURRENCY, async ({ campus, url }) => {
    if (!isAllowedTuitionUrl(url)) return { campus, rows: [] as TuitionRateRow[], error: `URL not in allowlist: ${url}` };
    try {
      const html = await fetcher(url);
      const rows = parseControllerRateHtml(html, campus, url).map((r) => ({ ...r, retrieved_at }));
      return { campus, rows, error: null as string | null };
    } catch (e) {
      if (e instanceof TuitionWafError) throw e;
      return { campus, rows: [] as TuitionRateRow[], error: e instanceof Error ? e.message : String(e) };
    }
  });

  let rate_rows: TuitionRateRow[] = [];
  for (const r of campusResults) {
    per_source[`${r.campus}-campus`] = { ok: r.error === null && r.rows.length > 0, error: r.error };
    if (r.error || r.rows.length === 0) anyError = true;
    rate_rows = rate_rows.concat(r.rows);
  }

  // Vetmed
  try {
    if (!isAllowedTuitionUrl(VETMED_URL)) throw new Error("vetmed URL not in allowlist");
    const html = await fetcher(VETMED_URL);
    const vetRows = parseVetmedRateHtml(html, VETMED_URL).map((r) => ({ ...r, retrieved_at }));
    rate_rows = rate_rows.concat(vetRows);
    per_source["vetmed"] = { ok: vetRows.length > 0, error: vetRows.length > 0 ? null : "no rows parsed" };
    if (vetRows.length === 0) anyError = true;
  } catch (e) {
    if (e instanceof TuitionWafError) throw e;
    per_source["vetmed"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
  }

  // FAQ
  let faq_rows: FaqRow[] = [];
  try {
    if (!isAllowedTuitionUrl(FAQ_URL)) throw new Error("faq URL not in allowlist");
    const html = await fetcher(FAQ_URL);
    faq_rows = parseFaqHtml(html, FAQ_URL).map((r) => ({ ...r, retrieved_at }));
    per_source["faq"] = { ok: faq_rows.length > 0, error: null };
  } catch (e) {
    if (e instanceof TuitionWafError) throw e;
    per_source["faq"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
  }

  // Fees
  let fee_rows: FeeRow[] = [];
  try {
    if (!isAllowedTuitionUrl(FEES_URL)) throw new Error("fees URL not in allowlist");
    const html = await fetcher(FEES_URL);
    fee_rows = parseFeesHtml(html, FEES_URL).map((r) => ({ ...r, retrieved_at }));
    per_source["fees"] = { ok: fee_rows.length > 0, error: null };
  } catch (e) {
    if (e instanceof TuitionWafError) throw e;
    per_source["fees"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
  }

  const campuses = buildCampusList(rate_rows);
  return { rate_rows, fee_rows, faq_rows, campuses, per_source, anyError };
}
```

- [ ] **Step 2: Run scraper tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/scraper.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/tuition/scraper.ts msstate-policies/tests/tuition/scraper.test.ts
git commit -m "feat(tuition): scraper with allowlist, WAF detect, retry, concurrency pool"
```

---

## Stage 4 — Search (BM25 over FAQ + deterministic rate routing)

### Task 4.1: Search test

**Files:**
- Create: `msstate-policies/tests/tuition/search.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/search.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  indexFaqRows,
  bm25SearchFaq,
  routeRateRequest,
  filterFeeRows,
} from "../../src/tuition/search.js";
import type {
  FaqRow,
  FeeRow,
  TuitionRateRow,
  CampusSlug,
  Level,
  Residency,
  Term,
} from "../../src/tuition/types.js";

function faq(question: string, answer: string): FaqRow {
  return {
    question, answer,
    source_url: "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions",
    retrieved_at: "1970-01-01T00:00:00.000Z",
  };
}
function rate(
  campus: CampusSlug, level: Level, residency: Residency, term: Term, bucket: TuitionRateRow["credit_hour_bucket"],
): TuitionRateRow {
  return {
    campus, level, residency, term,
    rate_basis: campus === "vetmed" ? "annual_flat" : "per_credit_hour",
    credit_hour_bucket: bucket,
    amount_usd: 1, line_items: [], effective_term: "x",
    source_url: "x", retrieved_at: "1970-01-01T00:00:00.000Z",
  };
}

describe("bm25SearchFaq", () => {
  test("ranks the exact question first", () => {
    indexFaqRows([
      faq("Why do I need to know my campus?", "Because rates differ."),
      faq("What is the College Fee?", "A per-credit-hour fee."),
      faq("Do freshmen pay a College Fee?", "Yes."),
    ]);
    const hits = bm25SearchFaq("Why do I need to know my campus?", 3);
    assert.equal(hits[0].row.question, "Why do I need to know my campus?");
  });
  test("returns empty array for empty query", () => {
    indexFaqRows([faq("Q1", "A1")]);
    assert.deepEqual(bm25SearchFaq("", 3), []);
  });
  test("k caps result count", () => {
    indexFaqRows([
      faq("College Fee?", "A1"), faq("Program Fee?", "A2"), faq("Online Fee?", "A3"),
    ]);
    const hits = bm25SearchFaq("fee", 2);
    assert.ok(hits.length <= 2);
  });
});

describe("routeRateRequest — rejects", () => {
  test("vetmed campus with non-dvm level → reject_reason", () => {
    const r = routeRateRequest([], { campus: "vetmed", level: "undergrad", residency: "resident" });
    assert.equal(r.matches.length, 0);
    assert.match(r.not_found_reason ?? "", /DVM program only/i);
  });
  test("dvm level with non-vetmed campus → reject_reason", () => {
    const r = routeRateRequest([], { campus: "starkville", level: "dvm", residency: "resident" });
    assert.equal(r.matches.length, 0);
    assert.match(r.not_found_reason ?? "", /College of Veterinary Medicine/i);
  });
  test("mgccc + grad → reject_reason", () => {
    const r = routeRateRequest([], { campus: "mgccc", level: "grad", residency: "resident" });
    assert.equal(r.matches.length, 0);
    assert.match(r.not_found_reason ?? "", /undergraduate/i);
  });
});

describe("routeRateRequest — hits", () => {
  const corpus: TuitionRateRow[] = [
    rate("starkville", "undergrad", "resident",     "fall_spring", "1-11"),
    rate("starkville", "undergrad", "resident",     "fall_spring", "12-16"),
    rate("starkville", "undergrad", "non_resident", "fall_spring", "12-16"),
    rate("starkville", "grad",      "resident",     "fall_spring", "9+"),
    rate("vetmed",     "dvm",       "resident",     "annual",      null),
  ];
  test("credit_hours=15 picks the 12-16 bucket", () => {
    const r = routeRateRequest(corpus, {
      campus: "starkville", level: "undergrad", residency: "resident", credit_hours: 15,
    });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].credit_hour_bucket, "12-16");
  });
  test("credit_hours=8 (undergrad) picks the 1-11 bucket", () => {
    const r = routeRateRequest(corpus, {
      campus: "starkville", level: "undergrad", residency: "resident", credit_hours: 8,
    });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].credit_hour_bucket, "1-11");
  });
  test("credit_hours=20 (undergrad) caps to 12-16 bucket", () => {
    const r = routeRateRequest(corpus, {
      campus: "starkville", level: "undergrad", residency: "resident", credit_hours: 20,
    });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].credit_hour_bucket, "12-16");
  });
  test("credit_hours=9 (grad) picks 9+ bucket", () => {
    const r = routeRateRequest(corpus, {
      campus: "starkville", level: "grad", residency: "resident", credit_hours: 9,
    });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].credit_hour_bucket, "9+");
  });
  test("omitting credit_hours returns all bucket variants", () => {
    const r = routeRateRequest(corpus, {
      campus: "starkville", level: "undergrad", residency: "resident",
    });
    assert.equal(r.matches.length, 2);
  });
  test("vetmed dvm ignores credit_hours, returns the flat row", () => {
    const r = routeRateRequest(corpus, {
      campus: "vetmed", level: "dvm", residency: "resident", credit_hours: 7,
    });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].rate_basis, "annual_flat");
  });
});

describe("filterFeeRows", () => {
  const rows: FeeRow[] = [
    { kind: "college", label: "College of Engineering", per_credit_usd: 50, full_time_cap_usd: 500, flat_amount_usd: null, applicability_note: "", source_url: "x", retrieved_at: "x" },
    { kind: "college", label: "College of Arts and Sciences", per_credit_usd: 25, full_time_cap_usd: 250, flat_amount_usd: null, applicability_note: "", source_url: "x", retrieved_at: "x" },
    { kind: "program", label: "Honors College", per_credit_usd: null, full_time_cap_usd: null, flat_amount_usd: 75, applicability_note: "", source_url: "x", retrieved_at: "x" },
  ];
  test("kind filter returns matching rows only", () => {
    const r = filterFeeRows(rows, "college", undefined);
    assert.equal(r.length, 2);
    for (const x of r) assert.equal(x.kind, "college");
  });
  test("filter substring is case-insensitive", () => {
    const r = filterFeeRows(rows, "college", "engineering");
    assert.equal(r.length, 1);
    assert.match(r[0].label, /Engineering/);
  });
  test("empty filter returns all rows of the kind", () => {
    const r = filterFeeRows(rows, "program", "");
    assert.equal(r.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/search.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tuition/search.js'`.

### Task 4.2: Search implementation

**Files:**
- Create: `msstate-policies/src/tuition/search.ts`

- [ ] **Step 1: Write `search.ts`**

```typescript
// msstate-policies/src/tuition/search.ts
/**
 * Tuition search/routing. Two responsibilities:
 *   1. BM25 over FAQ rows (question×2, answer×1; k1=1.2, b=0.75).
 *   2. Deterministic routing for rate + fee lookups (no scoring).
 */
import type {
  CampusSlug,
  CreditHourBucket,
  FaqRow,
  FeeKind,
  FeeRow,
  Level,
  Residency,
  Term,
  TuitionRateRow,
} from "./types.js";

const TOKEN_SPLIT = /[\s\-_/.,;:()\[\]{}!?"'`<>|@#$%^&*=+]+/;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const FIELD_WEIGHTS = { question: 2, answer: 1 } as const;

function tokenize(input: string): string[] {
  return input.normalize("NFKC").toLowerCase().split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

interface IndexedFaq {
  row: FaqRow;
  qTokens: string[];
  aTokens: string[];
  dl: number;
}

let faqDocs: IndexedFaq[] = [];
let faqDf = new Map<string, number>();
let faqAvgLen = 0;

export function indexFaqRows(rows: FaqRow[]): void {
  faqDocs = rows.map((row) => {
    const qTokens = tokenize(row.question);
    const aTokens = tokenize(row.answer);
    return { row, qTokens, aTokens, dl: qTokens.length + aTokens.length };
  });
  faqDf = new Map();
  let total = 0;
  for (const d of faqDocs) {
    total += d.dl;
    const seen = new Set<string>();
    for (const t of [...d.qTokens, ...d.aTokens]) {
      if (seen.has(t)) continue;
      seen.add(t);
      faqDf.set(t, (faqDf.get(t) ?? 0) + 1);
    }
  }
  faqAvgLen = faqDocs.length > 0 ? total / faqDocs.length : 0;
}

function idf(token: string): number {
  const n = faqDocs.length;
  const dfi = faqDf.get(token) ?? 0;
  if (dfi === 0 || n === 0) return 0;
  return Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5));
}

function bm25Term(tf: number, dl: number, idfV: number): number {
  if (tf <= 0) return 0;
  const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / (faqAvgLen || 1));
  return idfV * ((tf * (BM25_K1 + 1)) / denom);
}

function countOf(token: string, arr: string[]): number {
  let c = 0;
  for (const t of arr) if (t === token) c++;
  return c;
}

export interface FaqHit { row: FaqRow; score: number; }

export function bm25SearchFaq(query: string, k: number): FaqHit[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const out: FaqHit[] = [];
  for (const d of faqDocs) {
    let s = 0;
    for (const q of qTokens) {
      const idfQ = idf(q);
      if (idfQ === 0) continue;
      s += FIELD_WEIGHTS.question * bm25Term(countOf(q, d.qTokens), d.dl, idfQ);
      s += FIELD_WEIGHTS.answer   * bm25Term(countOf(q, d.aTokens), d.dl, idfQ);
    }
    if (s > 0) out.push({ row: d.row, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(1, Math.min(k, out.length)));
}

// ---- Rate routing -------------------------------------------------------

export interface RateRequest {
  campus: CampusSlug;
  level: Level;
  residency: Residency;
  term?: Term;
  credit_hours?: number;
}

export interface RateRouteResult {
  matches: TuitionRateRow[];
  not_found_reason?: string;
}

export function pickCreditHourBucket(level: Level, hours: number): CreditHourBucket | null {
  if (level === "undergrad") {
    if (hours >= 1 && hours <= 11) return "1-11";
    if (hours >= 12) return "12-16"; // cap >16 to the same flat bucket
    return null;
  }
  if (level === "grad") {
    if (hours >= 1 && hours <= 8) return "1-8";
    if (hours >= 9) return "9+";
    return null;
  }
  return null; // dvm: no bucket
}

export function routeRateRequest(rows: TuitionRateRow[], req: RateRequest): RateRouteResult {
  if (req.campus === "vetmed" && req.level !== "dvm") {
    return {
      matches: [],
      not_found_reason:
        "Vetmed publishes tuition for the DVM program only. For graduate-level MS/PhD vet med programs, see Starkville graduate rates.",
    };
  }
  if (req.level === "dvm" && req.campus !== "vetmed") {
    return {
      matches: [],
      not_found_reason:
        "DVM tuition is published only by the College of Veterinary Medicine. See campus=vetmed.",
    };
  }
  if (req.campus === "mgccc" && req.level === "grad") {
    return {
      matches: [],
      not_found_reason:
        "MGCCC partnership covers undergraduate engineering only — graduate students enroll on the Starkville campus.",
    };
  }
  let filtered = rows.filter(
    (r) => r.campus === req.campus && r.level === req.level && r.residency === req.residency,
  );
  if (req.term) filtered = filtered.filter((r) => r.term === req.term);
  if (req.campus === "vetmed") return { matches: filtered };

  if (typeof req.credit_hours === "number") {
    const bucket = pickCreditHourBucket(req.level, req.credit_hours);
    if (bucket) {
      filtered = filtered.filter((r) => r.credit_hour_bucket === bucket || r.credit_hour_bucket === null);
    }
  }
  return { matches: filtered };
}

// ---- Fee filter ---------------------------------------------------------

export function filterFeeRows(rows: FeeRow[], kind: FeeKind, filter: string | undefined): FeeRow[] {
  let out = rows.filter((r) => r.kind === kind);
  const f = (filter ?? "").trim().toLowerCase();
  if (f.length > 0) out = out.filter((r) => r.label.toLowerCase().includes(f));
  return out;
}
```

- [ ] **Step 2: Run search tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/search.test.ts
```

Expected: PASS (15 tests).

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/tuition/search.ts msstate-policies/tests/tuition/search.test.ts
git commit -m "feat(tuition): BM25 over FAQ + deterministic rate routing + fee filter"
```

---

## Stage 5 — Corpus loader

### Task 5.1: Corpus test

**Files:**
- Create: `msstate-policies/tests/tuition/corpus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/corpus.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  setTuitionCorpus,
  getTuitionCorpus,
  getRateRows,
  getFeeRows,
  getFaqRows,
  getCampuses,
  tuitionCorpusHealth,
} from "../../src/tuition/corpus.js";
import type { TuitionCorpus } from "../../src/tuition/types.js";

const SAMPLE: TuitionCorpus = {
  builtAt: "2026-05-13T00:00:00.000Z",
  source: "https://www.controller.msstate.edu/accountservices/tuition",
  rate_rows: [{
    campus: "starkville", level: "undergrad", residency: "resident", term: "fall_spring",
    rate_basis: "per_credit_hour", credit_hour_bucket: "12-16", amount_usd: 5000,
    line_items: [{ label: "Tuition", amount_usd: 5000 }],
    effective_term: "Fall 2026", source_url: "x", retrieved_at: "2026-05-13T00:00:00.000Z",
  }],
  fee_rows: [{
    kind: "college", label: "College of Engineering",
    per_credit_usd: 50, full_time_cap_usd: 500, flat_amount_usd: null,
    applicability_note: "Sophomore+", source_url: "x", retrieved_at: "2026-05-13T00:00:00.000Z",
  }],
  faq_rows: [{
    question: "Why do I need to know my campus?", answer: "Rates differ.",
    source_url: "x", retrieved_at: "2026-05-13T00:00:00.000Z",
  }],
  campuses: [{
    slug: "starkville", display_name: "Starkville Campus",
    levels_offered: ["undergrad"], rate_basis: "per_credit_hour",
    source_url: "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus",
  }],
};

describe("tuition/corpus", () => {
  test("setTuitionCorpus + getters round-trip", () => {
    setTuitionCorpus(SAMPLE);
    assert.equal(getTuitionCorpus()?.builtAt, SAMPLE.builtAt);
    assert.equal(getRateRows().length, 1);
    assert.equal(getFeeRows().length, 1);
    assert.equal(getFaqRows().length, 1);
    assert.equal(getCampuses().length, 1);
  });
  test("health reports loaded + counts", () => {
    setTuitionCorpus(SAMPLE);
    const h = tuitionCorpusHealth();
    assert.equal(h.loaded, true);
    assert.equal(h.rate_count, 1);
    assert.equal(h.fee_count, 1);
    assert.equal(h.faq_count, 1);
    assert.equal(h.campus_count, 1);
    assert.equal(h.builtAt, SAMPLE.builtAt);
  });
  test("getters return [] when corpus not loaded", () => {
    // re-import: not possible mid-test; instead set to empty corpus.
    setTuitionCorpus({ ...SAMPLE, rate_rows: [], fee_rows: [], faq_rows: [], campuses: [] });
    assert.deepEqual(getRateRows(), []);
    assert.deepEqual(getFeeRows(), []);
    assert.deepEqual(getFaqRows(), []);
    assert.deepEqual(getCampuses(), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/corpus.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tuition/corpus.js'`.

### Task 5.2: Corpus implementation

**Files:**
- Create: `msstate-policies/src/tuition/corpus.ts`

- [ ] **Step 1: Write `corpus.ts`**

```typescript
// msstate-policies/src/tuition/corpus.ts
/**
 * Tuition corpus loader and shared in-memory state.
 *
 * Stdio (npx plugin): bake the `tuition` block into dist/index.js via
 * esbuild's `define`. Server startup reads __TUITION_CORPUS__ and calls
 * setTuitionCorpus(...).
 *
 * Worker: corpus.json is imported and the Worker mirrors the search/route
 * logic inline (see worker/src/index.ts).
 */
import { indexFaqRows } from "./search.js";
import type {
  CampusEntry,
  FaqRow,
  FeeRow,
  TuitionCorpus,
  TuitionRateRow,
} from "./types.js";

let CORPUS: TuitionCorpus | null = null;

export function setTuitionCorpus(c: TuitionCorpus): void {
  CORPUS = c;
  indexFaqRows(c.faq_rows);
}

export function getTuitionCorpus(): TuitionCorpus | null {
  return CORPUS;
}

export function getRateRows(): TuitionRateRow[] {
  return CORPUS?.rate_rows ?? [];
}
export function getFeeRows(): FeeRow[] {
  return CORPUS?.fee_rows ?? [];
}
export function getFaqRows(): FaqRow[] {
  return CORPUS?.faq_rows ?? [];
}
export function getCampuses(): CampusEntry[] {
  return CORPUS?.campuses ?? [];
}

export function tuitionCorpusHealth(): {
  loaded: boolean;
  rate_count: number;
  fee_count: number;
  faq_count: number;
  campus_count: number;
  builtAt: string | null;
} {
  if (!CORPUS) {
    return { loaded: false, rate_count: 0, fee_count: 0, faq_count: 0, campus_count: 0, builtAt: null };
  }
  return {
    loaded: true,
    rate_count: CORPUS.rate_rows.length,
    fee_count: CORPUS.fee_rows.length,
    faq_count: CORPUS.faq_rows.length,
    campus_count: CORPUS.campuses.length,
    builtAt: CORPUS.builtAt,
  };
}
```

- [ ] **Step 2: Run corpus tests**

```bash
cd msstate-policies && npx tsx --test tests/tuition/corpus.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/tuition/corpus.ts msstate-policies/tests/tuition/corpus.test.ts
git commit -m "feat(tuition): corpus loader + health getter"
```

---

## Stage 6 — Subprocess scraper script

### Task 6.1: Write `_scrape-tuition.ts`

**Files:**
- Create: `scripts/_scrape-tuition.ts`

- [ ] **Step 1: Write the scraper script**

```typescript
// scripts/_scrape-tuition.ts
/**
 * One-shot tuition-site scrape that writes a single JSON blob to stdout.
 * Run via `npx tsx scripts/_scrape-tuition.ts` from repo root.
 *
 * Uses the same parsers + scraper as the runtime stdio server.
 * Corpus rule: all data comes exclusively from *.msstate.edu sites.
 */

// Defensive: redirect console.log → stderr so any transitive dep that logs
// to stdout doesn't corrupt the JSON pipe to build-worker-corpus.mjs.
// eslint-disable-next-line no-console
console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

import { scrapeAllTuition } from "../msstate-policies/src/tuition/scraper.js";

async function main(): Promise<void> {
  process.stderr.write("[scrape-tuition] fetching 9 source pages...\n");
  const r = await scrapeAllTuition();
  process.stderr.write(
    `[scrape-tuition]   ${r.rate_rows.length} rate rows, ${r.fee_rows.length} fee rows, ${r.faq_rows.length} faq rows, ${r.campuses.length} campuses, anyError=${r.anyError}\n`,
  );
  for (const [src, info] of Object.entries(r.per_source)) {
    if (!info.ok) process.stderr.write(`[scrape-tuition]   FAIL ${src}: ${info.error}\n`);
  }
  process.stdout.write(
    JSON.stringify({
      rate_rows: r.rate_rows,
      fee_rows: r.fee_rows,
      faq_rows: r.faq_rows,
      campuses: r.campuses,
      per_source: r.per_source,
      anyError: r.anyError,
    }),
  );
}

main().catch((err) => {
  process.stderr.write(`[scrape-tuition] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Run the scraper end-to-end against live MSU**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && npx tsx scripts/_scrape-tuition.ts > /tmp/tuition-scrape.json 2> /tmp/tuition-scrape.err
echo "exit=$?"; wc -l /tmp/tuition-scrape.err; jq '{rates: (.rate_rows|length), fees: (.fee_rows|length), faqs: (.faq_rows|length), campuses: (.campuses|length), anyError}' /tmp/tuition-scrape.json
```

Expected:
- `exit=0`
- `anyError: false`
- `rates >= 40`, `fees >= 5`, `faqs >= 10`, `campuses == 5`
- If any number is short, inspect `/tmp/tuition-scrape.err` for the per-source failures and fix the parser before continuing.

- [ ] **Step 3: Commit**

```bash
git add scripts/_scrape-tuition.ts
git commit -m "build(tuition): subprocess scraper script"
```

---

## Stage 7 — Tools (4 files, TDD each)

### Task 7.1: `get_msu_tuition_rate` test

**Files:**
- Create: `msstate-policies/tests/tuition/tool-get-msu-tuition-rate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/tool-get-msu-tuition-rate.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { get_msu_tuition_rate } from "../../src/tools/get_msu_tuition_rate.js";
import { setTuitionCorpus } from "../../src/tuition/corpus.js";
import { TUITION_DISCLAIMER } from "../../src/tuition/types.js";
import type { TuitionCorpus, TuitionRateRow } from "../../src/tuition/types.js";

function rate(over: Partial<TuitionRateRow>): TuitionRateRow {
  return {
    campus: "starkville", level: "undergrad", residency: "resident", term: "fall_spring",
    rate_basis: "per_credit_hour", credit_hour_bucket: "12-16", amount_usd: 5000,
    line_items: [{ label: "Tuition", amount_usd: 5000 }],
    effective_term: "Fall 2026 or Spring 2027",
    source_url: "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus",
    retrieved_at: "2026-05-13T00:00:00.000Z",
    ...over,
  };
}

function corpus(rate_rows: TuitionRateRow[]): TuitionCorpus {
  return {
    builtAt: "2026-05-13T00:00:00.000Z",
    source: "https://www.controller.msstate.edu/accountservices/tuition",
    rate_rows, fee_rows: [], faq_rows: [], campuses: [],
  };
}

async function call(args: unknown) {
  const res = await get_msu_tuition_rate.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("get_msu_tuition_rate", () => {
  test("returns matching row + disclaimer on happy path", async () => {
    setTuitionCorpus(corpus([rate({})]));
    const r = await call({ campus: "starkville", level: "undergrad", residency: "resident", credit_hours: 15 });
    assert.equal(r.disclaimer, TUITION_DISCLAIMER);
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].amount_usd, 5000);
  });
  test("returns empty matches + not_found_reason on mgccc+grad", async () => {
    setTuitionCorpus(corpus([rate({ campus: "mgccc" })]));
    const r = await call({ campus: "mgccc", level: "grad", residency: "resident" });
    assert.equal(r.matches.length, 0);
    assert.match(r.not_found_reason, /undergraduate/i);
    assert.equal(r.disclaimer, TUITION_DISCLAIMER);
  });
  test("rejects credit_hours out of range via zod", async () => {
    setTuitionCorpus(corpus([rate({})]));
    await assert.rejects(
      () => call({ campus: "starkville", level: "undergrad", residency: "resident", credit_hours: 99 }),
    );
  });
  test("rejects unknown campus via zod enum", async () => {
    setTuitionCorpus(corpus([rate({})]));
    await assert.rejects(
      () => call({ campus: "tupelo", level: "undergrad", residency: "resident" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-get-msu-tuition-rate.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tools/get_msu_tuition_rate.js'`.

### Task 7.2: `get_msu_tuition_rate` implementation

**Files:**
- Create: `msstate-policies/src/tools/get_msu_tuition_rate.ts`

- [ ] **Step 1: Write the tool**

```typescript
// msstate-policies/src/tools/get_msu_tuition_rate.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getRateRows, getTuitionCorpus } from "../tuition/corpus.js";
import { routeRateRequest } from "../tuition/search.js";
import { TUITION_DISCLAIMER } from "../tuition/types.js";

const Input = z
  .object({
    campus: z.enum(["starkville", "meridian", "mgccc", "online", "vetmed"]),
    level: z.enum(["undergrad", "grad", "dvm"]),
    residency: z.enum(["resident", "non_resident"]),
    term: z.enum(["fall_spring", "winter", "summer", "annual"]).optional(),
    credit_hours: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export const get_msu_tuition_rate = {
  name: "get_msu_tuition_rate",
  description:
    "Look up MSU tuition for a specific campus + level + residency + (optional) term + (optional) credit_hours. " +
    "Returns matching rate rows verbatim with effective_term and a breakdown of line_items. Every response includes the disclaimer 'Tuition rates are subject to change without notice. Always verify the current rate at controller.msstate.edu/accountservices/tuition before paying.' " +
    "Rules: campus=vetmed requires level=dvm (DVM-only flat annual rate); level=dvm requires campus=vetmed; campus=mgccc has no graduate program. " +
    "Undergrad credit_hours buckets: 1-11 (per-hour) and 12-16 (flat full-time). Grad credit_hours buckets: 1-8 and 9+. Hours >16 are capped to the 12-16 bucket. " +
    "Omit term to receive every term variant for that triple. Source: controller.msstate.edu (4 campuses) + vetmed.msstate.edu/tuition.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const rows = getRateRows();
    const result = routeRateRequest(rows, input);
    const corpus = getTuitionCorpus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: TUITION_DISCLAIMER,
            matches: result.matches,
            ...(result.not_found_reason ? { not_found_reason: result.not_found_reason } : {}),
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-get-msu-tuition-rate.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add msstate-policies/src/tools/get_msu_tuition_rate.ts msstate-policies/tests/tuition/tool-get-msu-tuition-rate.test.ts
git commit -m "feat(tuition): get_msu_tuition_rate tool"
```

### Task 7.3: `get_msu_enrollment_fees` test + implementation

**Files:**
- Create: `msstate-policies/tests/tuition/tool-get-msu-enrollment-fees.test.ts`
- Create: `msstate-policies/src/tools/get_msu_enrollment_fees.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/tool-get-msu-enrollment-fees.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { get_msu_enrollment_fees } from "../../src/tools/get_msu_enrollment_fees.js";
import { setTuitionCorpus } from "../../src/tuition/corpus.js";
import { TUITION_DISCLAIMER, MAX_QUERY_CHARS } from "../../src/tuition/types.js";
import type { FeeRow, TuitionCorpus } from "../../src/tuition/types.js";

const FEE_ROWS: FeeRow[] = [
  { kind: "college", label: "College of Engineering", per_credit_usd: 50, full_time_cap_usd: 500, flat_amount_usd: null, applicability_note: "", source_url: "x", retrieved_at: "x" },
  { kind: "college", label: "College of Arts and Sciences", per_credit_usd: 25, full_time_cap_usd: 250, flat_amount_usd: null, applicability_note: "", source_url: "x", retrieved_at: "x" },
  { kind: "program", label: "Honors College", per_credit_usd: null, full_time_cap_usd: null, flat_amount_usd: 75, applicability_note: "", source_url: "x", retrieved_at: "x" },
];

function corpus(): TuitionCorpus {
  return { builtAt: "x", source: "https://www.controller.msstate.edu/accountservices/tuition", rate_rows: [], fee_rows: FEE_ROWS, faq_rows: [], campuses: [] };
}

async function call(args: unknown) {
  const res = await get_msu_enrollment_fees.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("get_msu_enrollment_fees", () => {
  test("kind=college returns all college rows", async () => {
    setTuitionCorpus(corpus());
    const r = await call({ kind: "college" });
    assert.equal(r.matches.length, 2);
    assert.equal(r.disclaimer, TUITION_DISCLAIMER);
  });
  test("filter='engineering' narrows the result", async () => {
    setTuitionCorpus(corpus());
    const r = await call({ kind: "college", filter: "engineering" });
    assert.equal(r.matches.length, 1);
    assert.match(r.matches[0].label, /Engineering/);
  });
  test("rejects filter longer than MAX_QUERY_CHARS", async () => {
    setTuitionCorpus(corpus());
    const long = "a".repeat(MAX_QUERY_CHARS + 1);
    await assert.rejects(() => call({ kind: "college", filter: long }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-get-msu-enrollment-fees.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// msstate-policies/src/tools/get_msu_enrollment_fees.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getFeeRows, getTuitionCorpus } from "../tuition/corpus.js";
import { filterFeeRows } from "../tuition/search.js";
import { TUITION_DISCLAIMER, MAX_QUERY_CHARS } from "../tuition/types.js";

const Input = z
  .object({
    kind: z.enum(["college", "program", "course_distance"]),
    filter: z.string().max(MAX_QUERY_CHARS).optional(),
  })
  .strict();

export const get_msu_enrollment_fees = {
  name: "get_msu_enrollment_fees",
  description:
    "List MSU's per-college, per-program, and per-course/distance enrollment fees (the 'Other Enrollment Costs' section of controller.msstate.edu). " +
    "`kind`: 'college' (per-credit + full-time-cap by college), 'program' (per-major flat or per-credit), 'course_distance' (online instructional support, course-specific fees). " +
    "`filter` (optional): case-insensitive substring match against the label (e.g. 'engineering', 'honors', 'mba'). " +
    "Every response carries the disclaimer about rates being subject to change. Source: controller.msstate.edu/accountservices/tuition/other-enrollment-costs.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const rows = getFeeRows();
    const matches = filterFeeRows(rows, input.kind, input.filter);
    const corpus = getTuitionCorpus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: TUITION_DISCLAIMER,
            matches,
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-get-msu-enrollment-fees.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/get_msu_enrollment_fees.ts msstate-policies/tests/tuition/tool-get-msu-enrollment-fees.test.ts
git commit -m "feat(tuition): get_msu_enrollment_fees tool"
```

### Task 7.4: `find_msu_tuition_faq` test + implementation

**Files:**
- Create: `msstate-policies/tests/tuition/tool-find-msu-tuition-faq.test.ts`
- Create: `msstate-policies/src/tools/find_msu_tuition_faq.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/tool-find-msu-tuition-faq.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { find_msu_tuition_faq } from "../../src/tools/find_msu_tuition_faq.js";
import { setTuitionCorpus } from "../../src/tuition/corpus.js";
import { TUITION_DISCLAIMER, MAX_QUERY_CHARS } from "../../src/tuition/types.js";
import type { FaqRow, TuitionCorpus } from "../../src/tuition/types.js";

const FAQ: FaqRow[] = [
  { question: "Why do I need to know my campus?", answer: "Rates differ by campus.", source_url: "x", retrieved_at: "x" },
  { question: "What is the College Fee?", answer: "A per-credit-hour fee.", source_url: "x", retrieved_at: "x" },
  { question: "Do freshmen pay a College Fee?", answer: "No, only sophomores and above.", source_url: "x", retrieved_at: "x" },
];

function corpus(): TuitionCorpus {
  return { builtAt: "x", source: "https://www.controller.msstate.edu/accountservices/tuition", rate_rows: [], fee_rows: [], faq_rows: FAQ, campuses: [] };
}

async function call(args: unknown) {
  const res = await find_msu_tuition_faq.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("find_msu_tuition_faq", () => {
  test("returns top-k results with disclaimer", async () => {
    setTuitionCorpus(corpus());
    const r = await call({ q: "campus" });
    assert.equal(r.disclaimer, TUITION_DISCLAIMER);
    assert.ok(r.matches.length >= 1);
    assert.match(r.matches[0].question, /campus/i);
  });
  test("k=2 caps result count to 2", async () => {
    setTuitionCorpus(corpus());
    const r = await call({ q: "fee", k: 2 });
    assert.ok(r.matches.length <= 2);
  });
  test("rejects q longer than MAX_QUERY_CHARS", async () => {
    setTuitionCorpus(corpus());
    const long = "a".repeat(MAX_QUERY_CHARS + 1);
    await assert.rejects(() => call({ q: long }));
  });
  test("rejects k > 10 via zod", async () => {
    setTuitionCorpus(corpus());
    await assert.rejects(() => call({ q: "campus", k: 20 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-find-msu-tuition-faq.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// msstate-policies/src/tools/find_msu_tuition_faq.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getTuitionCorpus } from "../tuition/corpus.js";
import { bm25SearchFaq } from "../tuition/search.js";
import { TUITION_DISCLAIMER, MAX_QUERY_CHARS } from "../tuition/types.js";

const Input = z
  .object({
    q: z.string().min(1).max(MAX_QUERY_CHARS),
    k: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export const find_msu_tuition_faq = {
  name: "find_msu_tuition_faq",
  description:
    "Search MSU's tuition FAQ (controller.msstate.edu/accountservices/tuition/frequently-asked-questions) for a question. " +
    "Returns the top-k matching Q&A pairs verbatim with their source anchor URL. " +
    "`q`: free-text question (e.g. 'why are college fees different?', 'how do I find my campus?'). " +
    "`k`: 1-10, default 3. Every response carries the tuition disclaimer. BM25 over question×2 + answer×1.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    const input = Input.parse(rawInput);
    const k = input.k ?? 3;
    const hits = bm25SearchFaq(input.q, k);
    const corpus = getTuitionCorpus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: TUITION_DISCLAIMER,
            matches: hits.map((h) => ({
              question: h.row.question,
              answer: h.row.answer,
              source_url: h.row.source_url,
              bm25_score: h.score,
              retrieved_at: h.row.retrieved_at,
            })),
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-find-msu-tuition-faq.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/find_msu_tuition_faq.ts msstate-policies/tests/tuition/tool-find-msu-tuition-faq.test.ts
git commit -m "feat(tuition): find_msu_tuition_faq tool (BM25)"
```

### Task 7.5: `list_msu_tuition_campuses` test + implementation

**Files:**
- Create: `msstate-policies/tests/tuition/tool-list-msu-tuition-campuses.test.ts`
- Create: `msstate-policies/src/tools/list_msu_tuition_campuses.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// msstate-policies/tests/tuition/tool-list-msu-tuition-campuses.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { list_msu_tuition_campuses } from "../../src/tools/list_msu_tuition_campuses.js";
import { setTuitionCorpus } from "../../src/tuition/corpus.js";
import { TUITION_DISCLAIMER } from "../../src/tuition/types.js";
import type { CampusEntry, TuitionCorpus } from "../../src/tuition/types.js";

const CAMPUSES: CampusEntry[] = [
  { slug: "starkville", display_name: "Starkville Campus", levels_offered: ["undergrad", "grad"], rate_basis: "per_credit_hour", source_url: "x" },
  { slug: "meridian",   display_name: "Meridian Campus",   levels_offered: ["undergrad", "grad"], rate_basis: "per_credit_hour", source_url: "x" },
  { slug: "mgccc",      display_name: "MGCCC — Engineering on the Coast", levels_offered: ["undergrad"], rate_basis: "per_credit_hour", source_url: "x" },
  { slug: "online",     display_name: "MSU Online Education", levels_offered: ["undergrad", "grad"], rate_basis: "per_credit_hour", source_url: "x" },
  { slug: "vetmed",     display_name: "College of Veterinary Medicine (DVM)", levels_offered: ["dvm"], rate_basis: "annual_flat", source_url: "x" },
];

function corpus(): TuitionCorpus {
  return { builtAt: "x", source: "https://www.controller.msstate.edu/accountservices/tuition", rate_rows: [], fee_rows: [], faq_rows: [], campuses: CAMPUSES };
}

async function call() {
  const res = await list_msu_tuition_campuses.handler({});
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("list_msu_tuition_campuses", () => {
  test("returns 5 entries with disclaimer", async () => {
    setTuitionCorpus(corpus());
    const r = await call();
    assert.equal(r.disclaimer, TUITION_DISCLAIMER);
    assert.equal(r.campuses.length, 5);
  });
  test("mgccc entry has levels_offered=['undergrad']", async () => {
    setTuitionCorpus(corpus());
    const r = await call();
    const mgccc = r.campuses.find((c: CampusEntry) => c.slug === "mgccc");
    assert.deepEqual(mgccc.levels_offered, ["undergrad"]);
  });
  test("vetmed entry has rate_basis=annual_flat", async () => {
    setTuitionCorpus(corpus());
    const r = await call();
    const vet = r.campuses.find((c: CampusEntry) => c.slug === "vetmed");
    assert.equal(vet.rate_basis, "annual_flat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-list-msu-tuition-campuses.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// msstate-policies/src/tools/list_msu_tuition_campuses.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getCampuses, getTuitionCorpus } from "../tuition/corpus.js";
import { TUITION_DISCLAIMER } from "../tuition/types.js";

const Input = z.object({}).strict();

export const list_msu_tuition_campuses = {
  name: "list_msu_tuition_campuses",
  description:
    "List MSU's 5 published tuition campuses: starkville, meridian, mgccc (Engineering on the Coast — undergrad only), online, vetmed (DVM only, annual_flat). " +
    "Returns each entry's slug, display_name, levels_offered, rate_basis ('per_credit_hour' or 'annual_flat'), and source_url. " +
    "Use this to discover valid `campus` values before calling get_msu_tuition_rate. Every response carries the tuition disclaimer.",
  inputSchema: zodToJsonSchema(Input, { target: "openApi3" }),
  zodSchema: Input,
  async handler(rawInput: unknown) {
    Input.parse(rawInput);
    const corpus = getTuitionCorpus();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            disclaimer: TUITION_DISCLAIMER,
            campuses: getCampuses(),
            corpus_built_at: corpus?.builtAt ?? null,
          }, null, 2),
        },
      ],
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd msstate-policies && npx tsx --test tests/tuition/tool-list-msu-tuition-campuses.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/src/tools/list_msu_tuition_campuses.ts msstate-policies/tests/tuition/tool-list-msu-tuition-campuses.test.ts
git commit -m "feat(tuition): list_msu_tuition_campuses tool"
```

---

## Stage 8 — Wire tools into stdio server + esbuild

### Task 8.1: Register tuition tools in `src/index.ts`

**Files:**
- Modify: `msstate-policies/src/index.ts`

- [ ] **Step 1: Add imports and TOOLS entries**

Open `msstate-policies/src/index.ts`. After the existing emergency-import block (around line 38) add:

```typescript
import { get_msu_tuition_rate } from "./tools/get_msu_tuition_rate.js";
import { get_msu_enrollment_fees } from "./tools/get_msu_enrollment_fees.js";
import { find_msu_tuition_faq } from "./tools/find_msu_tuition_faq.js";
import { list_msu_tuition_campuses } from "./tools/list_msu_tuition_campuses.js";
import { setTuitionCorpus } from "./tuition/corpus.js";
import type { TuitionCorpus } from "./tuition/types.js";
```

Then in the `TOOLS` array (around line 43–58), append the 4 new tools **before** `health_check`:

```typescript
const TOOLS = [
  search_policies,
  get_policy,
  chain_find_relevant_policies,
  cite_policy,
  find_msu_date,
  get_msu_calendar,
  search_msu_courses,
  get_msu_course,
  get_msu_course_graph,
  get_msu_emergency_guideline,
  list_msu_emergency_types,
  find_msu_severe_weather_refuge,
  get_msu_emergency_contacts,
  get_msu_tuition_rate,
  get_msu_enrollment_fees,
  find_msu_tuition_faq,
  list_msu_tuition_campuses,
  health_check,
] as const;
```

- [ ] **Step 2: Add the `declare` and loader for `__TUITION_CORPUS__`**

After the existing `declare const __EMERGENCY_CORPUS__:` line (around line 73) add:

```typescript
declare const __TUITION_CORPUS__: TuitionCorpus | undefined;
```

After the `loadBakedEmergencyCorpus` function add:

```typescript
function loadBakedTuitionCorpus(): void {
  if (typeof __TUITION_CORPUS__ !== "undefined" && __TUITION_CORPUS__) {
    setTuitionCorpus(__TUITION_CORPUS__);
    log("info", "tuition corpus loaded", {
      rate_rows: __TUITION_CORPUS__.rate_rows.length,
      fee_rows: __TUITION_CORPUS__.fee_rows.length,
      faq_rows: __TUITION_CORPUS__.faq_rows.length,
      campuses: __TUITION_CORPUS__.campuses.length,
    });
  } else {
    log("warn", "no baked tuition corpus available; tuition tools will return empty results");
  }
}
```

Then call it inside `main()` next to the other loaders (right after `loadBakedEmergencyCorpus();`):

```typescript
  loadBakedCourseCorpus();
  loadBakedEmergencyCorpus();
  loadBakedTuitionCorpus();
```

- [ ] **Step 3: Bake `__TUITION_CORPUS__` in build.mjs**

Open `msstate-policies/build.mjs`. After the existing `emergencyCorpus = j.emergency ?? null;` line, add:

```javascript
let tuitionCorpus = null;
try {
  const j = JSON.parse(readFileSync(workerCorpusPath, "utf8"));
  tuitionCorpus = j.tuition ?? null;
} catch {
  // fine — initial build before tuition corpus exists.
}
```

Update the `define` block to:

```javascript
  define: {
    __COURSE_CORPUS__: JSON.stringify(courseCorpus),
    __EMERGENCY_CORPUS__: JSON.stringify(emergencyCorpus),
    __TUITION_CORPUS__: JSON.stringify(tuitionCorpus),
  },
```

(Note: the existing try/catch already reads `worker/corpus.json` once. To keep it DRY, fold the tuition read into the existing try block so the file is read only once.)

- [ ] **Step 4: Extend the test glob in `msstate-policies/package.json`**

Open `msstate-policies/package.json` and change the `test` script from:

```json
"test": "tsx --test tests/*.test.ts tests/courses/*.test.ts tests/emergency/*.test.ts",
```

to:

```json
"test": "tsx --test tests/*.test.ts tests/courses/*.test.ts tests/emergency/*.test.ts tests/tuition/*.test.ts",
```

- [ ] **Step 5: Build to validate the wiring**

```bash
cd msstate-policies && npm run build 2>&1 | tail -10
```

Expected: build succeeds. `dist/index.js` size grows by ~100 KB (vs the v0.7.0 baseline). Banner line still correct format.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
cd msstate-policies && npm test 2>&1 | tail -10
```

Expected: ALL tests PASS (existing 185 + new tuition tests, ~230 total).

- [ ] **Step 7: Commit**

```bash
git add msstate-policies/src/index.ts msstate-policies/build.mjs msstate-policies/package.json
git commit -m "feat(tuition): register 4 tools, bake __TUITION_CORPUS__ via esbuild"
```

---

## Stage 9 — Worker dispatch (Cloudflare)

The Worker has no module boundary — it's a single `worker/src/index.ts` that imports `corpus.json` and contains all dispatch + search logic inline. The tuition section mirrors the existing EMERGENCY section (~line 531 of `worker/src/index.ts`).

### Task 9.1: Add tuition block to `worker/src/index.ts`

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add a tuition data block after the EMERGENCY block**

Insert a `// ---- tuition block ----` section right after the closing of the EMERGENCY block (just after the `EmergencyCorpus` types and helpers, before the `tools/list` registration starts).

```typescript
// ---- tuition block ---------------------------------------------------------

interface TuitionLineItem { label: string; amount_usd: number; }
type CampusSlug = "starkville" | "meridian" | "mgccc" | "online" | "vetmed";
type Level = "undergrad" | "grad" | "dvm";
type Residency = "resident" | "non_resident";
type TermT = "fall_spring" | "winter" | "summer" | "annual";
type RateBasis = "per_credit_hour" | "per_semester_flat" | "annual_flat";
type CreditHourBucket = "1-11" | "12-16" | "1-8" | "9+";

interface TuitionRateRow {
  campus: CampusSlug; level: Level; residency: Residency; term: TermT;
  rate_basis: RateBasis; credit_hour_bucket: CreditHourBucket | null;
  amount_usd: number; line_items: TuitionLineItem[];
  effective_term: string; source_url: string; retrieved_at: string;
}
interface FeeRow {
  kind: "college" | "program" | "course_distance";
  label: string; per_credit_usd: number | null;
  full_time_cap_usd: number | null; flat_amount_usd: number | null;
  applicability_note: string; source_url: string; retrieved_at: string;
}
interface FaqRow {
  question: string; answer: string; source_url: string; retrieved_at: string;
}
interface CampusEntry {
  slug: CampusSlug; display_name: string; levels_offered: Level[];
  rate_basis: "per_credit_hour" | "annual_flat"; source_url: string;
}
interface TuitionCorpus {
  builtAt: string; source: string;
  rate_rows: TuitionRateRow[]; fee_rows: FeeRow[];
  faq_rows: FaqRow[]; campuses: CampusEntry[];
}

const TUITION: TuitionCorpus | null =
  (corpus as { tuition?: TuitionCorpus }).tuition ?? null;

const TUITION_DISCLAIMER =
  "Tuition rates are subject to change without notice. Always verify the current rate at https://www.controller.msstate.edu/accountservices/tuition before paying.";

// ---- Tuition BM25 over FAQ -----
const TUI_FIELD_WEIGHTS = { question: 2, answer: 1 } as const;
const TUI_BM25_K1 = 1.2;
const TUI_BM25_B = 0.75;

interface TuiFaqDoc {
  row: FaqRow; qTokens: string[]; aTokens: string[]; dl: number;
}
const TUI_FAQ_DOCS: TuiFaqDoc[] = (TUITION?.faq_rows ?? []).map((row) => {
  const qTokens = tokenize(row.question);  // reuses the shared tokenize() from above in the worker
  const aTokens = tokenize(row.answer);
  return { row, qTokens, aTokens, dl: qTokens.length + aTokens.length };
});
const TUI_FAQ_DF = new Map<string, number>();
let TUI_FAQ_AVGLEN = 0;
{
  let total = 0;
  for (const d of TUI_FAQ_DOCS) {
    total += d.dl;
    const seen = new Set<string>();
    for (const t of [...d.qTokens, ...d.aTokens]) {
      if (seen.has(t)) continue;
      seen.add(t);
      TUI_FAQ_DF.set(t, (TUI_FAQ_DF.get(t) ?? 0) + 1);
    }
  }
  TUI_FAQ_AVGLEN = TUI_FAQ_DOCS.length > 0 ? total / TUI_FAQ_DOCS.length : 0;
}
function tuiFaqIdf(t: string): number {
  const n = TUI_FAQ_DOCS.length;
  const dfi = TUI_FAQ_DF.get(t) ?? 0;
  if (dfi === 0 || n === 0) return 0;
  return Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5));
}
function tuiBm25(tf: number, dl: number, idfV: number): number {
  if (tf <= 0) return 0;
  const denom = tf + TUI_BM25_K1 * (1 - TUI_BM25_B + (TUI_BM25_B * dl) / (TUI_FAQ_AVGLEN || 1));
  return idfV * ((tf * (TUI_BM25_K1 + 1)) / denom);
}
function tuiSearchFaq(query: string, k: number): { row: FaqRow; score: number }[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const out: { row: FaqRow; score: number }[] = [];
  for (const d of TUI_FAQ_DOCS) {
    let s = 0;
    for (const q of qTokens) {
      const idfQ = tuiFaqIdf(q);
      if (idfQ === 0) continue;
      s += TUI_FIELD_WEIGHTS.question * tuiBm25(countOf(q, d.qTokens), d.dl, idfQ);
      s += TUI_FIELD_WEIGHTS.answer   * tuiBm25(countOf(q, d.aTokens), d.dl, idfQ);
    }
    if (s > 0) out.push({ row: d.row, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(1, Math.min(k, out.length)));
}

// ---- Tuition rate routing -----
function tuiPickBucket(level: Level, hours: number): CreditHourBucket | null {
  if (level === "undergrad") return hours <= 11 ? "1-11" : "12-16";
  if (level === "grad")      return hours <= 8 ? "1-8"  : "9+";
  return null;
}
interface TuiRateReq {
  campus: CampusSlug; level: Level; residency: Residency;
  term?: TermT; credit_hours?: number;
}
function tuiRouteRate(req: TuiRateReq): { matches: TuitionRateRow[]; not_found_reason?: string } {
  if (req.campus === "vetmed" && req.level !== "dvm") {
    return { matches: [], not_found_reason: "Vetmed publishes tuition for the DVM program only. For graduate-level MS/PhD vet med programs, see Starkville graduate rates." };
  }
  if (req.level === "dvm" && req.campus !== "vetmed") {
    return { matches: [], not_found_reason: "DVM tuition is published only by the College of Veterinary Medicine. See campus=vetmed." };
  }
  if (req.campus === "mgccc" && req.level === "grad") {
    return { matches: [], not_found_reason: "MGCCC partnership covers undergraduate engineering only — graduate students enroll on the Starkville campus." };
  }
  let rows = (TUITION?.rate_rows ?? []).filter(
    (r) => r.campus === req.campus && r.level === req.level && r.residency === req.residency,
  );
  if (req.term) rows = rows.filter((r) => r.term === req.term);
  if (req.campus === "vetmed") return { matches: rows };
  if (typeof req.credit_hours === "number") {
    const b = tuiPickBucket(req.level, req.credit_hours);
    if (b) rows = rows.filter((r) => r.credit_hour_bucket === b || r.credit_hour_bucket === null);
  }
  return { matches: rows };
}
```

Note: `tokenize` and `countOf` already exist in the Worker's emergency block (lines ~610-680). Reuse them — do NOT redefine. If the Worker's tokenize is scoped differently, hoist it out of the emergency section to a shared helper near the top of the file (before either block) and update both call sites.

- [ ] **Step 2: Register 4 tuition tools in `tools/list`**

Find the `tools` array inside the `tools/list` handler. Add these 4 entries before the `health_check` entry:

```typescript
  {
    name: "get_msu_tuition_rate",
    description: "Look up MSU tuition for a specific campus + level + residency + (optional) term + (optional) credit_hours. Returns matching rate rows verbatim with effective_term and a breakdown of line_items. Every response includes the disclaimer that rates are subject to change. Rules: campus=vetmed requires level=dvm; level=dvm requires campus=vetmed; campus=mgccc has no graduate program. Undergrad credit_hours buckets: 1-11 / 12-16. Grad: 1-8 / 9+. Hours >16 cap to 12-16. Source: controller.msstate.edu (4 campuses) + vetmed.msstate.edu/tuition.",
    inputSchema: {
      type: "object",
      properties: {
        campus: { type: "string", enum: ["starkville", "meridian", "mgccc", "online", "vetmed"] },
        level: { type: "string", enum: ["undergrad", "grad", "dvm"] },
        residency: { type: "string", enum: ["resident", "non_resident"] },
        term: { type: "string", enum: ["fall_spring", "winter", "summer", "annual"] },
        credit_hours: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["campus", "level", "residency"],
    },
  },
  {
    name: "get_msu_enrollment_fees",
    description: "List MSU's per-college, per-program, and per-course/distance enrollment fees. `kind`: 'college' | 'program' | 'course_distance'. `filter` (optional): case-insensitive substring on the label. Every response carries the tuition disclaimer. Source: controller.msstate.edu/accountservices/tuition/other-enrollment-costs.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["college", "program", "course_distance"] },
        filter: { type: "string", description: "Substring filter, max 4096 chars" },
      },
      required: ["kind"],
    },
  },
  {
    name: "find_msu_tuition_faq",
    description: "Search MSU's tuition FAQ (controller.msstate.edu/accountservices/tuition/frequently-asked-questions) for a question. Returns top-k matching Q&A pairs verbatim. `q`: free-text. `k`: 1-10, default 3. Every response carries the tuition disclaimer. BM25.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Question text, max 4096 chars" },
        k: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["q"],
    },
  },
  {
    name: "list_msu_tuition_campuses",
    description: "List MSU's 5 published tuition campuses (starkville, meridian, mgccc, online, vetmed) with display name, levels_offered, rate_basis, and source URL. Use this to discover valid `campus` values before calling get_msu_tuition_rate.",
    inputSchema: { type: "object", properties: {} },
  },
```

Tool-count assertion in the existing `getInfoJson` / `/` handler grows from 14 → 18.

- [ ] **Step 3: Add `tools/call` case branches**

Find the existing `tools/call` switch. After the last emergency case (`case "get_msu_emergency_contacts"`) and before `case "health_check"`, add:

```typescript
    case "get_msu_tuition_rate": {
      const a = args as Record<string, unknown>;
      const campus = String(a.campus ?? "") as CampusSlug;
      const level  = String(a.level ?? "")  as Level;
      const residency = String(a.residency ?? "") as Residency;
      const term = a.term ? (String(a.term) as TermT) : undefined;
      const credit_hours = typeof a.credit_hours === "number" ? a.credit_hours : undefined;
      // Enum validation
      const VALID_CAMPUS = ["starkville","meridian","mgccc","online","vetmed"];
      const VALID_LEVEL  = ["undergrad","grad","dvm"];
      const VALID_RES    = ["resident","non_resident"];
      if (!VALID_CAMPUS.includes(campus)) return errorContent("campus must be one of: " + VALID_CAMPUS.join(", "));
      if (!VALID_LEVEL.includes(level))   return errorContent("level must be one of: " + VALID_LEVEL.join(", "));
      if (!VALID_RES.includes(residency)) return errorContent("residency must be one of: " + VALID_RES.join(", "));
      if (typeof credit_hours === "number" && (credit_hours < 1 || credit_hours > 30 || !Number.isInteger(credit_hours))) {
        return errorContent("credit_hours must be an integer between 1 and 30.");
      }
      const r = tuiRouteRate({ campus, level, residency, term, credit_hours });
      return jsonContent({
        disclaimer: TUITION_DISCLAIMER,
        matches: r.matches,
        ...(r.not_found_reason ? { not_found_reason: r.not_found_reason } : {}),
        corpus_built_at: TUITION?.builtAt ?? null,
      });
    }
    case "get_msu_enrollment_fees": {
      const a = args as Record<string, unknown>;
      const kind = String(a.kind ?? "");
      const filter = typeof a.filter === "string" ? a.filter : undefined;
      if (filter !== undefined && filter.length > MAX_QUERY_CHARS) return tooLong("filter", filter);
      if (!["college", "program", "course_distance"].includes(kind)) {
        return errorContent("kind must be one of: college, program, course_distance");
      }
      let rows = (TUITION?.fee_rows ?? []).filter((r) => r.kind === kind);
      if (filter && filter.trim().length > 0) {
        const f = filter.trim().toLowerCase();
        rows = rows.filter((r) => r.label.toLowerCase().includes(f));
      }
      return jsonContent({
        disclaimer: TUITION_DISCLAIMER,
        matches: rows,
        corpus_built_at: TUITION?.builtAt ?? null,
      });
    }
    case "find_msu_tuition_faq": {
      const a = args as Record<string, unknown>;
      const q = String(a.q ?? "");
      if (q.length === 0) return errorContent("q is required.");
      if (q.length > MAX_QUERY_CHARS) return tooLong("q", q);
      const k = typeof a.k === "number" ? a.k : 3;
      if (!Number.isInteger(k) || k < 1 || k > 10) return errorContent("k must be an integer between 1 and 10.");
      const hits = tuiSearchFaq(q, k);
      return jsonContent({
        disclaimer: TUITION_DISCLAIMER,
        matches: hits.map((h) => ({
          question: h.row.question, answer: h.row.answer,
          source_url: h.row.source_url, bm25_score: h.score,
          retrieved_at: h.row.retrieved_at,
        })),
        corpus_built_at: TUITION?.builtAt ?? null,
      });
    }
    case "list_msu_tuition_campuses": {
      return jsonContent({
        disclaimer: TUITION_DISCLAIMER,
        campuses: TUITION?.campuses ?? [],
        corpus_built_at: TUITION?.builtAt ?? null,
      });
    }
```

Note: `jsonContent`, `errorContent`, `tooLong`, and `MAX_QUERY_CHARS` already exist in `worker/src/index.ts` (used by emergency tools). Reuse them — do NOT redefine.

- [ ] **Step 4: Add tuition counts to the `/` info JSON**

Find the existing `getInfoJson` function. Find the `emergency_guideline_count` / `emergency_refuge_count` / `emergency_contact_count` lines and after them add:

```typescript
        tuition_rate_count: TUITION?.rate_rows.length ?? 0,
        tuition_fee_count: TUITION?.fee_rows.length ?? 0,
        tuition_faq_count: TUITION?.faq_rows.length ?? 0,
        tuition_campus_count: TUITION?.campuses.length ?? 0,
```

- [ ] **Step 5: Typecheck the Worker locally**

```bash
cd worker && npx --no-install tsc --noEmit 2>&1 | tail -10
```

Expected: NO output (clean typecheck). If the Worker fails to typecheck because `corpus.json` doesn't yet have a `tuition` field, that's expected — Stage 10 fixes it. For now confirm the errors are limited to "Property 'tuition' does not exist on type ..." which goes away after Stage 10.

Actually: since `TUITION` is typed via `(corpus as { tuition?: TuitionCorpus }).tuition ?? null`, the cast suppresses that error. Other typecheck errors here are real bugs to fix before committing.

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): dispatch 4 tuition tools + BM25 FAQ + rate routing"
```

---

## Stage 10 — Build pipeline integration

### Task 10.1: Add `scrapeTuitionViaSubprocess` to `build-worker-corpus.mjs`

**Files:**
- Modify: `scripts/build-worker-corpus.mjs`

- [ ] **Step 1: Add the scrape helper near the existing `scrapeEmergencyViaSubprocess`**

After the existing `scrapeEmergencyViaSubprocess` function definition (around line 392), add:

```javascript
async function scrapeTuitionViaSubprocess() {
  const { execFileSync } = await import("node:child_process");
  console.error("[build-worker-corpus] scraping tuition pages...");
  let raw;
  try {
    raw = execFileSync(
      "npx",
      ["--yes", "tsx", "scripts/_scrape-tuition.ts"],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "inherit"],
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch (err) {
    throw new Error(
      `tuition scrape subprocess failed (${err.message ?? err}) — refusing to ship a poisoned tuition corpus`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(
      "tuition scrape subprocess produced unparseable JSON — refusing to ship a poisoned tuition corpus",
    );
  }
  if (!parsed || !Array.isArray(parsed.rate_rows) || !Array.isArray(parsed.fee_rows)
      || !Array.isArray(parsed.faq_rows) || !Array.isArray(parsed.campuses)) {
    throw new Error(
      "tuition scrape: malformed payload — refusing to ship a poisoned tuition corpus",
    );
  }
  if (parsed.anyError) {
    const failed = Object.entries(parsed.per_source ?? {})
      .filter(([, info]) => !info.ok)
      .map(([k, info]) => `${k}: ${info.error}`).join("; ");
    throw new Error(
      `tuition scrape: per-source failure (${failed}) — refusing to ship a poisoned tuition corpus`,
    );
  }
  if (parsed.rate_rows.length < 40) {
    throw new Error(
      `tuition scrape: only ${parsed.rate_rows.length} rate rows (< 40) — refusing to ship a poisoned tuition corpus`,
    );
  }
  // Vetmed must be present.
  if (!parsed.rate_rows.some((r) => r.campus === "vetmed")) {
    throw new Error(
      "tuition scrape: no vetmed rate rows — refusing to ship a poisoned tuition corpus",
    );
  }
  // All 4 controller campuses must be present.
  for (const c of ["starkville", "meridian", "mgccc", "online"]) {
    if (!parsed.rate_rows.some((r) => r.campus === c)) {
      throw new Error(
        `tuition scrape: no rate rows for campus=${c} — refusing to ship a poisoned tuition corpus`,
      );
    }
  }
  // FAQ minimum.
  if (parsed.faq_rows.length < 10) {
    throw new Error(
      `tuition scrape: only ${parsed.faq_rows.length} FAQ rows (< 10) — refusing to ship a poisoned tuition corpus`,
    );
  }
  // Fees must include college + program.
  const collegeFees = parsed.fee_rows.filter((r) => r.kind === "college").length;
  const programFees = parsed.fee_rows.filter((r) => r.kind === "program").length;
  if (collegeFees === 0) {
    throw new Error(
      "tuition scrape: 0 college fee rows — refusing to ship a poisoned tuition corpus",
    );
  }
  if (programFees === 0) {
    throw new Error(
      "tuition scrape: 0 program fee rows — refusing to ship a poisoned tuition corpus",
    );
  }
  // Sanity-bound every rate row.
  for (const r of parsed.rate_rows) {
    if (typeof r.amount_usd !== "number" || r.amount_usd <= 0 || r.amount_usd > 100_000) {
      throw new Error(
        `tuition scrape: implausible amount_usd=${r.amount_usd} for ${r.campus}/${r.level}/${r.residency}/${r.term} — refusing to ship a poisoned tuition corpus`,
      );
    }
  }
  console.error(
    `[build-worker-corpus]   tuition: ${parsed.rate_rows.length} rates, ${parsed.fee_rows.length} fees, ${parsed.faq_rows.length} faqs, ${parsed.campuses.length} campuses`,
  );
  return parsed;
}
```

- [ ] **Step 2: Wire `out.tuition` into the main build flow**

In `main()`, after the existing `const emergencyPayload = await scrapeEmergencyViaSubprocess(); out.emergency = { ... };` block (around line 538-545), add:

```javascript
  const tuitionPayload = await scrapeTuitionViaSubprocess();
  out.tuition = {
    builtAt,
    source: "https://www.controller.msstate.edu/accountservices/tuition",
    rate_rows: tuitionPayload.rate_rows,
    fee_rows: tuitionPayload.fee_rows,
    faq_rows: tuitionPayload.faq_rows,
    campuses: tuitionPayload.campuses,
  };
```

- [ ] **Step 3: Run the corpus build end-to-end**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && set -a; . ./.env; set +a; node scripts/build-worker-corpus.mjs 2>&1 | tail -30
```

Expected:
- No abort. Stderr ends with the existing emergency / synonym summary lines plus a new `tuition: NN rates, MM fees, KK faqs, 5 campuses` line.
- `worker/corpus.json` now contains a `tuition` top-level key.

Validate:

```bash
jq 'keys' worker/corpus.json
jq '.tuition | {rates: (.rate_rows|length), fees: (.fee_rows|length), faqs: (.faq_rows|length), campuses: (.campuses|length), builtAt}' worker/corpus.json
```

Expected: keys include `"tuition"`. Counts match the scrape output. `builtAt` is today's ISO timestamp.

- [ ] **Step 4: Rebuild the stdio bundle and verify the tuition corpus is baked**

```bash
cd msstate-policies && npm run build 2>&1 | tail -5
grep -c '"campus":"starkville"' dist/index.js
```

Expected: `npm run build` succeeds. `grep -c` shows > 0 occurrences (proving the corpus is embedded in the bundle).

- [ ] **Step 5: Commit**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
git add scripts/build-worker-corpus.mjs worker/corpus.json msstate-policies/dist/index.js
git commit -m "build(tuition): integrate tuition scrape, abort on poisoned corpus"
```

---

## Stage 11 — Security checks (TUI1–TUI5)

### Task 11.1: Add the 5 checks to `tools/security-checklist.sh`

**Files:**
- Modify: `tools/security-checklist.sh`

- [ ] **Step 1: Add the TUI block at the end of the file (before the final score echo)**

Open `tools/security-checklist.sh`. Find the EMG block (it ends after `EMG4`). Right after the last EMG check and before the `echo $score` (or equivalent final line) at the end of the file, add:

```bash
# =============================================================================
# Tuition module checks (TUI1-TUI5, added 2026-05-13). +12 pts total.
# =============================================================================

# TUI1: All https:// URLs inside msstate-policies/src/tuition/ stay on msstate.edu.
TUI_NON_MSU=$(grep -rE 'https://[^"'"'"'[:space:])]+' msstate-policies/src/tuition 2>/dev/null \
  | grep -vE 'https://[^/]*msstate\.edu' \
  | wc -l | tr -d ' ')
if [ "$TUI_NON_MSU" = "0" ]; then
  score=$((score + 3))
  note "PASS" "TUI1 all tuition-module URLs stay on msstate.edu" 3
else
  note "FAIL" "TUI1 found $TUI_NON_MSU non-msstate.edu URLs in src/tuition/" 3
fi

# TUI2: TUITION_ROOTS frozen Object.freeze allowlist present in types.ts and
# contains all 9 documented URLs.
TUI_ROOTS_OK=0
if grep -qE 'export const TUITION_ROOTS.*=.*Object\.freeze\(' msstate-policies/src/tuition/types.ts 2>/dev/null; then
  EXPECTED=(
    "https://www.controller.msstate.edu/accountservices/tuition"
    "https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions"
    "https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs"
    "https://www.controller.msstate.edu/accountservices/tuition/select-your-campus"
    "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus"
    "https://www.controller.msstate.edu/accountservices/tuition/meridian-campus"
    "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates"
    "https://www.controller.msstate.edu/accountservices/tuition/online-education-rates"
    "https://www.vetmed.msstate.edu/tuition"
  )
  MISSING=0
  for u in "${EXPECTED[@]}"; do
    if ! grep -qF "\"$u\"" msstate-policies/src/tuition/types.ts; then MISSING=$((MISSING+1)); fi
  done
  if [ "$MISSING" = "0" ]; then TUI_ROOTS_OK=1; fi
fi
if [ "$TUI_ROOTS_OK" = "1" ]; then
  score=$((score + 2))
  note "PASS" "TUI2 TUITION_ROOTS frozen allowlist present with all 9 URLs" 2
else
  note "FAIL" "TUI2 TUITION_ROOTS allowlist missing or incomplete" 2
fi

# TUI3: Worker length-caps `q` and `filter` before parse on the 2 input-taking
# tuition tools. (list_msu_tuition_campuses + get_msu_tuition_rate are exempt.)
TUI3_OK=1
if ! grep -nA 6 'case "get_msu_enrollment_fees":' worker/src/index.ts \
     | grep -q "MAX_QUERY_CHARS"; then
  TUI3_OK=0
fi
if ! grep -nA 6 'case "find_msu_tuition_faq":' worker/src/index.ts \
     | grep -q "MAX_QUERY_CHARS"; then
  TUI3_OK=0
fi
if [ "$TUI3_OK" = "1" ]; then
  score=$((score + 3))
  note "PASS" "TUI3 Worker length-caps q + filter before parse on tuition tools" 3
else
  note "FAIL" "TUI3 Worker missing length-cap on at least one tuition tool" 3
fi

# TUI4: Build aborts with the canonical string on poisoned tuition corpus.
TUI4_COUNT=$(grep -c "refusing to ship a poisoned tuition corpus" scripts/build-worker-corpus.mjs 2>/dev/null || echo 0)
if [ "$TUI4_COUNT" -ge "8" ]; then
  score=$((score + 2))
  note "PASS" "TUI4 build aborts on poisoned tuition corpus ($TUI4_COUNT abort sites)" 2
else
  note "FAIL" "TUI4 only $TUI4_COUNT 'refusing to ship a poisoned tuition corpus' sites (need >= 8)" 2
fi

# TUI5: TUITION_DISCLAIMER constant present in types.ts AND referenced in
# all 4 tuition tool files.
TUI5_OK=1
if ! grep -q 'TUITION_DISCLAIMER' msstate-policies/src/tuition/types.ts 2>/dev/null; then
  TUI5_OK=0
fi
for f in get_msu_tuition_rate get_msu_enrollment_fees find_msu_tuition_faq list_msu_tuition_campuses; do
  if ! grep -q 'TUITION_DISCLAIMER' "msstate-policies/src/tools/${f}.ts" 2>/dev/null; then
    TUI5_OK=0
  fi
done
if [ "$TUI5_OK" = "1" ]; then
  score=$((score + 2))
  note "PASS" "TUI5 TUITION_DISCLAIMER present in types.ts + 4 tool files" 2
else
  note "FAIL" "TUI5 TUITION_DISCLAIMER missing from types.ts or one of the tool files" 2
fi
```

- [ ] **Step 2: Run the security checklist**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && bash tools/security-checklist.sh 2>&1 | grep -E "TUI|^[0-9]"
```

Expected: 5 lines `[PASS] TUI1 ... TUI5 ...`, total score `257` on a clean Linux CI run. On macOS, the existing SYN4/SYN6 macOS-bash `wc -l` whitespace artifact (12 pts) will still subtract — expected macOS score is `245`.

If any TUI check fails, fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add tools/security-checklist.sh
git commit -m "chore(security): add TUI1-TUI5 tuition checks (+12 pts, 245 -> 257)"
```

---

## Stage 12 — Evals

### Task 12.1: Create `tuition-eval-set.json`

**Files:**
- Create: `msstate-policies/eval/tuition-eval-set.json`

- [ ] **Step 1: Inspect actual amounts from the baked corpus** (so eval expected values are correct, NOT guessed)

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && jq '.tuition.rate_rows[] | select(.campus=="starkville" and .level=="undergrad" and .residency=="resident" and .credit_hour_bucket=="12-16" and .term=="fall_spring") | {amount_usd, effective_term}' worker/corpus.json
```

Copy the printed `amount_usd` into the eval set's expected field. Do the same for the other ~12 rate-lookup questions.

- [ ] **Step 2: Write the eval set**

```json
{
  "suite": "tuition",
  "description": "Eval set for the 4 tuition tools (v0.8.0). Dollar amounts must be exact for rate buckets; BM25 buckets allow top-1 BM25 ranking misses but require expected Q in top-3.",
  "buckets": [
    {
      "name": "rate_lookups",
      "pass_threshold": 1.0,
      "questions": [
        {
          "q": "How much is in-state undergrad tuition at Starkville for Fall 2026 with 15 credit hours?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "starkville", "level": "undergrad", "residency": "resident", "term": "fall_spring", "credit_hours": 15 } },
          "expect": { "matches.0.credit_hour_bucket": "12-16", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Non-resident grad tuition Online, 9 hours, Spring 2027?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "online", "level": "grad", "residency": "non_resident", "term": "fall_spring", "credit_hours": 9 } },
          "expect": { "matches.0.credit_hour_bucket": "9+", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Vetmed DVM annual tuition for a Mississippi resident?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "vetmed", "level": "dvm", "residency": "resident", "term": "annual" } },
          "expect": { "matches.0.rate_basis": "annual_flat", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Meridian campus resident undergrad summer 2026 tuition?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "meridian", "level": "undergrad", "residency": "resident", "term": "summer" } },
          "expect": { "matches.0.term": "summer", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "MGCCC undergrad non-resident fall_spring 12 hours?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "mgccc", "level": "undergrad", "residency": "non_resident", "term": "fall_spring", "credit_hours": 12 } },
          "expect": { "matches.0.credit_hour_bucket": "12-16", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Online undergrad resident winter session 2026?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "online", "level": "undergrad", "residency": "resident", "term": "winter" } },
          "expect": { "matches.0.term": "winter", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Starkville grad resident 7 hours fall_spring?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "starkville", "level": "grad", "residency": "resident", "term": "fall_spring", "credit_hours": 7 } },
          "expect": { "matches.0.credit_hour_bucket": "1-8", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Vetmed DVM per-semester non-resident?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "vetmed", "level": "dvm", "residency": "non_resident", "term": "fall_spring" } },
          "expect": { "matches.0.rate_basis": "per_semester_flat", "matches.0.amount_usd": "<FILL FROM CORPUS>" }
        }
      ]
    },
    {
      "name": "routing_rejects",
      "pass_threshold": 1.0,
      "questions": [
        {
          "q": "MGCCC graduate tuition?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "mgccc", "level": "grad", "residency": "resident" } },
          "expect": { "matches.length": 0, "not_found_reason.contains": "undergraduate" }
        },
        {
          "q": "DVM tuition on the Starkville campus?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "starkville", "level": "dvm", "residency": "resident" } },
          "expect": { "matches.length": 0, "not_found_reason.contains": "Veterinary Medicine" }
        },
        {
          "q": "Vetmed graduate (MS/PhD) tuition?",
          "tool_call": { "name": "get_msu_tuition_rate", "args": { "campus": "vetmed", "level": "grad", "residency": "resident" } },
          "expect": { "matches.length": 0, "not_found_reason.contains": "DVM" }
        }
      ]
    },
    {
      "name": "fees",
      "pass_threshold": 0.9,
      "questions": [
        {
          "q": "What's the College of Engineering fee?",
          "tool_call": { "name": "get_msu_enrollment_fees", "args": { "kind": "college", "filter": "engineering" } },
          "expect": { "matches.0.label.contains": "Engineering", "matches.0.per_credit_usd": "<FILL FROM CORPUS>" }
        },
        {
          "q": "Honors College fee?",
          "tool_call": { "name": "get_msu_enrollment_fees", "args": { "kind": "program", "filter": "honors" } },
          "expect": { "matches.0.label.contains": "Honors", "matches.0.flat_amount_usd": 75 }
        }
      ]
    },
    {
      "name": "faq",
      "pass_threshold": 0.9,
      "questions": [
        {
          "q": "Why are college fees different between colleges?",
          "tool_call": { "name": "find_msu_tuition_faq", "args": { "q": "Why are college fees different between colleges?", "k": 3 } },
          "expect": { "matches.0.question.contains": "different" }
        },
        {
          "q": "How do I find my campus?",
          "tool_call": { "name": "find_msu_tuition_faq", "args": { "q": "how do I know my campus", "k": 3 } },
          "expect": { "any_match.question.contains": "campus" }
        }
      ]
    },
    {
      "name": "adversarial",
      "pass_threshold": 1.0,
      "questions": [
        {
          "q": "What's the football schedule?",
          "tool_call": { "name": "find_msu_tuition_faq", "args": { "q": "football schedule", "k": 3 } },
          "expect": { "matches.length": 0 }
        },
        {
          "q": "What's tuition at Ole Miss?",
          "tool_call": { "name": "find_msu_tuition_faq", "args": { "q": "Ole Miss tuition", "k": 3 } },
          "expect": { "matches.length": 0 }
        }
      ]
    }
  ]
}
```

Replace every `"<FILL FROM CORPUS>"` placeholder with the actual amount from `worker/corpus.json` before running the eval. There must be NO `<FILL FROM CORPUS>` strings in the committed file.

- [ ] **Step 3: Add a `--suite=tuition` case to `scripts/run-eval.mjs`**

Inspect `scripts/run-eval.mjs` to find how `--suite=courses` is wired, then add an analogous `--suite=tuition` branch that:

1. Loads `msstate-policies/eval/tuition-eval-set.json`.
2. For each question, spawns the stdio server, sends a `tools/call` request matching `question.tool_call`, parses the response JSON.
3. Evaluates each `expect` clause:
   - `"matches.0.amount_usd": 12345` — equality
   - `"matches.length": 0` — array length
   - `"matches.0.label.contains": "Engineering"` — substring (case-insensitive)
   - `"any_match.question.contains": "campus"` — any element in `matches` matches
   - `"not_found_reason.contains": "undergraduate"` — substring
4. Computes per-bucket pass-rate, aborts if any bucket falls below its `pass_threshold`.

- [ ] **Step 4: Run the eval**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && node scripts/run-eval.mjs --suite=tuition 2>&1 | tail -30
```

Expected: every bucket reports `pass_rate >= threshold`. Exit code 0.

If any rate-lookup question fails because the recorded expected amount no longer matches the corpus (e.g., MSU bumped fall-2026 rates between scrape iterations), re-run Step 1 to refresh the expected values, NOT the parser.

- [ ] **Step 5: Commit**

```bash
git add msstate-policies/eval/tuition-eval-set.json scripts/run-eval.mjs
git commit -m "test(tuition): 30-question eval set across rate/fee/faq/adversarial buckets"
```

---

## Stage 13 — Docs, version bump, release

### Task 13.1: Update `CLAUDE.md`, `README.md`, `docs/BUILD.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/BUILD.md`
- Modify: `SECURITY.md` (only if a tuition-specific threat model entry is needed; usually unchanged)

- [ ] **Step 1: Bump tool count and add tuition tools table in `README.md`**

Open `README.md`. Find the section that lists "The 14 tools" and:

1. Change the section heading to "The 18 tools".
2. After the Emergency (4 tools) block and before the Diagnostic (1 tool) block, insert:

```markdown
| **Tuition (4 tools, v0.8.0)** | |
| `get_msu_tuition_rate` | Structured rate lookup by campus + level + residency + (optional) term + credit_hours. Includes line-item breakdown, effective_term, and a mandatory "rates subject to change" disclaimer. |
| `get_msu_enrollment_fees` | Per-college, per-program, and per-course/distance fees with per-credit and full-time-cap amounts. Filter by substring. |
| `find_msu_tuition_faq` | BM25 search across MSU's 16-question tuition FAQ. Returns top-k Q&A verbatim with anchor URLs. |
| `list_msu_tuition_campuses` | Enumerate the 5 published tuition campuses (starkville, meridian, mgccc, online, vetmed) with levels_offered + rate_basis + source URL. |
```

3. Also update the "Tool count: **14**" line in the project description near the top to **18**.

- [ ] **Step 2: Add a tuition addendum to `CLAUDE.md`**

Open `CLAUDE.md`. After the `### Corpus extension (2026-05-13) — emergency guidelines` section, append:

```markdown
### Corpus extension (2026-05-13b) — tuition

The corpus also includes MSU's published tuition rates, enrollment fees, and FAQ. Roots are pinned by the frozen `TUITION_ROOTS` allowlist in `msstate-policies/src/tuition/types.ts`:

1. `https://www.controller.msstate.edu/accountservices/tuition` (landing)
2. `https://www.controller.msstate.edu/accountservices/tuition/frequently-asked-questions` (16 Q&A pairs)
3. `https://www.controller.msstate.edu/accountservices/tuition/other-enrollment-costs` (College/Program/Course-Distance fees)
4. `https://www.controller.msstate.edu/accountservices/tuition/select-your-campus` (campus index)
5. `https://www.controller.msstate.edu/accountservices/tuition/{starkville,meridian,mgccc,online}-campus[-rates]` (4 controller campus pages, per-credit-hour rates)
6. `https://www.vetmed.msstate.edu/tuition` (DVM, flat per-semester + annual rates)

All `https://` URLs inside `msstate-policies/src/tuition/` must stay on `*.msstate.edu` subdomains. Both `www.controller.msstate.edu` and `www.vetmed.msstate.edu` are allowed.

Every tuition-tool response carries the `TUITION_DISCLAIMER` constant from `types.ts` ("Tuition rates are subject to change without notice. Always verify the current rate at https://www.controller.msstate.edu/accountservices/tuition before paying.") — including matched=null and error-shape responses.

Build aborts with canonical string `"refusing to ship a poisoned tuition corpus"` on: per-source error, < 40 rate rows, missing vetmed or any controller campus, < 10 FAQ rows, 0 college fees, 0 program fees, or any rate row with `amount_usd <= 0 || > 100_000`.
```

Also update the section header note at the top:

```markdown
... v0.7.0 (2026-05-13) ... v0.8.0 (2026-05-13b) — adds get_msu_tuition_rate, get_msu_enrollment_fees, find_msu_tuition_faq, list_msu_tuition_campuses over a baked snapshot of 9 *.msstate.edu tuition pages. Tool count: **18** ...
```

Add a new line under "Security notes" listing the TUI checks:

```markdown
- **Tuition checks (TUI1-TUI4 + TUI5 disclaimer, added 2026-05-13b)**: tuition URLs anchored by `TUITION_ROOTS` (frozen) in `msstate-policies/src/tuition/types.ts`; all `https://` URLs inside `msstate-policies/src/tuition/` must stay on msstate.edu; Worker handlers for `get_msu_enrollment_fees` and `find_msu_tuition_faq` cap input length before parse; build aborts with the canonical string `"refusing to ship a poisoned tuition corpus"` on: subprocess failure, missing campuses, < 40 rate rows, < 10 FAQ rows, 0 college or program fees, or implausible `amount_usd`. **TUITION_DISCLAIMER** must appear in every tuition-tool response (TUI5).
```

And bump the score reference in the same section:

```markdown
... was 245 pre-TUI ... Current head should score **257/257** ...
```

- [ ] **Step 3: Update `docs/BUILD.md`**

Append a section "Tuition module (v0.8.0, 2026-05-13)" near the existing emergency module section. Describe:

- 9-URL frozen allowlist (controller × 8 + vetmed × 1).
- Heterogeneous source structure: controller uses per-credit-hour tables; vetmed uses flat annual/semester tables. Unified `TuitionRateRow` shape via nullable `credit_hour_bucket`.
- MGCCC is undergrad-only by design.
- Vetmed page is one academic year behind controller; `effective_term` is surfaced verbatim so models can flag staleness.
- Build aborts: subprocess failure, < 40 rate rows, missing vetmed or any controller campus, < 10 FAQ rows, 0 college fees, 0 program fees, implausible `amount_usd`.
- Tool routing rules: `vetmed ↔ dvm`, `mgccc + grad → empty + reason`, `credit_hours > 16 → 12-16 bucket`.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md README.md docs/BUILD.md
git commit -m "docs(tuition): README/CLAUDE/BUILD addenda for v0.8.0"
```

### Task 13.2: Bump version + rebuild + final commit

**Files:**
- Modify: `msstate-policies/package.json`
- Modify: `worker/package.json`
- Modify: `msstate-policies/dist/index.js` (rebuilt artifact)

- [ ] **Step 1: Bump versions**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
sed -i.bak 's/"version": "0.7.0"/"version": "0.8.0"/' msstate-policies/package.json
sed -i.bak 's/"version": "0.7.0"/"version": "0.8.0"/' worker/package.json
rm -f msstate-policies/package.json.bak worker/package.json.bak
```

Verify:

```bash
grep '"version"' msstate-policies/package.json worker/package.json
```

Expected: both show `"version": "0.8.0"`.

- [ ] **Step 2: Rebuild stdio bundle to refresh the banner**

```bash
cd msstate-policies && npm run build 2>&1 | tail -3
head -2 dist/index.js
```

Expected: banner reads `// msstate-policies-mcp 0.8.0 <sha> built <iso>`.

- [ ] **Step 3: Re-run the full test suite + security checklist**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp
(cd msstate-policies && npm test 2>&1 | tail -5)
bash tools/security-checklist.sh 2>&1 | tail -2
```

Expected: all tests PASS (~230 total). Linux CI score = 257; on macOS, 245 (12-pt macOS `wc -l` artifact).

- [ ] **Step 4: Commit version bump + dist**

```bash
git add msstate-policies/package.json worker/package.json msstate-policies/dist/index.js
git commit -m "release: v0.8.0 — tuition tools

- 4 new tools: get_msu_tuition_rate, get_msu_enrollment_fees,
  find_msu_tuition_faq, list_msu_tuition_campuses
- Frozen TUITION_ROOTS allowlist (9 *.msstate.edu URLs)
- Build aborts on poisoned tuition corpus (8 abort sites)
- Mandatory TUITION_DISCLAIMER on every response
- TUI1-TUI5 security checks (+12 pts, 245 -> 257)
- ~30-question eval set across 5 buckets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 13.3: Tag, publish, deploy

- [ ] **Step 1: Tag the release commit**

```bash
git tag -a v0.8.0 -m "v0.8.0 — tuition tools"
```

- [ ] **Step 2: Push branch + tag**

```bash
git push origin main
git push origin v0.8.0
```

- [ ] **Step 3: Publish to npm (token from `.env`, never printed)**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && set -a; . ./.env; set +a
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /tmp/msstate-npmrc-$$ && chmod 600 /tmp/msstate-npmrc-$$
(cd msstate-policies && npm publish --userconfig /tmp/msstate-npmrc-$$ --access public 2>&1 | tail -5)
rm -f /tmp/msstate-npmrc-$$
```

Expected: `+ msstate-policies-mcp@0.8.0`. Verify with `npm view msstate-policies-mcp version` (after a short delay).

- [ ] **Step 4: Deploy Worker to Cloudflare**

```bash
cd /Users/minsub/vscode/msstate-mcp/msstate-mcp && set -a; . ./.env; set +a
(cd worker && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API" npx --no-install wrangler deploy 2>&1 | tail -5)
```

Expected: `Deployed msstate-policies-mcp triggers (...)` and a Worker URL. Verify with:

```bash
curl -s https://msstate-policies-mcp.mminsub90.workers.dev/ | jq '{version, tuition_rate_count, tuition_fee_count, tuition_faq_count, tuition_campus_count}'
curl -s -X POST https://msstate-policies-mcp.mminsub90.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | jq '.result.tools | length'
```

Expected: `version=0.8.0`; all 4 tuition counts > 0; tool count = **18**.

- [ ] **Step 5: Smoke-test one tuition tool end-to-end**

```bash
curl -s -X POST https://msstate-policies-mcp.mminsub90.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_msu_tuition_campuses","arguments":{}}}' \
  | jq '.result.content[0].text' -r | jq '.campuses | length'
```

Expected: `5`.

---

## Done

After Stage 13, v0.8.0 is published, deployed, and live. The 4 tuition tools appear at:

- npm: `msstate-policies-mcp@0.8.0`
- Cloudflare Worker: `https://msstate-policies-mcp.mminsub90.workers.dev/mcp` (tool count 18)
- claude.ai / ChatGPT connector: existing setup; new tools appear automatically next session
- Claude Code plugin: `/plugin install msstate-policies@msstate-mcp` picks up the new version on next refresh

If a downstream model asks "how much is in-state tuition for an undergrad at Starkville?", the model now has a grounded path via `get_msu_tuition_rate({ campus: "starkville", level: "undergrad", residency: "resident" })` rather than hallucinating from training data.





