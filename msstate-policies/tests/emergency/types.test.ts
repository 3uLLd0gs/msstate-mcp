import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  EMERGENCY_ROOTS,
  EMERGENCY_ALIASES,
  MANDATORY_DISCLAIMER,
  MAX_QUERY_CHARS,
  EXPECTED_GUIDELINE_SLUGS,
  EmergencyWafError,
} from "../../src/emergency/types.js";

describe("emergency/types", () => {
  test("EMERGENCY_ROOTS is frozen and msstate.edu-only", () => {
    assert.ok(Object.isFrozen(EMERGENCY_ROOTS));
    for (const u of EMERGENCY_ROOTS) {
      assert.match(u, /^https:\/\/www\.emergency\.msstate\.edu\//);
    }
  });
  test("EXPECTED_GUIDELINE_SLUGS has exactly 12 entries", () => {
    assert.equal(EXPECTED_GUIDELINE_SLUGS.length, 12);
    assert.ok(EXPECTED_GUIDELINE_SLUGS.includes("severe-weather-tornado"));
    assert.ok(EXPECTED_GUIDELINE_SLUGS.includes("violence-threats-of-violence"));
  });
  test("EMERGENCY_ALIASES is frozen", () => {
    assert.ok(Object.isFrozen(EMERGENCY_ALIASES));
  });
  test("EMERGENCY_ALIASES values all map to EXPECTED_GUIDELINE_SLUGS", () => {
    for (const slug of Object.values(EMERGENCY_ALIASES)) {
      assert.ok(EXPECTED_GUIDELINE_SLUGS.includes(slug), `unknown slug: ${slug}`);
    }
  });
  test("MANDATORY_DISCLAIMER contains 911 and MSU PD number", () => {
    assert.match(MANDATORY_DISCLAIMER, /911/);
    assert.match(MANDATORY_DISCLAIMER, /662-325-2121/);
  });
  test("MAX_QUERY_CHARS is 4096 (project-wide cap)", () => {
    assert.equal(MAX_QUERY_CHARS, 4096);
  });
  test("EmergencyWafError carries the offending URL", () => {
    const e = new EmergencyWafError("https://www.emergency.msstate.edu/foo");
    assert.equal(e.name, "EmergencyWafError");
    assert.match(e.message, /WAF/);
  });
});
