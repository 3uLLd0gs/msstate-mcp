import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash } from "../src/calendars/hash.js";

test("contentHash: deterministic for same inputs", () => {
  const a = contentHash({ event: "Classes begin", term: "Spring 2026" });
  const b = contentHash({ event: "Classes begin", term: "Spring 2026" });
  assert.equal(a, b);
});

test("contentHash: differs when event differs", () => {
  const a = contentHash({ event: "Classes begin", term: "Spring 2026" });
  const b = contentHash({ event: "Classes end", term: "Spring 2026" });
  assert.notEqual(a, b);
});

test("contentHash: differs when term differs", () => {
  const a = contentHash({ event: "Classes begin", term: "Spring 2026" });
  const b = contentHash({ event: "Classes begin", term: "Spring 2027" });
  assert.notEqual(a, b);
});

test("contentHash: stable when term is undefined vs empty string", () => {
  const a = contentHash({ event: "Independence Day" });
  const b = contentHash({ event: "Independence Day", term: "" });
  assert.equal(a, b);
});

test("contentHash: 64-char lowercase hex", () => {
  const h = contentHash({ event: "anything" });
  assert.match(h, /^[0-9a-f]{64}$/);
});
