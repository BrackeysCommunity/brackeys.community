import { describe, expect, test } from "bun:test";

import { decodeEmbedding, encodeEmbedding } from "./embedding.ts";

describe("embedding fp16 codec", () => {
  test("round-trips exact fp16 values", () => {
    const vec = [0, 1, -1, 0.5, -0.25, 2 ** -14, 65504];
    expect(Array.from(decodeEmbedding(encodeEmbedding(vec)))).toEqual(vec);
  });

  test("unit-vector components survive within fp16 precision", () => {
    // Embedding components are ~N(0, 1/sqrt(768)) after L2 norm; fp16 keeps
    // ~3 decimal digits there, which is what the drift bound in nsfw.ts
    // relies on.
    const dim = 768;
    const raw = Array.from({ length: dim }, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1);
    const norm = Math.hypot(...raw);
    const unit = raw.map((x) => x / norm);
    const out = decodeEmbedding(encodeEmbedding(unit));
    for (let i = 0; i < dim; i++) {
      expect(Math.abs((out[i] ?? 0) - (unit[i] ?? 0))).toBeLessThan(2 ** -11);
    }
  });

  test("byte layout is 2 bytes per component, little-endian", () => {
    const buf = encodeEmbedding([1]);
    expect(buf.length).toBe(2);
    expect([buf[0], buf[1]]).toEqual([0x00, 0x3c]); // fp16 1.0 = 0x3C00
  });

  test("rounds to nearest even at the fp16 precision boundary", () => {
    // 1 + 2^-11 sits exactly between fp16 neighbors 1.0 and 1+2^-10; ties
    // go to the even mantissa (1.0).
    expect(decodeEmbedding(encodeEmbedding([1 + 2 ** -11]))[0]).toBe(1);
    expect(decodeEmbedding(encodeEmbedding([1 + 3 * 2 ** -12]))[0]).toBe(1 + 2 ** -10);
  });

  test("clamps overflow to infinity and preserves subnormals", () => {
    const out = decodeEmbedding(encodeEmbedding([1e6, -1e6, 2 ** -24]));
    expect(out[0]).toBe(Infinity);
    expect(out[1]).toBe(-Infinity);
    expect(out[2]).toBe(2 ** -24);
  });

  test("decodes offset views correctly", () => {
    const buf = encodeEmbedding([0.5, -0.5]);
    const padded = new Uint8Array(buf.length + 4);
    padded.set(buf, 4);
    expect(Array.from(decodeEmbedding(padded.subarray(4)))).toEqual([0.5, -0.5]);
  });
});
