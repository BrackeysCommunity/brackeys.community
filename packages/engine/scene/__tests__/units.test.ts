// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_LENGTH_UNIT } from "../../game/defaults";
import { createRegistry, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { lengthUnitOf, pxPerMetreOf, scaleLengths } from "../../game/units";
import {
  isWholePixel,
  LENGTH_UNITS,
  lengthDecimals,
  pxToMetres,
  roundLength,
  snapToPixel,
} from "../units";

const isNegZero = (n: number) => Object.is(n, -0);

describe("roundLength", () => {
  it("rounds to micrometres", () => {
    expect(roundLength(1.23456749)).toBe(1.234567);
    expect(roundLength(1.2345675)).toBe(1.234568);
    expect(roundLength(0.1 + 0.2)).toBe(0.3);
    expect(roundLength(-2.0000004)).toBe(-2);
  });

  it("never gives -0", () => {
    expect(isNegZero(roundLength(-0))).toBe(false);
    expect(isNegZero(roundLength(-0.0000001))).toBe(false);
  });
});

describe.each([
  { ppm: 100, px: 1 / 100, decimals: 2 },
  { ppm: 32, px: 1 / 32, decimals: 5 },
  { ppm: 48, px: 1 / 48, decimals: 6 },
])("at $ppm px per metre", ({ ppm, px, decimals }) => {
  it("snaps to the nearest whole world px", () => {
    expect(snapToPixel(0, ppm)).toBe(0);
    expect(snapToPixel(px * 3.4, ppm)).toBe(roundLength(px * 3));
    expect(snapToPixel(px * 3.6, ppm)).toBe(roundLength(px * 4));
    expect(snapToPixel(-px * 2.6, ppm)).toBe(roundLength(-px * 3));
    expect(isNegZero(snapToPixel(-px * 0.2, ppm))).toBe(false);
    expect(isWholePixel(snapToPixel(1.2345, ppm), ppm)).toBe(true);
  });

  it("converts px to metres with the rounding rule", () => {
    expect(pxToMetres(ppm, ppm)).toBe(1);
    expect(pxToMetres(7, ppm)).toBe(roundLength(7 / ppm));
    expect(pxToMetres(-ppm * 2, ppm)).toBe(-2);
    expect(isNegZero(pxToMetres(-0, ppm))).toBe(false);
  });

  it("tells whole world px within 1e-6", () => {
    expect(isWholePixel(1, ppm)).toBe(true);
    expect(isWholePixel(px * 5, ppm)).toBe(true);
    expect(isWholePixel(pxToMetres(5, ppm), ppm)).toBe(true);
    expect(isWholePixel(px * 5.5, ppm)).toBe(false);
    expect(isWholePixel(-px * 9, ppm)).toBe(true);
  });

  it(`shows one world px in ${decimals} decimals`, () => {
    expect(lengthDecimals(ppm)).toBe(decimals);
    const shown = Number(px.toFixed(decimals));
    expect(decimals === 6 || shown === px).toBe(true);
  });
});

describe("lengthDecimals", () => {
  it("is whole metres at 1 px per metre or coarser, and at most 6", () => {
    expect(lengthDecimals(1)).toBe(0);
    expect(lengthDecimals(0.5)).toBe(0);
    expect(lengthDecimals(10)).toBe(1);
    expect(lengthDecimals(64)).toBe(6);
    expect(lengthDecimals(3)).toBe(6);
  });
});

describe("the game's units", () => {
  const game = (lengthUnit?: number) =>
    defineGame({
      id: "units-test",
      types: [],
      actions: [],
      ...(lengthUnit === undefined ? {} : { world: { lengthUnit } }),
      createRuntime: () => ({ snapshot: () => null }),
    });

  it("reads px per metre from the game's world, else the default", () => {
    expect(DEFAULT_LENGTH_UNIT).toBe(100);
    expect(pxPerMetreOf(createRegistry(null))).toBe(100);
    expect(pxPerMetreOf(createRegistry(game()))).toBe(100);
    expect(pxPerMetreOf(createRegistry(game(32)))).toBe(32);
  });

  it("knows a length field by its meta.unit, through wrappers", async () => {
    const { z } = await import("zod");
    expect(LENGTH_UNITS).toEqual(["m", "m/s", "m/s²"]);
    expect(lengthUnitOf(z.number().meta({ unit: "m" }))).toBe("m");
    expect(lengthUnitOf(z.number().meta({ unit: "m/s²" }).optional().default(1))).toBe("m/s²");
    expect(lengthUnitOf(z.number().meta({ unit: "deg" }))).toBeUndefined();
    expect(lengthUnitOf(z.number())).toBeUndefined();
  });

  it("leaves values as they are", () => {
    const value = { at: [100, 200] };
    expect(scaleLengths(value, pointField("A point."), 100)).toBe(value);
  });
});
