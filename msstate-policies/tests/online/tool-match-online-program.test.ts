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
    builtAt: "2026-05-19T00:00:00.000Z",
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
