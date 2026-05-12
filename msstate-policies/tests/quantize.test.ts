import { test } from "node:test";
import assert from "node:assert/strict";
import { quantizeInt8, dequantize } from "../src/calendars/quantize.js";

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

test("quantize roundtrip preserves cosine similarity within 1e-3", () => {
  const v = new Float32Array(512);
  for (let i = 0; i < v.length; i++) v[i] = Math.random() * 2 - 1;
  const q = quantizeInt8(v);
  const restored = dequantize(q);
  const sim = cosineSim(v, restored);
  assert.ok(sim > 0.999, `cosine roundtrip too lossy: ${sim}`);
});

test("quantize handles all-zero vector", () => {
  const v = new Float32Array(512);
  const q = quantizeInt8(v);
  assert.equal(q.scale, 0);
  const restored = dequantize(q);
  for (let i = 0; i < restored.length; i++) assert.equal(restored[i], 0);
});

test("quantize handles single-spike vector", () => {
  const v = new Float32Array(8);
  v[3] = 1.0;
  const q = quantizeInt8(v);
  const restored = dequantize(q);
  assert.ok(Math.abs(restored[3] - 1.0) < 0.01);
  assert.ok(Math.abs(restored[0]) < 0.01);
});

test("quantize int8 data has same length as input", () => {
  const v = new Float32Array(512);
  for (let i = 0; i < v.length; i++) v[i] = Math.random();
  const q = quantizeInt8(v);
  assert.equal(q.data.length, 512);
  assert.ok(q.data instanceof Int8Array);
});
