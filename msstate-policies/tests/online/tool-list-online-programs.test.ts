import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { list_online_programs } from "../../src/tools/list_online_programs.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../../src/online/types.js";
import type { OnlineCorpus, OnlineProgram, DegreeLevel } from "../../src/online/types.js";

function prog(slug: string, level: DegreeLevel, name: string, shortDesc = ""): OnlineProgram {
  return {
    slug, name, degree_level: level, format: "Fully online", short_description: shortDesc,
    url: `x/${slug}`,
    tuition: { per_credit_usd: null, instructional_fee_per_credit_usd: null, application_fee_domestic_usd: null, application_fee_international_usd: null, raw_prose: "" },
    contacts: [], application_deadlines: [], admission_requirements: "",
    entrance_exams: null, accreditation: null, forms: [], raw_sections: {}, parse_warnings: [],
    retrieved_at: "x",
  };
}

function corpus(programs: OnlineProgram[]): OnlineCorpus {
  return {
    builtAt: "2026-05-13T00:00:00.000Z",
    source: "https://www.online.msstate.edu/",
    programs,
    admissions_process: { url: "x", central_contact: { name: "x", title: "x", email: null, phone: null }, shared_prelude: "", sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" }, application_fee_tiers: [], external_apply_urls: [], retrieved_at: "x" },
    staff: [], info_pages: [],
  };
}

async function call(args: unknown) {
  const res = await list_online_programs.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("list_online_programs", () => {
  test("returns disclaimer + lightweight rows", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "Master of Business Administration")]));
    const r = await call({});
    assert.equal(r.disclaimer, ONLINE_DISCLAIMER);
    assert.ok(r.matches.length >= 1);
    assert.equal(r.matches[0].slug, "mba");
  });
  test("filter by level", async () => {
    setOnlineCorpus(corpus([
      prog("mba", "master", "MBA"),
      prog("bsee", "bachelor", "BSEE"),
    ]));
    const r = await call({ level: "master" });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].slug, "mba");
  });
  test("filter by subject_keyword", async () => {
    setOnlineCorpus(corpus([
      prog("mba", "master", "Master of Business Administration"),
      prog("bsee", "bachelor", "Bachelor in Electrical Engineering"),
    ]));
    const r = await call({ subject_keyword: "engineering" });
    assert.equal(r.matches.length, 1);
    assert.match(r.matches[0].name, /Engineering/);
  });
  test("rejects out-of-range limit via zod", async () => {
    setOnlineCorpus(corpus([prog("a", "bachelor", "A")]));
    await assert.rejects(() => call({ limit: 500 }));
  });
  test("rejects subject_keyword longer than MAX_QUERY_CHARS", async () => {
    setOnlineCorpus(corpus([prog("a", "bachelor", "A")]));
    const long = "x".repeat(MAX_QUERY_CHARS + 1);
    await assert.rejects(() => call({ subject_keyword: long }));
  });
});
