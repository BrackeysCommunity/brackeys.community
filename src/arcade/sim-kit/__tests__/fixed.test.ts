import { describe, expect, it } from "vite-plus/test";

import {
  FP_MAX_SAFE,
  FP_ONE,
  fp,
  fpApply,
  fpClamp,
  fpDiv,
  fpLerp,
  fpMul,
  fpRatio,
  fpRound,
  fpToString,
} from "../fixed.ts";

describe("fp", () => {
  it("scales whole numbers", () => {
    expect(fp(1)).toBe(FP_ONE);
    expect(fp(3)).toBe(3_000_000);
    expect(fp(-2)).toBe(-2_000_000);
  });

  it("scales the fractions the tuning tables use", () => {
    expect(fp(0.75)).toBe(750_000);
    expect(fp(1.5)).toBe(1_500_000);
  });
});

describe("fpRatio", () => {
  it("is exact for the multipliers the game prints", () => {
    expect(fpRatio(1, 2)).toBe(500_000);
    expect(fpRatio(3, 4)).toBe(750_000);
  });

  it("rounds a repeating ratio to the scale", () => {
    expect(fpRatio(1, 3)).toBe(333_333);
  });

  it("refuses a zero denominator", () => {
    expect(() => fpRatio(1, 0)).toThrow(RangeError);
  });
});

describe("fpMul", () => {
  it("multiplies fixed-point values", () => {
    expect(fpMul(fp(2), fp(3))).toBe(fp(6));
    expect(fpMul(fp(1), fpRatio(1, 2))).toBe(fpRatio(1, 2));
  });

  it("truncates toward zero on both signs", () => {
    // Truncation rather than rounding: a halved penalty must not gain a
    // unit from its sign.
    expect(fpMul(1, 1)).toBe(0);
    expect(fpMul(-1, 1)).toBe(0);
    expect(fpMul(fp(-3), fpRatio(1, 3))).toBe(-999_999);
  });

  it("refuses a non-integer operand", () => {
    expect(() => fpMul(1.5, FP_ONE)).toThrow(TypeError);
  });

  it("refuses an operand past the exact-integer ceiling", () => {
    expect(() => fpMul(FP_MAX_SAFE + 1, FP_ONE)).toThrow(RangeError);
  });

  it("stays exact at the ceiling", () => {
    expect(fpMul(FP_MAX_SAFE, FP_ONE)).toBe(FP_MAX_SAFE);
  });
});

describe("fpDiv", () => {
  it("divides fixed-point values", () => {
    expect(fpDiv(fp(6), fp(3))).toBe(fp(2));
  });

  it("refuses a zero divisor", () => {
    expect(() => fpDiv(FP_ONE, 0)).toThrow(RangeError);
  });
});

describe("fpApply", () => {
  it("scales a chip count by a multiplier", () => {
    // The doc's worked example: a x3 pocket makes a straight-up pay 105.
    expect(fpApply(35, fp(3))).toBe(105);
    expect(fpApply(1, fp(3))).toBe(3);
  });

  it("truncates rather than inventing a chip", () => {
    expect(fpApply(35, fpRatio(1, 2))).toBe(17);
    expect(fpApply(5, fpRatio(3, 4))).toBe(3);
  });

  it("leaves a plain pocket alone", () => {
    expect(fpApply(35, FP_ONE)).toBe(35);
  });
});

describe("fpClamp", () => {
  it("clamps both ends and passes the middle", () => {
    expect(fpClamp(-5, 0, FP_ONE)).toBe(0);
    expect(fpClamp(FP_ONE * 2, 0, FP_ONE)).toBe(FP_ONE);
    expect(fpClamp(FP_ONE / 2, 0, FP_ONE)).toBe(FP_ONE / 2);
  });
});

describe("fpLerp", () => {
  it("hits both ends exactly", () => {
    expect(fpLerp(100, 900, 0)).toBe(100);
    expect(fpLerp(100, 900, FP_ONE)).toBe(900);
  });

  it("interpolates the middle", () => {
    expect(fpLerp(100, 900, FP_ONE / 2)).toBe(500);
  });

  it("clamps a modifier stack that overshoots", () => {
    expect(fpLerp(100, 900, FP_ONE * 3)).toBe(900);
    expect(fpLerp(100, 900, -FP_ONE)).toBe(100);
  });
});

describe("fpRound", () => {
  it("rounds half away from zero", () => {
    expect(fpRound(fp(2.5))).toBe(3);
    expect(fpRound(fp(-2.5))).toBe(-3);
    expect(fpRound(fp(2.4))).toBe(2);
  });
});

describe("fpToString", () => {
  it("prints whole values without a point", () => {
    expect(fpToString(fp(3))).toBe("3");
  });

  it("trims trailing zeroes", () => {
    expect(fpToString(fp(1.5))).toBe("1.5");
    expect(fpToString(fpRatio(3, 4))).toBe("0.75");
  });

  it("keeps the sign", () => {
    expect(fpToString(fp(-1.25))).toBe("-1.25");
  });
});
