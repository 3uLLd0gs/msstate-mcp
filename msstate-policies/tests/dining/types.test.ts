import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DINING_ROOTS,
  LOCATION_SLUG_RE,
  MAX_QUERY_CHARS,
  DINING_DISCLAIMER,
  DiningWafError,
} from "../../src/dining/types.js";

describe("dining/types", () => {
  test("DINING_ROOTS contains the 2 canonical URLs and is frozen", () => {
    assert.deepEqual([...DINING_ROOTS], [
      "https://dining.msstate.edu/",
      "https://msstatedining.mydininghub.com/",
    ]);
    assert.ok(Object.isFrozen(DINING_ROOTS), "DINING_ROOTS must be frozen");
  });

  test("LOCATION_SLUG_RE matches typical Touchpoint slugs", () => {
    assert.match("perry-cafeteria", LOCATION_SLUG_RE);
    assert.match("chick-fil-a", LOCATION_SLUG_RE);
    assert.match("p-o-d-market-at-hathorn", LOCATION_SLUG_RE);
    assert.match("juva", LOCATION_SLUG_RE);
  });

  test("LOCATION_SLUG_RE rejects path traversal + unsafe chars", () => {
    assert.doesNotMatch("perry/cafeteria", LOCATION_SLUG_RE);
    assert.doesNotMatch("../etc/passwd", LOCATION_SLUG_RE);
    assert.doesNotMatch("perry cafeteria", LOCATION_SLUG_RE);
    assert.doesNotMatch("", LOCATION_SLUG_RE);
    assert.doesNotMatch("-leading-dash", LOCATION_SLUG_RE);
  });

  test("MAX_QUERY_CHARS is 4096", () => {
    assert.equal(MAX_QUERY_CHARS, 4096);
  });

  test("DINING_DISCLAIMER mentions dining.msstate.edu and daily refresh", () => {
    assert.match(DINING_DISCLAIMER, /dining\.msstate\.edu/i);
    assert.match(DINING_DISCLAIMER, /daily|refresh/i);
    assert.ok(DINING_DISCLAIMER.length >= 100, "disclaimer should be substantive");
  });

  test("DiningWafError carries the offending URL", () => {
    const e = new DiningWafError("https://msstatedining.mydininghub.com/en/location/foo");
    assert.equal(e.url, "https://msstatedining.mydininghub.com/en/location/foo");
    assert.match(e.message, /WAF|challenge/i);
    assert.ok(e instanceof Error);
  });
});
