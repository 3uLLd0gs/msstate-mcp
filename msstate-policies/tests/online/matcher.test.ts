import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "../../src/online/matcher.js";
import { rankPrograms } from "../../src/online/matcher.js";
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
    parse_warnings: [], retrieved_at: "2026-05-19T00:00:00.000Z",
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
  test("defaults to 60 credits for doctoral when credits null", () => {
    const r = estimateCost(prog({ degree_level: "doctoral" }), null, false);
    assert.equal(r.credits_used, 60);
    assert.equal(r.credits_source, "default_doctoral_60");
  });
  test("defaults to 30 credits for certificate when credits null", () => {
    const r = estimateCost(prog({ degree_level: "certificate" }), null, false);
    assert.equal(r.credits_used, 30);
    assert.equal(r.credits_source, "default_certificate_30");
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
