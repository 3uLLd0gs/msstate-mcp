import { test } from "node:test";
import assert from "node:assert/strict";
import { gateRetrieval, FusedHit } from "../src/search.js";

// bm25Score = null in the helper means "no BM25 signal recorded" — the gate
// skips its raw-BM25 check in that case so legacy tests still exercise the
// fused-score path. Pass an explicit number to test the BM25 gate.
const hit = (slug: string, score: number, bm25Score: number | null = null): FusedHit => ({
  slug,
  score,
  bm25Rank: 1,
  embedRank: 1,
  bm25Score,
  snippet: "",
});

test("gateRetrieval rejects empty/low-score sets and respects margin", () => {
  // Empty input -> reject with structured reason.
  // Disable the BM25 gate (minBm25Score=0) so the legacy fused-score path is
  // what's under test here; bm25Score=null in fixtures also skips that gate.
  const opts = { minScore: 0.01, minBm25Score: 0, minMargin: 0 };
  const empty = gateRetrieval([], opts);
  assert.equal(empty.accept.length, 0);
  assert.equal(empty.rejected, true);
  assert.match(empty.reason ?? "", /no candidates|empty/i);

  // Confident top-1 above floor -> accept.
  const oneAbove = gateRetrieval([hit("0104", 0.025)], opts);
  assert.equal(oneAbove.accept.length, 1);
  assert.equal(oneAbove.rejected, false);
  assert.equal(oneAbove.accept[0].slug, "0104");

  // All hits below floor -> reject.
  const allBelow = gateRetrieval(
    [hit("0104", 0.005), hit("0309", 0.003)],
    opts,
  );
  assert.equal(allBelow.accept.length, 0);
  assert.equal(allBelow.rejected, true);
  assert.match(allBelow.reason ?? "", /below floor|insufficient/i);

  // Top-1 within margin of top-2 -> reject (cannot disambiguate).
  const tightMargin = gateRetrieval(
    [hit("0104", 0.025), hit("0309", 0.024)],
    { minScore: 0.01, minBm25Score: 0, minMargin: 0.005 },
  );
  assert.equal(tightMargin.rejected, true);
  assert.match(tightMargin.reason ?? "", /margin/i);

  // Same hits but with margin=0 -> accept (margin gate disabled).
  const noMargin = gateRetrieval(
    [hit("0104", 0.025), hit("0309", 0.024)],
    opts,
  );
  assert.equal(noMargin.rejected, false);
  assert.equal(noMargin.accept.length, 2);
});

test("gateRetrieval rejects on raw BM25 score floor (continuous, per-question signal)", () => {
  // Top-1 raw BM25 below the 11.5 default floor -> reject as "insufficient
  // confidence". This is the lever calibrated empirically — see
  // scripts/calibrate-thresholds.mts.
  const lowBm25 = gateRetrieval(
    [hit("0104", 0.025, 8.0), hit("0309", 0.020, 6.5)],
    // minScore disabled so we're isolating the BM25 check.
    { minScore: 0, minMargin: 0 },
  );
  assert.equal(lowBm25.rejected, true);
  assert.equal(lowBm25.accept.length, 0);
  assert.match(lowBm25.reason ?? "", /BM25/);

  // Top-1 raw BM25 comfortably above the floor -> accept.
  const highBm25 = gateRetrieval(
    [hit("0104", 0.025, 25.0), hit("0309", 0.020, 18.0)],
    { minScore: 0, minMargin: 0 },
  );
  assert.equal(highBm25.rejected, false);
  assert.equal(highBm25.accept.length, 2);

  // Top-1 raw BM25 right at the floor -> accept (>=).
  const atFloor = gateRetrieval(
    [hit("0104", 0.025, 11.5)],
    { minScore: 0, minMargin: 0 },
  );
  assert.equal(atFloor.rejected, false);
  assert.equal(atFloor.accept.length, 1);

  // Top-1 has no BM25 signal (came in via embeddings only) -> BM25 gate is
  // skipped, falls through to other checks.
  const noBm25Signal = gateRetrieval(
    [hit("0104", 0.025, null)],
    { minScore: 0, minMargin: 0 },
  );
  assert.equal(noBm25Signal.rejected, false);
  assert.equal(noBm25Signal.accept.length, 1);

  // Custom threshold honored.
  const customFloor = gateRetrieval(
    [hit("0104", 0.025, 9.0)],
    { minScore: 0, minBm25Score: 8.0, minMargin: 0 },
  );
  assert.equal(customFloor.rejected, false);
  assert.equal(customFloor.accept.length, 1);
});
