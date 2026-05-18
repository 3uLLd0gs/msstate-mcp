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
