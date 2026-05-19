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
    builtAt: "2026-05-19T00:00:00.000Z",
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
    assert.equal(r.corpus_built_at, "2026-05-19T00:00:00.000Z");
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
