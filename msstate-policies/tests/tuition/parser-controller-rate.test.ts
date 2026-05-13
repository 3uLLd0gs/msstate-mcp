import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseControllerRateHtml } from "../../src/tuition/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_STK = readFileSync(
  join(here, "..", "fixtures", "tuition", "starkville.html"), "utf8",
);
const URL_STK = "https://www.controller.msstate.edu/accountservices/tuition/starkville-campus";
const FIXTURE_MGCCC = readFileSync(
  join(here, "..", "fixtures", "tuition", "mgccc.html"), "utf8",
);
const URL_MGCCC = "https://www.controller.msstate.edu/accountservices/tuition/mgccc-campus-rates";

describe("parseControllerRateHtml — starkville (both levels)", () => {
  test("returns rows for both undergrad and grad", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    assert.ok(rows.some((r) => r.level === "undergrad"));
    assert.ok(rows.some((r) => r.level === "grad"));
  });
  test("every row has rate_basis=per_credit_hour", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    for (const r of rows) assert.equal(r.rate_basis, "per_credit_hour");
  });
  test("returns both residency variants for fall_spring undergrad 12-16", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    const r12 = rows.filter(
      (r) => r.level === "undergrad" && r.term === "fall_spring" && r.credit_hour_bucket === "12-16",
    );
    assert.ok(r12.some((r) => r.residency === "resident"));
    assert.ok(r12.some((r) => r.residency === "non_resident"));
  });
  test("every row has positive amount_usd and at least one line_item", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    for (const r of rows) {
      assert.ok(r.amount_usd > 0, `non-positive amount for ${JSON.stringify(r)}`);
      assert.ok(r.line_items.length > 0);
    }
  });
  test("effective_term is non-empty for every row", () => {
    const rows = parseControllerRateHtml(FIXTURE_STK, "starkville", URL_STK);
    for (const r of rows) assert.ok(r.effective_term.length > 0);
  });
});

describe("parseControllerRateHtml — mgccc (undergrad-only)", () => {
  test("returns no grad rows for MGCCC", () => {
    const rows = parseControllerRateHtml(FIXTURE_MGCCC, "mgccc", URL_MGCCC);
    assert.equal(rows.filter((r) => r.level === "grad").length, 0);
  });
  test("returns undergrad rows for MGCCC", () => {
    const rows = parseControllerRateHtml(FIXTURE_MGCCC, "mgccc", URL_MGCCC);
    assert.ok(rows.filter((r) => r.level === "undergrad").length >= 4);
  });
});
