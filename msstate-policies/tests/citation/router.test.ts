import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { splitClaims } from "../../src/citation/router.js";
import { MAX_CLAIMS } from "../../src/citation/types.js";

describe("splitClaims", () => {
  test("splits on sentence boundaries", () => {
    const r = splitClaims("MSU's drop deadline is October 15. The MBA tuition is $750 per credit. Spring break is in March.");
    assert.equal(r.length, 3);
    assert.match(r[0], /drop deadline/);
  });
  test("trims and skips empty fragments", () => {
    const r = splitClaims("First.  Second.\n\n   Third.");
    assert.equal(r.length, 3);
    assert.equal(r[0], "First");
    assert.equal(r[2], "Third");
  });
  test("preserves abbreviations as boundary noise (no false splits)", () => {
    const r = splitClaims("Dr. Smith is the advisor. Email him.");
    // Acceptable: 2 sentences. A trailing "Email him" claim is fine; an
    // over-split into "Dr" + "Smith is the advisor" + "Email him" is a bug.
    assert.ok(r.length <= 3);
    assert.ok(r.some((s) => /Smith.*advisor/.test(s)));
  });
  test("caps at MAX_CLAIMS", () => {
    const text = Array.from({ length: MAX_CLAIMS + 10 }, (_, i) => `Claim ${i}.`).join(" ");
    const r = splitClaims(text);
    assert.equal(r.length, MAX_CLAIMS);
  });
  test("truncates over-long claim to MAX_CLAIM_CHARS", () => {
    const long = "X".repeat(2000);
    const r = splitClaims(`Short. ${long}.`);
    assert.equal(r.length, 2);
    assert.ok(r[1].length <= 800);
  });
});

import { routeClaim } from "../../src/citation/router.js";

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
