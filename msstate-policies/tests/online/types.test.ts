import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ONLINE_ROOTS,
  SUPPORT_PAGE_SLUGS,
  ONLINE_DISCLAIMER,
  MAX_QUERY_CHARS,
  OnlineWafError,
  type DegreeLevel,
  type StudentType,
  type OnlineParseWarning,
} from "../../src/online/types.js";

describe("online/types", () => {
  test("ONLINE_ROOTS is frozen and online.msstate.edu-only", () => {
    assert.ok(Object.isFrozen(ONLINE_ROOTS));
    for (const u of ONLINE_ROOTS) {
      assert.match(u, /^https:\/\/www\.online\.msstate\.edu\//);
    }
  });
  test("ONLINE_ROOTS contains exactly 4 base URLs", () => {
    assert.equal(ONLINE_ROOTS.length, 4);
  });
  test("ONLINE_ROOTS includes academic-programs entry point", () => {
    assert.ok(ONLINE_ROOTS.some((u) => u.endsWith("/academic-programs")));
  });
  test("SUPPORT_PAGE_SLUGS is frozen and has exactly 5 entries", () => {
    assert.ok(Object.isFrozen(SUPPORT_PAGE_SLUGS));
    assert.equal(SUPPORT_PAGE_SLUGS.length, 5);
    for (const s of ["state-authorization", "military-assistance", "orientation", "faq", "financial-matters"]) {
      assert.ok(SUPPORT_PAGE_SLUGS.includes(s as never), `missing: ${s}`);
    }
  });
  test("ONLINE_DISCLAIMER mentions verifying at the source URL", () => {
    assert.match(ONLINE_DISCLAIMER, /verify/i);
    assert.match(ONLINE_DISCLAIMER, /source url/i);
  });
  test("MAX_QUERY_CHARS is 4096", () => {
    assert.equal(MAX_QUERY_CHARS, 4096);
  });
  test("OnlineWafError carries the offending URL", () => {
    const e = new OnlineWafError("https://www.online.msstate.edu/foo");
    assert.equal(e.name, "OnlineWafError");
    assert.match(e.message, /WAF/);
    assert.equal(e.url, "https://www.online.msstate.edu/foo");
  });
});
