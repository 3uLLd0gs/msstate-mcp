import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { get_online_program } from "../../src/tools/get_online_program.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import { ONLINE_DISCLAIMER } from "../../src/online/types.js";
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
  const res = await get_online_program.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("get_online_program", () => {
  test("slug match returns full record + disclaimer", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "MBA")]));
    const r = await call({ slug: "mba" });
    assert.equal(r.disclaimer, ONLINE_DISCLAIMER);
    assert.equal(r.matched?.slug, "mba");
    assert.deepEqual(r.did_you_mean, []);
  });
  test("unknown slug returns matched=null + not_found_reason", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "MBA")]));
    const r = await call({ slug: "xyz" });
    assert.equal(r.matched, null);
    assert.ok(r.not_found_reason);
  });
  test("name_query routes via fuzzy resolver", async () => {
    setOnlineCorpus(corpus([
      prog("mba", "master", "Master of Business Administration", "MBA online"),
      prog("psychology", "bachelor", "Bachelor in Psychology", "Online psychology"),
    ]));
    const r = await call({ name_query: "online psychology bachelor" });
    assert.equal(r.matched?.slug, "psychology");
  });
  test("rejects both slug and name_query set", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "MBA")]));
    await assert.rejects(() => call({ slug: "mba", name_query: "MBA" }));
  });
  test("rejects neither slug nor name_query set", async () => {
    setOnlineCorpus(corpus([prog("mba", "master", "MBA")]));
    await assert.rejects(() => call({}));
  });
});
