import { describe, expect, test } from "bun:test";

import { decodeEmbedding, encodeEmbedding } from "./embedding.ts";
import probe from "./nsfw-probe.json";
import { NSFW_MODEL } from "./nsfw.ts";
import { PROBE_DIMS, PROBE_MODEL, probeScore } from "./probe.ts";

describe("nsfw probe", () => {
  test("weights match the deployed image encoder and its embedding width", () => {
    expect(PROBE_MODEL).toBe(NSFW_MODEL);
    expect(PROBE_DIMS).toBe(768);
    expect(probe.weights.length).toBe(768);
  });

  test("scores are a sigmoid of the affine form", () => {
    const zero = new Float32Array(PROBE_DIMS);
    expect(probeScore(zero)).toBeCloseTo(1 / (1 + Math.exp(-probe.bias)), 6);

    // A unit vector along the strongest positive weight must score above
    // the zero vector; along the strongest negative weight, below it.
    let hi = 0;
    let lo = 0;
    probe.weights.forEach((w, i) => {
      if (w > (probe.weights[hi] ?? 0)) hi = i;
      if (w < (probe.weights[lo] ?? 0)) lo = i;
    });
    const up = new Float32Array(PROBE_DIMS);
    up[hi] = 1;
    const down = new Float32Array(PROBE_DIMS);
    down[lo] = 1;
    const base = probeScore(zero) ?? 0;
    expect(probeScore(up) ?? 0).toBeGreaterThan(base);
    expect(probeScore(down) ?? 1).toBeLessThan(base);
  });

  test("survives the fp16 storage round-trip within rescore tolerance", () => {
    const raw = Array.from(
      { length: PROBE_DIMS },
      (_, i) => Math.sin(i * 0.731) * Math.cos(i * 0.113),
    );
    const norm = Math.hypot(...raw);
    const unit = raw.map((x) => x / norm);
    const direct = probeScore(unit) ?? 0;
    const stored = probeScore(decodeEmbedding(encodeEmbedding(unit))) ?? 0;
    expect(Math.abs(direct - stored)).toBeLessThan(1e-3);
  });

  test("refuses vectors of another width", () => {
    expect(probeScore(new Float32Array(512))).toBeNull();
    expect(probeScore([])).toBeNull();
  });
});
