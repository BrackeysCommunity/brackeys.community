import { describe, expect, test } from "vite-plus/test";

import { parseColour, resolveStyle } from "../src/style.ts";
import { packStyle } from "./support.ts";

const pack = packStyle();
const s = resolveStyle(pack);

describe("resolveStyle", () => {
  test("colours carry their alpha", () => {
    expect(s.colour("terrain:plain")).toBe("rgba(185, 201, 122, 1)");
    expect(s.colour("weather:storm")).toBe("rgba(106, 79, 200, 0.314)");
    expect(s.alpha("weather:storm")).toBe(80);
    expect(s.opaque("weather:storm")).toBe("rgba(106, 79, 200, 1)");
    expect(s.colourAt("layer:threat", 51)).toBe("rgba(164, 72, 42, 0.2)");
    expect(s.alpha("weather:clear")).toBe(0);
    expect(s.rev).toBe(pack.rev);
  });

  test("an id the pack lacks is magenta, so the gap shows", () => {
    expect(s.colour("terrain:no-such")).toBe("rgba(255, 0, 255, 1)");
    expect(s.glyph("no-such")).toBe("");
    expect(s.pattern("no-such")).toBe("");
  });

  test("glyphs and patterns, none read as empty", () => {
    expect(s.glyph("place:settlement")).toBe("diamond");
    expect(s.glyph("site:dungeon")).toBe("square");
    expect(s.pattern("fog:seen")).toBe("dots");
    expect(s.pattern("fog:sight")).toBe("rim");
    expect(s.pattern("layer:corruption")).toBe("stripes");
    const none = resolveStyle({
      ...pack,
      entries: [{ id: "x", colour: "#000000", alpha: 255, glyph: "none", pattern: "none" }],
    });
    expect(none.glyph("x")).toBe("");
    expect(none.pattern("x")).toBe("");
  });

  test("every id the draw lists name is in the pack", () => {
    const ids = [
      "fog:seen",
      "fog:sight",
      "layer:threat",
      "layer:corruption",
      "layer:danger",
      "layer:trouble",
      "layer:fire",
      "layer:busy",
      "layer:self",
      "layer:route",
      "layer:camp",
      "layer:haunted",
      "place:settlement",
      "place:city",
      "place:city-tile",
      "place:ruin",
      "place:faction",
      "site:dungeon",
      "site:other",
      "water:river",
      "water:stream",
      "water:ford",
      "water:lake",
      "water:sea",
      "water:bog",
      "road",
      "ink",
      "paper",
      "border",
      "frontier",
      "region-border",
    ];
    const have = new Set(pack.entries.map((e) => e.id));
    for (const id of ids) expect(have.has(id), id).toBe(true);
  });

  test("view numbers come through", () => {
    expect(s.view).toEqual({
      seenDim: 45,
      zoomArea: 4,
      zoomTile: 12,
      zoomMin: 1,
      zoomMax: 40,
      blendMax: 50,
    });
  });
});

describe("terrainFill", () => {
  test("no secondary is the terrain itself", () => {
    expect(s.terrainFill({ terrain: "forest" })).toBe("rgba(79, 122, 69, 1)");
    expect(s.terrainFill({ terrain: "forest", secondary: "plain", blend: 0 })).toBe(
      "rgba(79, 122, 69, 1)",
    );
  });

  test("mixes the secondary in by its share, as Go's HexMap blends", () => {
    // plain #b9c97a, forest #4f7a45, 30% forest: trunc(x·0.7 + y·0.3).
    const mix = (a: number, b: number) => Math.trunc(a * 0.7 + b * 0.3);
    expect(s.terrainFill({ terrain: "plain", secondary: "forest", blend: 30 })).toBe(
      `rgba(${mix(0xb9, 0x4f)}, ${mix(0xc9, 0x7a)}, ${mix(0x7a, 0x45)}, 1)`,
    );
  });

  test("a share past blend-max is held at it", () => {
    expect(s.terrainFill({ terrain: "plain", secondary: "forest", blend: 90 })).toBe(
      s.terrainFill({ terrain: "plain", secondary: "forest", blend: 50 }),
    );
  });
});

describe("dim", () => {
  test("darkens by seen-dim and keeps the alpha", () => {
    const keep = (x: number) => Math.round(x * 0.55);
    expect(s.dim("rgba(185, 201, 122, 1)")).toBe(
      `rgba(${keep(185)}, ${keep(201)}, ${keep(122)}, 1)`,
    );
    expect(s.dim("rgba(100, 100, 100, 0.314)")).toBe("rgba(55, 55, 55, 0.314)");
    expect(s.dim("#ffffff")).toBe("rgba(140, 140, 140, 1)");
  });

  test("the veil over an opaque colour gives its dim", () => {
    const v = parseColour(s.veil);
    expect(v).toMatchObject({ r: 0, g: 0, b: 0 });
    const a = (v?.a ?? 0) / 255;
    for (const x of [0, 77, 185, 255]) expect(Math.round(x * (1 - a))).toBe(Math.round(x * 0.55));
  });

  test("parseColour reads what the style writes", () => {
    expect(parseColour(s.colour("weather:fog"))).toEqual({ r: 154, g: 154, b: 154, a: 80 });
    expect(parseColour("#0a0b0c")).toEqual({ r: 10, g: 11, b: 12, a: 255 });
    expect(parseColour("blue")).toBeUndefined();
  });
});
