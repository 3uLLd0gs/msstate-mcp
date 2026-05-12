import { test } from "node:test";
import assert from "node:assert/strict";
import { reciprocalRankFusion } from "../src/calendars/rrf.js";

test("RRF: single list returns same order capped at limit", () => {
  const out = reciprocalRankFusion([["a", "b", "c", "d"]], 60, 3);
  assert.deepEqual(out, ["a", "b", "c"]);
});

test("RRF: same #1 in both lists ranks first", () => {
  const out = reciprocalRankFusion([
    ["a", "b", "c"],
    ["a", "d", "e"],
  ], 60, 5);
  assert.equal(out[0], "a");
});

test("RRF: item in both lists at rank 2 outranks items appearing only once at rank 1", () => {
  // score(b) = 1/62 + 1/62 ≈ 0.0323
  // score(a) = 1/61 ≈ 0.0164
  // score(c) = 1/61 ≈ 0.0164
  const out = reciprocalRankFusion([
    ["a", "b"],
    ["c", "b"],
  ], 60, 5);
  assert.equal(out[0], "b");
});

test("RRF: dedups items appearing in multiple lists", () => {
  const out = reciprocalRankFusion([
    ["a", "b", "c"],
    ["a", "b", "d"],
  ], 60, 10);
  const unique = new Set(out);
  assert.equal(unique.size, out.length);
  assert.deepEqual([...unique].sort(), ["a", "b", "c", "d"]);
});

test("RRF: k=60 is canonical default and matches explicit", () => {
  const a = reciprocalRankFusion([["x", "y"], ["y", "x"]]);
  const b = reciprocalRankFusion([["x", "y"], ["y", "x"]], 60, 10);
  assert.deepEqual(a, b);
});

test("RRF: empty lists returns empty array", () => {
  assert.deepEqual(reciprocalRankFusion([]), []);
  assert.deepEqual(reciprocalRankFusion([[]]), []);
});
