import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_DEADZONE, q, qAxis, qPointer, qVector, radialDeadzone } from "../quantize";

const length = (v: { x: number; y: number }) => Math.sqrt(v.x * v.x + v.y * v.y);

describe("q", () => {
  it("rounds to thousandths and never returns -0", () => {
    expect(q(0.12345)).toBe(0.123);
    expect(q(0.1235)).toBe(0.124);
    expect(q(-0.9996)).toBe(-1);
    expect(Object.is(q(-0.0004), 0)).toBe(true);
    expect(q(q(0.3333333))).toBe(q(0.3333333));
  });

  it("clamps an axis to −1…1 and reads non-finite values as 0", () => {
    expect(qAxis(1.4)).toBe(1);
    expect(qAxis(-7)).toBe(-1);
    expect(qAxis(-0.4567)).toBe(-0.457);
    expect(qAxis(Number.NaN)).toBe(0);
  });
});

describe("qPointer", () => {
  it("rounds world metres to 1/10,000", () => {
    expect(qPointer(1.234567)).toBe(1.2346);
    expect(qPointer(-3.00004)).toBe(-3);
    expect(Object.is(qPointer(-0.00004), 0)).toBe(true);
  });
});

describe("qVector", () => {
  it("clamps to the unit disc with the direction kept", () => {
    const v = qVector({ x: 3, y: 4 });
    expect(v).toEqual({ x: 0.6, y: 0.8 });
    expect(qVector({ x: 1, y: 1 })).toEqual({ x: 0.707, y: 0.707 });
    expect(qVector({ x: 0.2, y: -0.3 })).toEqual({ x: 0.2, y: -0.3 });
  });

  it("stays inside the disc after rounding, at every angle", () => {
    for (let deg = 0; deg < 360; deg += 0.25) {
      const rad = (deg * Math.PI) / 180;
      const v = qVector({ x: Math.cos(rad) * 2, y: Math.sin(rad) * 2 });
      expect(v.x * v.x + v.y * v.y).toBeLessThanOrEqual(1);
      expect(length(v)).toBeGreaterThan(0.997);
      expect(Math.round(v.x * 1000)).toBe(v.x * 1000);
      expect(Math.round(v.y * 1000)).toBe(v.y * 1000);
    }
  });
});

describe("radialDeadzone", () => {
  it("defaults to 0.15", () => {
    expect(DEFAULT_DEADZONE).toBe(0.15);
  });

  it("is zero inside the deadzone, whatever the direction", () => {
    expect(radialDeadzone({ x: 0.1, y: 0.1 }, 0.15)).toEqual({ x: 0, y: 0 });
    expect(radialDeadzone({ x: 0, y: -0.15 }, 0.15)).toEqual({ x: 0, y: 0 });
    // Each axis alone is under the zone's width, but together they're outside it: radial, not per axis.
    expect(length(radialDeadzone({ x: 0.12, y: 0.12 }, 0.15))).toBeGreaterThan(0);
  });

  it("rescales the magnitude from the deadzone's edge to full deflection", () => {
    expect(radialDeadzone({ x: 1, y: 0 }, 0.15)).toEqual({ x: 1, y: 0 });
    expect(radialDeadzone({ x: 0, y: 0.575 }, 0.15)).toEqual({ x: 0, y: 0.5 });
    expect(radialDeadzone({ x: -0.16, y: 0 }, 0.15)).toEqual({ x: -0.012, y: 0 });
  });

  it("clamps a stick past the disc and quantises", () => {
    const v = radialDeadzone({ x: 1, y: 1 }, 0.15);
    expect(v).toEqual({ x: 0.707, y: 0.707 });
    expect(v.x * v.x + v.y * v.y).toBeLessThanOrEqual(1);
  });

  it("passes everything through with no deadzone and nothing with a full one", () => {
    expect(radialDeadzone({ x: 0.0004, y: 0.3333 }, 0)).toEqual({ x: 0, y: 0.333 });
    expect(radialDeadzone({ x: 1, y: 0 }, 1)).toEqual({ x: 0, y: 0 });
  });
});
