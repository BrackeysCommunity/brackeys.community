import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import type { MapCell, MapChunk, MapLive, MapOverlay } from "../../mmo-api/src/index.ts";
import { centreOn, worldToScreen } from "../src/camera.ts";
import { chunkKey } from "../src/chunks.ts";
import {
  buildFrame,
  chunkOps,
  type DrawOp,
  type FrameInput,
  groundFill,
  overlayOps,
  regionOps,
} from "../src/frame.ts";
import { type Axial, hexCentre, hexDistance, hexKey, type Point } from "../src/hex.ts";
import { DEFAULT_LAYERS, type LayerId, LAYERS, LIVE_LAYERS } from "../src/layers.ts";
import { ageDays, liveByHex, mergeTile } from "../src/merge.ts";
import { resolveStyle } from "../src/style.ts";
import { packStyle, syntheticWorld } from "./support.ts";

const style = resolveStyle(packStyle());
const world = syntheticWorld(12, 4);
const view = { width: 1440, height: 900 };

function anchors(op: DrawOp): Point[] {
  switch (op.kind) {
    case "hex":
    case "glyph":
    case "label":
      return [{ x: op.x, y: op.y }];
    case "edge":
      return [{ x: (op.x1 + op.x2) / 2, y: (op.y1 + op.y2) / 2 }];
    case "path":
      return op.points;
  }
}

/** The undiscovered tiles round the world's edge. */
function outside(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius - 3; q <= radius + 3; q++) {
    for (let r = -radius - 3; r <= radius + 3; r++) {
      const d = hexDistance({ q, r }, { q: 0, r: 0 });
      if (d > radius && d <= radius + 3) out.push({ q, r });
    }
  }
  return out;
}

/** No op is drawn on, or nearer than a side to, a hex the inputs lack. */
function expectNothingOn(ops: DrawOp[], absent: Axial[]): void {
  const points = ops.flatMap(anchors);
  for (const h of absent) {
    const c = hexCentre(h, 1);
    for (const p of points) {
      expect(Math.hypot(p.x - c.x, p.y - c.y), `an op on ${hexKey(h)}`).toBeGreaterThan(0.8);
    }
  }
}

function count(ops: DrawOp[], kind: DrawOp["kind"]): number {
  return ops.filter((o) => o.kind === kind).length;
}

function chunkAt(level: "area" | "tile", h: Axial): MapChunk {
  for (const ch of world.chunks.values()) {
    if (ch.level === level && ch.cells.some((c) => c.q === h.q && c.r === h.r)) return ch;
  }
  throw new Error("no chunk");
}

function frameAt(size: number, at: Axial, extra: Partial<FrameInput> = {}) {
  return buildFrame({
    camera: centreOn(at, size),
    view,
    index: world.index,
    regions: world.regions,
    chunks: world.chunks,
    layers: DEFAULT_LAYERS,
    style,
    ...extra,
  });
}

const live = (q: number, r: number, fields: Partial<MapLive>): MapLive => ({
  q,
  r,
  fog: "sight",
  ...fields,
});

function overlay(fields: Partial<MapOverlay>): MapOverlay {
  return { world: "test", tick: 1000, viewer: "character", tiles: [], fronts: [], ...fields };
}

describe("regionOps", () => {
  const ops = regionOps(world.regions, style, DEFAULT_LAYERS);

  test("one hex a discovered tile, in its region's biome", () => {
    const hexes = ops.filter((o) => o.kind === "hex");
    expect(hexes).toHaveLength(world.discovered.size);
    const r0 = style.terrainFill({ terrain: world.regions.regions[0].terrain });
    const at = hexCentre({ q: 1, r: 1 }, 1);
    expect(hexes.find((o) => o.x === at.x && o.y === at.y)).toMatchObject({ fill: r0 });
  });

  test("frontier, region borders, names and places", () => {
    const frontier = style.colour("frontier");
    const border = style.colour("region-border");
    // The disc's rim: 6 sides at each corner tile and 2 along each side.
    const rim = 6 * 3 + 6 * (12 - 1) * 2;
    expect(ops.filter((o) => o.kind === "edge" && o.colour === frontier)).toHaveLength(rim);
    expect(ops.some((o) => o.kind === "edge" && o.colour === border)).toBe(true);
    const labels = ops.filter((o) => o.kind === "label");
    expect(labels.map((l) => l.kind === "label" && l.text)).toEqual([
      "Region 0",
      "Region 1",
      "Region 2",
      "Region 3",
    ]);
    for (const l of labels) {
      if (l.kind === "label") expect(l.minSize).toBeGreaterThan(0);
    }
    // Settlement, city, ruin and faction: an ink mark under each.
    expect(count(ops, "glyph")).toBe(2 * world.regions.places.length);
  });

  test("nothing on an undiscovered tile", () => {
    expectNothingOn(ops, outside(world.radius));
  });

  test("layers off draw less", () => {
    const bare = regionOps(world.regions, style, new Set<LayerId>());
    expect(count(bare, "label")).toBe(0);
    expect(count(bare, "glyph")).toBe(0);
    expect(bare.some((o) => o.kind === "edge" && o.colour === style.colour("region-border"))).toBe(
      false,
    );
    const paper = style.opaque("paper");
    expect(
      bare.filter((o) => o.kind === "hex").every((o) => o.kind === "hex" && o.fill === paper),
    ).toBe(true);
  });
});

describe("chunkOps", () => {
  test("nothing on an undiscovered tile, at either level", () => {
    for (const ch of world.chunks.values()) {
      const ops = chunkOps(ch, ch.level === "tile" ? "tile" : "area", style, DEFAULT_LAYERS);
      expectNothingOn(ops, outside(world.radius));
    }
  });

  test("a chunk draws only its own cells", () => {
    const ch = chunkAt("tile", { q: 0, r: 0 });
    const ops = chunkOps(ch, "tile", style, DEFAULT_LAYERS);
    const mine = new Set(ch.cells.map(hexKey));
    for (const op of ops) {
      if (op.kind !== "hex" && op.kind !== "glyph") continue;
      const near = ch.cells.some((c) => {
        const p = hexCentre(c, 1);
        return Math.hypot(p.x - op.x, p.y - op.y) < 0.8;
      });
      expect(near).toBe(true);
    }
    expect(mine.size).toBe(ch.cells.length);
  });

  test("op counts by level: tile adds borders, sites, structures and names", () => {
    let area = 0;
    let tile = 0;
    for (const ch of world.chunks.values()) {
      const ops = chunkOps(ch, ch.level === "tile" ? "tile" : "area", style, DEFAULT_LAYERS);
      if (ch.level === "area") {
        area += ops.length;
        expect(count(ops, "label")).toBe(0);
        expect(ops.some((o) => o.kind === "edge" && o.colour === style.colour("border"))).toBe(
          false,
        );
      } else tile += ops.length;
    }
    expect(tile).toBeGreaterThan(area);
    const home = chunkOps(chunkAt("tile", { q: 0, r: 0 }), "tile", style, DEFAULT_LAYERS);
    const labels = home.flatMap((o) => (o.kind === "label" ? [o.text] : []));
    expect(labels).toContain("Rustwater");
    expect(labels).toContain("The Long Road");
    const homeArea = chunkOps(chunkAt("area", { q: 0, r: 0 }), "area", style, DEFAULT_LAYERS);
    expect(count(homeArea, "hex")).toBe(count(home, "hex"));
    // Two structures at home are pips at tile level only.
    expect(count(home, "glyph")).toBeGreaterThan(count(homeArea, "glyph"));
  });

  test("every frontier side the edge mask names, and only those", () => {
    const frontier = style.colour("frontier");
    for (const ch of world.chunks.values()) {
      if (ch.level !== "area") continue;
      const bits = ch.cells.reduce(
        (n, c) => n + (c.edge ?? 0).toString(2).replaceAll("0", "").length,
        0,
      );
      const ops = chunkOps(ch, "area", style, DEFAULT_LAYERS);
      expect(ops.filter((o) => o.kind === "edge" && o.colour === frontier)).toHaveLength(bits);
    }
  });

  test("standing water, rivers, ecotones and city tiles", () => {
    const lake = world.cells.get("-9,2");
    expect(lake && groundFill(lake, style, DEFAULT_LAYERS)).toBe(style.opaque("water:lake"));
    const eco = world.cells.get("2,0");
    expect(eco && groundFill(eco, style, DEFAULT_LAYERS)).toBe(
      style.terrainFill({ terrain: eco?.terrain ?? "", secondary: "forest", blend: 30 }),
    );
    const river = chunkOps(chunkAt("area", { q: 0, r: 4 }), "area", style, DEFAULT_LAYERS);
    expect(river.some((o) => o.kind === "path" && o.colour === style.opaque("water:river"))).toBe(
      true,
    );
    const city = chunkOps(chunkAt("area", { q: 6, r: -2 }), "area", style, DEFAULT_LAYERS);
    expect(city.some((o) => o.kind === "hex" && o.fill === style.colour("place:city-tile"))).toBe(
      true,
    );
  });
});

describe("overlayOps", () => {
  const cells = world.cells;

  test("an anonymous or player overlay draws nothing", () => {
    for (const viewer of ["anonymous", "player"]) {
      const o = overlay({ viewer });
      expect(overlayOps(o, cells, style, DEFAULT_LAYERS, 144)).toEqual([]);
      const f = frameAt(14, { q: 0, r: 0 }, { overlay: o });
      expect(f.live).toEqual([]);
      expect(f.base.length).toBeGreaterThan(0);
    }
  });

  test("a live tile, front or self with no cell under it draws nothing", () => {
    const far = { q: 40, r: 0 };
    const o = overlay({
      tiles: [live(far.q, far.r, { threat: 300, danger: true, trouble: "raid", busy: "crowded" })],
      fronts: [{ kind: "storm", q: far.q, r: far.r, heading: "e" }],
    });
    expect(overlayOps(o, cells, style, DEFAULT_LAYERS, 144)).toEqual([]);
    expect(overlayOps(o, new Map(), style, DEFAULT_LAYERS, 144)).toEqual([]);
  });

  test("the own tile draws from Self's cell while nobody has found it", () => {
    const own: MapCell = { q: 13, r: 0, terrain: "hills" };
    const o = overlay({
      self: { character: "c1", q: 13, r: 0, cell: own },
      tiles: [live(13, 0, {})],
    });
    const ops = overlayOps(o, cells, style, DEFAULT_LAYERS, 144);
    const at = hexCentre(own, 1);
    expect(ops[0]).toEqual({
      kind: "hex",
      x: at.x,
      y: at.y,
      size: 1,
      fill: style.terrainFill(own),
    });
    expect(count(ops, "glyph")).toBe(2);
    const others = outside(world.radius).filter((h) => !(h.q === 13 && h.r === 0));
    expectNothingOn(ops, others);
  });

  test("in sight: marks solid and a rim; last seen: dimmed with dotted marks", () => {
    const o = overlay({
      tiles: [
        live(0, 0, { trouble: "raid", busy: "busy", threat: 200 }),
        live(1, 0, { threat: 100, danger: true }),
        live(4, 0, { fog: "seen", left: 700, trouble: "raid", threat: 400 }),
      ],
    });
    const ops = overlayOps(o, cells, style, DEFAULT_LAYERS, 144);
    const seenAt = hexCentre({ q: 4, r: 0 }, 1);
    expect(ops).toContainEqual({
      kind: "hex",
      x: seenAt.x,
      y: seenAt.y,
      size: 1,
      fill: style.veil,
    });
    const glyphs = ops.filter((op) => op.kind === "glyph");
    const near = (op: DrawOp, h: Axial) => {
      const p = hexCentre(h, 1);
      return anchors(op).some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 0.9);
    };
    const seenMarks = glyphs.filter((g) => near(g, { q: 4, r: 0 }));
    expect(seenMarks.length).toBeGreaterThan(0);
    for (const g of seenMarks) expect(g).toMatchObject({ pattern: "dots" });
    const sightMarks = glyphs.filter((g) => near(g, { q: 0, r: 0 }));
    expect(sightMarks).toHaveLength(1 + 2);
    for (const g of sightMarks) expect(g).not.toHaveProperty("pattern");
    // The highest threat in the overlay tints at the style's own alpha.
    expect(ops).toContainEqual(
      expect.objectContaining({
        kind: "hex",
        fill: style.colourAt("layer:threat", style.alpha("layer:threat")),
        pattern: "dots",
      }),
    );
    // The rim goes round the two in-sight tiles only: 10 sides.
    const rim = ops.filter((op) => op.kind === "edge" && op.colour === style.opaque("fog:sight"));
    expect(rim).toHaveLength(10);
    expectNothingOn(ops, outside(world.radius));
  });

  test("weather, fronts, self and route by layer", () => {
    const o = overlay({
      self: {
        character: "c1",
        q: 0,
        r: 0,
        route: [
          { q: 1, r: 0 },
          { q: 2, r: 0 },
        ],
      },
      tiles: [live(0, 0, { weather: "storm" }), live(1, 0, { weather: "clear" })],
      fronts: [{ kind: "storm", q: 0, r: 0, heading: "ne" }],
    });
    const all = overlayOps(o, cells, style, DEFAULT_LAYERS, 144);
    expect(
      all.filter((op) => op.kind === "hex" && op.fill === style.colour("weather:storm")),
    ).toHaveLength(1);
    expect(
      all.filter((op) => op.kind === "path" && op.colour === style.opaque("weather:storm")),
    ).toHaveLength(2);
    expect(all.some((op) => op.kind === "path" && op.colour === style.opaque("layer:route"))).toBe(
      true,
    );
    expect(all.some((op) => op.kind === "glyph" && op.colour === style.colour("layer:self"))).toBe(
      true,
    );
    const none = overlayOps(o, cells, style, new Set<LayerId>(), 144);
    expect(none.every((op) => op.kind === "edge" && op.colour === style.opaque("fog:sight"))).toBe(
      true,
    );
  });
});

describe("buildFrame", () => {
  test("op counts by level", () => {
    const region = frameAt(2, { q: 0, r: 0 });
    expect(region.level).toBe("region");
    expect(region.base).toHaveLength(1);
    expect(count(region.base[0].ops, "hex")).toBe(world.discovered.size);

    const area = frameAt(6, { q: 0, r: 0 });
    expect(area.level).toBe("area");
    const tile = frameAt(14, { q: 0, r: 0 });
    expect(tile.level).toBe("tile");
    const ops = (f: typeof area) => f.base.flatMap((b) => b.ops);
    expect(area.base.every((b) => b.key.startsWith("area/"))).toBe(true);
    expect(tile.base.every((b) => b.key.startsWith("tile/"))).toBe(true);
    expect(count(ops(area), "label")).toBe(0);
    expect(count(ops(tile), "label")).toBeGreaterThan(0);
    // The whole small world is in view at area size 6.
    expect(count(ops(area), "hex")).toBe(world.discovered.size + 2);
  });

  test("a chunk not fetched yet is not drawn", () => {
    const f = frameAt(14, { q: 0, r: 0 }, { chunks: new Map() });
    expect(f.base).toEqual([]);
    expect(f.hit(view.width / 2, view.height / 2)).toBeUndefined();
  });

  test("base lists are reused for the same payload, layers and style", () => {
    const a = frameAt(14, { q: 0, r: 0 });
    const b = frameAt(14, { q: 0.2, r: 0 });
    const key = a.base[0].key;
    expect(b.base.find((x) => x.key === key)?.ops).toBe(a.base[0].ops);
    const c = frameAt(14, { q: 0, r: 0 }, { layers: new Set<LayerId>(["terrain"]) });
    expect(c.base.find((x) => x.key.split("|")[0] === key.split("|")[0])?.key).not.toBe(key);
  });

  test("hit returns the tile as merged, and nothing on an undiscovered tile", () => {
    const tiles = [live(1, 0, { threat: 50 })];
    const o = overlay({ tiles });
    const f = frameAt(14, { q: 0, r: 0 }, { overlay: o });
    const camera = centreOn({ q: 0, r: 0 }, 14);
    const at = (h: Axial) => {
      const p = hexCentre(h, 1);
      return worldToScreen(camera, view, p.x, p.y);
    };
    const one = at({ q: 1, r: 0 });
    const cell = world.chunks
      .get(chunkKey({ a: 0, b: 0 }, "tile", "tile-0.0"))
      ?.cells.find((c) => c.q === 1 && c.r === 0);
    expect(cell).toBeDefined();
    expect(f.hit(one.x, one.y)).toEqual(mergeTile(cell as MapCell, tiles[0]));
    const home = at({ q: 0, r: 0 });
    expect(f.hit(home.x, home.y)?.fog).toBe("discovered");
    const edge = at({ q: 13, r: 0 });
    expect(f.hit(edge.x, edge.y)).toBeUndefined();
  });

  test("hit at region level reads the region", () => {
    const f = frameAt(2, { q: 0, r: 0 });
    expect(f.hit(view.width / 2, view.height / 2)?.cell).toMatchObject({ region: "region:0" });
  });

  test("a server's masks rename labels for this viewer only", () => {
    const o = overlay({ names: { "place:0": "Masked" } });
    const masked = frameAt(14, { q: 0, r: 0 }, { overlay: o });
    const plain = frameAt(14, { q: 0, r: 0 });
    const texts = (f: typeof plain) =>
      f.base.flatMap((b) => b.ops.flatMap((op) => (op.kind === "label" ? [op.text] : [])));
    expect(texts(masked)).toContain("Masked");
    expect(texts(masked)).not.toContain("Rustwater");
    expect(texts(plain)).toContain("Rustwater");
  });
});

describe("merge", () => {
  test("fog is the live tile's, else discovered, as Go's Merge", () => {
    const cell: MapCell = { q: 0, r: 0, terrain: "plain" };
    expect(mergeTile(cell, undefined)).toEqual({ cell, fog: "discovered" });
    expect(mergeTile(cell, undefined)).not.toHaveProperty("live");
    const seen = live(0, 0, { fog: "seen", left: 3 });
    expect(mergeTile(cell, seen)).toEqual({ cell, fog: "seen", live: seen });
  });

  test("liveByHex and ageDays", () => {
    const o = overlay({ tiles: [live(1, 2, {}), live(-3, 4, { fog: "seen", left: 1 })] });
    expect([...liveByHex(o).keys()]).toEqual(["1,2", "-3,4"]);
    expect(ageDays(1000, 1000, 144)).toBe(0);
    expect(ageDays(1000, 857, 144)).toBe(0);
    expect(ageDays(1000, 856, 144)).toBe(1);
    expect(ageDays(1000, 700, 144)).toBe(2);
    expect(ageDays(1000, 1200, 144)).toBe(0);
    expect(ageDays(1000, 0, 0)).toBe(0);
  });
});

describe("layers", () => {
  test("live layers are a subset, and all are on by default", () => {
    for (const l of LIVE_LAYERS) expect(LAYERS).toContain(l);
    expect([...DEFAULT_LAYERS]).toEqual([...LAYERS]);
  });
});

describe("the module", () => {
  const dir = new URL("../src/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  test("touches the DOM only in draw.ts", () => {
    const dom =
      /\b(document|window|HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas|CanvasImageSource)\b/;
    for (const f of files) {
      if (f === "draw.ts") continue;
      expect(dom.test(readFileSync(new URL(f, dir), "utf8")), f).toBe(false);
    }
  });

  test("imports nothing but itself and the wire's types", () => {
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8");
      for (const m of src.matchAll(/from "([^"]+)"/g)) {
        expect(
          m[1].startsWith("./") || m[1] === "../../mmo-api/src/index.ts",
          `${f}: ${m[1]}`,
        ).toBe(true);
      }
    }
  });

  test("index.ts leaves draw.ts out", () => {
    expect(readFileSync(new URL("index.ts", dir), "utf8")).not.toContain('from "./draw.ts"');
  });
});
