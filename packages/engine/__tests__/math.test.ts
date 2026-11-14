import { describe, expect, it } from "vite-plus/test";

import * as math from "../math";
import {
  addVec2,
  clamp,
  clampVec2,
  cssHex,
  distanceVec2,
  lerp,
  lerpAngle,
  lerpRgb,
  lerpVec2,
  scaleVec2,
} from "../math";
import * as transform from "../scene/transform";

describe("lerp", () => {
  it("returns a when t=0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns b when t=1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("returns midpoint when t=0.5", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it("works with negative values", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });

  it("extrapolates when t > 1", () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe("lerpVec2", () => {
  it("interpolates both components", () => {
    const result = lerpVec2({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);
    expect(result).toEqual({ x: 5, y: 10 });
  });

  it("returns a when t=0", () => {
    const a = { x: 5, y: 15 };
    const result = lerpVec2(a, { x: 100, y: 200 }, 0);
    expect(result).toEqual(a);
  });
});

describe("clamp", () => {
  it("returns value when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles min === max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe("clampVec2", () => {
  it("clamps both components independently", () => {
    const result = clampVec2({ x: -5, y: 15 }, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(result).toEqual({ x: 0, y: 10 });
  });

  it("returns input when already in bounds", () => {
    const result = clampVec2({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(result).toEqual({ x: 5, y: 5 });
  });
});

describe("distanceVec2", () => {
  it("returns 0 for same point", () => {
    expect(distanceVec2({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("returns correct distance for 3-4-5 triangle", () => {
    expect(distanceVec2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("addVec2", () => {
  it("adds components", () => {
    expect(addVec2({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });
});

describe("scaleVec2", () => {
  it("scales both components", () => {
    expect(scaleVec2({ x: 3, y: 4 }, 2)).toEqual({ x: 6, y: 8 });
  });

  it("handles zero scalar", () => {
    expect(scaleVec2({ x: 3, y: 4 }, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("transform re-exports", () => {
  it("re-exports the scene's transform math", () => {
    for (const name of Object.keys(transform)) {
      expect(math[name as keyof typeof math], name).toBe(transform[name as keyof typeof transform]);
    }
    expect(math.applyPt(math.dihedral({ rot: 1, flip: false }, [10, 0]), [1, 0])).toEqual([10, 1]);
    expect(math.IDENTITY_2D).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  });
});

describe("lerpAngle", () => {
  it("turns the shorter way round, across ±π", () => {
    expect(lerpAngle(0, 1, 0.5)).toBe(0.5);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 12);
    expect(lerpAngle(-3, 3, 0.5)).toBeCloseTo(-Math.PI, 12);
    expect(lerpAngle(0.1, 0.1 + 4 * Math.PI, 1)).toBeCloseTo(0.1, 12);
  });
});

describe("lerpRgb", () => {
  it("blends each 8-bit channel on its own, rounded", () => {
    expect(lerpRgb(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpRgb(0xff0000, 0x0000ff, 0.25)).toBe(0xbf0040);
    expect(lerpRgb(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(lerpRgb(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
  });

  it("keeps every channel in 0–255 past either end", () => {
    expect(lerpRgb(0x000000, 0xffffff, 2)).toBe(0xffffff);
    expect(lerpRgb(0x808080, 0xffffff, -2)).toBe(0x000000);
  });
});

describe("cssHex", () => {
  it("writes 0xRRGGBB as #rrggbb, padded, ignoring anything above 24 bits", () => {
    expect(cssHex(0xff3344)).toBe("#ff3344");
    expect(cssHex(0x0000ff)).toBe("#0000ff");
    expect(cssHex(0x1ffffff)).toBe("#ffffff");
    expect(cssHex(255.7)).toBe("#0000ff");
  });
});
