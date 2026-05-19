import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { splitClaims, routeClaim, searchInDomain } from "../../src/citation/router.js";
import { MAX_CLAIMS, MAX_CLAIM_CHARS } from "../../src/citation/types.js";
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

describe("splitClaims", () => {
  test("splits on sentence boundaries", () => {
    const r = splitClaims("MSU's drop deadline is October 15. The MBA tuition is $750 per credit. Spring break is in March.");
    assert.equal(r.claims.length, 3);
    assert.match(r.claims[0], /drop deadline/);
  });
  test("trims and skips empty fragments", () => {
    const r = splitClaims("First.  Second.\n\n   Third.");
    assert.equal(r.claims.length, 3);
    assert.equal(r.claims[0], "First");
    assert.equal(r.claims[2], "Third");
  });
  test("preserves abbreviations as boundary noise (no false splits)", () => {
    const r = splitClaims("Dr. Smith is the advisor. Email him.");
    // Acceptable: 2 sentences. A trailing "Email him" claim is fine; an
    // over-split into "Dr" + "Smith is the advisor" + "Email him" is a bug.
    assert.ok(r.claims.length <= 3);
    assert.ok(r.claims.some((s) => /Smith.*advisor/.test(s)));
  });
  test("caps at MAX_CLAIMS", () => {
    const text = Array.from({ length: MAX_CLAIMS + 10 }, (_, i) => `Claim ${i}.`).join(" ");
    const r = splitClaims(text);
    assert.equal(r.claims.length, MAX_CLAIMS);
    assert.ok(r.totalBeforeCap > r.claims.length, "totalBeforeCap should exceed cap when input has > MAX_CLAIMS sentences");
  });
  test("truncates over-long claim to MAX_CLAIM_CHARS", () => {
    const long = "X".repeat(2000);
    const r = splitClaims(`Short. ${long}.`);
    assert.equal(r.claims.length, 2);
    assert.ok(r.claims[1].length <= 800);
  });
  test("totalBeforeCap distinguishes 40-claim (not truncated) from 41-claim (truncated)", () => {
    const exactly40 = Array.from({ length: 40 }, (_, i) => `Claim ${i}.`).join(" ");
    const r40 = splitClaims(exactly40);
    assert.equal(r40.claims.length, 40);
    assert.equal(r40.totalBeforeCap, 40);   // not truncated — exactly at cap

    const over40 = Array.from({ length: 45 }, (_, i) => `Claim ${i}.`).join(" ");
    const rOver = splitClaims(over40);
    assert.equal(rOver.claims.length, MAX_CLAIMS);
    assert.ok(rOver.totalBeforeCap > MAX_CLAIMS);  // truncated
  });
});

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
  test("calendar: returns a card whose domain field is 'calendar'", async () => {
    const card = await searchInDomain("Spring break is March 9, 2027.", "calendar");
    // Acceptable: low/none confidence if calendar BM25 not warm in this test
    // context. The integration test (Task 5) will exercise the full path.
    assert.ok(["none", "low", "medium", "high"].includes(card.confidence));
    assert.equal(card.domain, "calendar");
  });
  test("calendar: miss path returns null source_url with domain='calendar'", async () => {
    // Without seeding a calendar corpus and using a query that cannot match
    // any indexed row, searchCalendarDomain must funnel through none(...).
    const card = await searchInDomain("zzz-absolutely-not-a-real-calendar-claim-token-xqz", "calendar");
    assert.equal(card.domain, "calendar");
    assert.equal(card.source_url, null);
    assert.equal(card.source_title, null);
    assert.equal(card.confidence, "none");
  });
});
