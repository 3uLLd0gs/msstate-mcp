/** Per-vector symmetric int8 quantization. Cosine similarity is invariant
 *  to scale, so we only need the absolute-max for rescaling. Roundtrip
 *  cosine error is < 1e-3 on 512-dim random vectors. */

export interface QuantizedVec {
  /** Per-vector scale: original ≈ data[i] * scale. 0 when all input is 0. */
  scale: number;
  /** int8 values in [-127, 127]. */
  data: Int8Array;
}

export function quantizeInt8(v: Float32Array): QuantizedVec {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const abs = Math.abs(v[i]);
    if (abs > max) max = abs;
  }
  if (max === 0) {
    return { scale: 0, data: new Int8Array(v.length) };
  }
  const scale = max / 127;
  const data = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const q = Math.round(v[i] / scale);
    data[i] = q < -127 ? -127 : q > 127 ? 127 : q;
  }
  return { scale, data };
}

export function dequantize(q: QuantizedVec): Float32Array {
  const out = new Float32Array(q.data.length);
  for (let i = 0; i < q.data.length; i++) {
    out[i] = q.data[i] * q.scale;
  }
  return out;
}
