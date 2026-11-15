import { describe, expect, it } from "vite-plus/test";

import { parseCssHex } from "../game/color";
import { isPlainObject } from "../project/kinds/define";
import { assetSlug, isObj, num, obj, optNum } from "../tiles/json-read";

describe("import JSON readers", () => {
  it("slugs names to ids, splitting camelCase only when asked", () => {
    expect(assetSlug("My Tiles (v2)!", { fallback: "tileset" })).toBe("my-tiles-v2");
    expect(assetSlug("DarkCave_Big", { fallback: "x" })).toBe("darkcave-big");
    expect(assetSlug("DarkCave_Big", { fallback: "x", splitCamel: true })).toBe("dark-cave-big");
    expect(assetSlug("***", { fallback: "tileset" })).toBe("tileset");
    expect(assetSlug(`${"a".repeat(39)} b`, { fallback: "x" })).toBe("a".repeat(39));
  });

  it("reads numbers and objects with fallbacks", () => {
    expect(num("3")).toBe(0);
    expect(num(Number.NaN, 1)).toBe(1);
    expect(num(2.5, 1)).toBe(2.5);
    expect(optNum(Infinity)).toBeUndefined();
    expect(obj([1])).toEqual({});
    expect(obj({ a: 1 })).toEqual({ a: 1 });
    for (const v of [null, [], "x", 1, {}, { a: 1 }]) expect(isObj(v)).toBe(isPlainObject(v));
  });

  it("parses CSS #rrggbb to 0xRRGGBB and nothing else", () => {
    expect(parseCssHex("#2060C0")).toBe(0x2060c0);
    for (const bad of ["2060c0", "#abc", "#80ff8000", 0x2060c0, undefined])
      expect(parseCssHex(bad)).toBeUndefined();
  });
});
