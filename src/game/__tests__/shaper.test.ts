import { describe, expect, it } from "vite-plus/test";

import { type ConstructType, CONSTRUCT_CONFIGS } from "../entities/shaper-constructs";
import { validatePlacement } from "../systems/shaper";

function zeroCounts(): Record<ConstructType, number> {
  return {
    bridge: 0,
    bounce_pad: 0,
    wind_zone: 0,
    grapple_anchor: 0,
    light_orb: 0,
    shield_barrier: 0,
  };
}

describe("validatePlacement", () => {
  it("accepts a valid placement", () => {
    const result = validatePlacement(
      "bridge",
      { x: 500, y: 500 },
      zeroCounts(),
      0, // last placement
      1000, // current time (well past cooldown)
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when on cooldown", () => {
    const result = validatePlacement(
      "bridge",
      { x: 500, y: 500 },
      zeroCounts(),
      900, // placed 100ms ago
      1000,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cooldown");
  });

  it("accepts when cooldown has elapsed", () => {
    const result = validatePlacement(
      "bridge",
      { x: 500, y: 500 },
      zeroCounts(),
      400, // placed 600ms ago (> 500ms cooldown)
      1000,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when max per round is reached", () => {
    const counts = zeroCounts();
    counts.bridge = CONSTRUCT_CONFIGS.bridge.maxPerRound; // 12
    const result = validatePlacement("bridge", { x: 500, y: 500 }, counts, 0, 1000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Max");
  });

  it("accepts when below max per round", () => {
    const counts = zeroCounts();
    counts.bridge = CONSTRUCT_CONFIGS.bridge.maxPerRound - 1;
    const result = validatePlacement("bridge", { x: 500, y: 500 }, counts, 0, 1000);
    expect(result.valid).toBe(true);
  });

  it("rejects when out of bounds (x too high)", () => {
    const result = validatePlacement("bridge", { x: 5000, y: 500 }, zeroCounts(), 0, 1000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("bounds");
  });

  it("rejects when out of bounds (y too low)", () => {
    const result = validatePlacement("bridge", { x: 500, y: -600 }, zeroCounts(), 0, 1000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("bounds");
  });

  it("respects per-type limits independently", () => {
    const counts = zeroCounts();
    counts.bounce_pad = CONSTRUCT_CONFIGS.bounce_pad.maxPerRound; // 4
    // Bounce pad should be rejected
    expect(validatePlacement("bounce_pad", { x: 500, y: 500 }, counts, 0, 1000).valid).toBe(false);
    // But bridge should still be accepted
    expect(validatePlacement("bridge", { x: 500, y: 500 }, counts, 0, 1000).valid).toBe(true);
  });

  it("validates all 6 construct types", () => {
    const types: ConstructType[] = [
      "bridge",
      "bounce_pad",
      "wind_zone",
      "grapple_anchor",
      "light_orb",
      "shield_barrier",
    ];
    for (const type of types) {
      const result = validatePlacement(type, { x: 500, y: 500 }, zeroCounts(), 0, 1000);
      expect(result.valid).toBe(true);
    }
  });
});
