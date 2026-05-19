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
