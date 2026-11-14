import { describe, expect, it } from "vite-plus/test";

import { halfTurnDeg, normDeg } from "../transform";

describe("normDeg", () => {
  it("wraps into [0, 360) without -0, even for a negative angle a hair below zero", () => {
    expect([normDeg(-90), normDeg(720), normDeg(-0), normDeg(359.5), normDeg(-1e-20)]).toEqual([
      270, 0, 0, 359.5, 0,
    ]);
    expect(Object.is(normDeg(-360), 0)).toBe(true);
  });
});

describe("halfTurnDeg", () => {
  it("wraps into (-180, 180], the shorter way round", () => {
    expect([180, -180, 181, -181, 270, -270, 540, 359].map(halfTurnDeg)).toEqual([
      180, 180, -179, 179, -90, 90, 180, -1,
    ]);
  });

  it("keeps an angle already in range bit for bit, and never gives -0", () => {
    for (const d of [0.1 + 0.2, -179.999, 1e-12, -1e-12]) expect(halfTurnDeg(d)).toBe(d);
    expect(Object.is(halfTurnDeg(-0), 0)).toBe(true);
    expect(Object.is(halfTurnDeg(-360), 0)).toBe(true);
  });
});
