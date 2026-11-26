// A small synthetic world in the wire's shapes, and the pack's own style,
// for the tests.

import { readFileSync } from "node:fs";

import type {
  MapCell,
  MapChunk,
  MapChunkRef,
  MapIndex,
  MapRegions,
  MapRow,
  MapStyle,
  MapStyleEntry,
  MapViewNumbers,
} from "../../mmo-api/src/index.ts";
import { chunkKey } from "../src/chunks.ts";
import { type Axial, DIRECTIONS, hexDistance, hexKey, neighbour } from "../src/hex.ts";

const PACK = new URL("../../../services/mmo-world/packs/wasteland/", import.meta.url);
const FAMILIES = ["terrain", "water", "weather", "fog", "layer", "place", "site"];

function sheet<T>(name: string): T[] {
  return (JSON.parse(readFileSync(new URL(name, PACK), "utf8")) as { rows: T[] }).rows;
}

/** pack.map-style and pack.map-view as the world serves them on /v1/map/style. */
export function packStyle(): MapStyle {
  const entries: MapStyleEntry[] = sheet<MapStyleEntry & { note?: string }>("map-style.json").map(
    ({ id, colour, alpha, glyph, pattern }) => {
      const family = FAMILIES.find((f) => id.startsWith(`${f}-`));
      const mapId = family ? `${family}:${id.slice(family.length + 1)}` : id;
      return { id: mapId, colour, alpha, glyph, pattern };
    },
  );
  const n = new Map(
    sheet<{ id: string; value: number }>("map-view.json").map((r) => [r.id, r.value]),
  );
  const view: MapViewNumbers = {
    seenDim: n.get("seen-dim") ?? 0,
    zoomArea: n.get("zoom-area") ?? 0,
    zoomTile: n.get("zoom-tile") ?? 0,
    zoomMin: n.get("zoom-min") ?? 0,
    zoomMax: n.get("zoom-max") ?? 0,
    blendMax: n.get("blend-max") ?? 0,
  };
  return { rev: "style-rev", entries, view };
}

export interface World {
  index: MapIndex;
  regions: MapRegions;
  /** Both levels of every chunk, by chunkKey. */
  chunks: Map<string, MapChunk>;
  /** Every discovered tile at tile level, by hexKey. */
  cells: Map<string, MapCell>;
  discovered: Set<string>;
  radius: number;
}

const TERRAINS = ["plain", "forest", "hills", "marsh", "flats"];

/** The chunk centre of the world's lattice: A·(2n+1, −n) + B·(n, n+1). */
export function chunkCentre(a: number, b: number, n: number): Axial {
  return { q: a * (2 * n + 1) + b * n, r: -a * n + b * (n + 1) };
}

export function chunkOf(h: Axial, n: number, span = 8): { a: number; b: number } {
  for (let a = -span; a <= span; a++) {
    for (let b = -span; b <= span; b++) {
      if (hexDistance(chunkCentre(a, b, n), h) <= n) return { a, b };
    }
  }
  throw new Error(`no chunk holds ${hexKey(h)}`);
}

const AREA_FIELDS = [
  "q",
  "r",
  "terrain",
  "secondary",
  "blend",
  "water",
  "region",
  "edge",
  "road",
  "place",
] as const;

/**
 * Every tile within radius of 0,0 is discovered; four regions by quadrant;
 * a settlement, a city with its tiles, a ruin, a faction city, two sites, a
 * named road, a river and an ecotone.
 */
export function syntheticWorld(radius = 12, chunkRadius = 4): World {
  const discovered = new Set<string>();
  const cells = new Map<string, MapCell>();
  const inDisc = (h: Axial) => hexDistance(h, { q: 0, r: 0 }) <= radius;
  const regionOf = (h: Axial) => (h.q >= 0 ? 0 : 1) + (h.r >= 0 ? 0 : 2);
  const places: Record<string, Partial<MapCell>> = {
    "0,0": {
      place: "settlement",
      placeRef: "place:0",
      guild: "guild:1",
      structures: ["wall", "well"],
    },
    "5,-2": { place: "city", placeRef: "place:1", guild: "guild:2" },
    "6,-2": { place: "city-tile", guild: "guild:2" },
    "5,-1": { place: "city-tile", guild: "guild:2" },
    "-4,4": { place: "ruin", placeRef: "place:2" },
    "-6,0": { place: "faction", placeRef: "place:3" },
    "3,3": { site: "dungeon", siteKind: "dungeon" },
    "-2,-5": { site: "site", siteKind: "cache" },
    "2,-7": { landmark: "landmark:spire" },
  };
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const h = { q, r };
      if (!inDisc(h)) continue;
      const k = hexKey(h);
      discovered.add(k);
      let edge = 0;
      DIRECTIONS.forEach((_, d) => {
        if (!inDisc(neighbour(h, d))) edge |= 1 << d;
      });
      const cell: MapCell = {
        q,
        r,
        terrain:
          TERRAINS[(((q * 7 + r * 3) % TERRAINS.length) + TERRAINS.length) % TERRAINS.length],
        region: `region:${regionOf(h)}`,
        ...(edge ? { edge } : {}),
        ...(q === 2 ? { secondary: "forest", blend: 30 } : {}),
        ...(r === 4 && q > -8 && q < 4 ? { water: "river" } : {}),
        ...(q === -9 && r === 2 ? { water: "lake" } : {}),
        ...(r === 0 && q >= -6 && q <= 6
          ? { road: q === 0 ? 2 : 1, roadName: "The Long Road" }
          : {}),
        found: 1 + ((q + r + 2 * radius) % 5),
        ...places[k],
      };
      cells.set(k, cell);
    }
  }
  const byChunk = new Map<string, { a: number; b: number; cells: MapCell[] }>();
  for (const cell of cells.values()) {
    const c = chunkOf(cell, chunkRadius);
    const id = `${c.a}.${c.b}`;
    const entry = byChunk.get(id) ?? { ...c, cells: [] };
    entry.cells.push(cell);
    byChunk.set(id, entry);
  }
  const names: Record<string, string> = {
    "place:0": "Rustwater",
    "place:1": "Ironhold",
    "place:2": "Old Ashby",
    "place:3": "The Spire",
    "guild:1": "Lanterns",
    "guild:2": "Wardens",
  };
  const chunks = new Map<string, MapChunk>();
  const refs: MapChunkRef[] = [];
  for (const { a, b, cells: list } of [...byChunk.values()].sort(
    (x, y) => x.a - y.a || x.b - y.b,
  )) {
    list.sort((x, y) => x.r - y.r || x.q - y.q);
    const ref: MapChunkRef = {
      a,
      b,
      centre: chunkCentre(a, b, chunkRadius),
      tiles: list.length,
      area: `area-${a}.${b}`,
      tile: `tile-${a}.${b}`,
    };
    refs.push(ref);
    const used: Record<string, string> = {};
    for (const c of list) {
      for (const n of [c.placeRef, c.guild]) if (n && names[n]) used[n] = names[n];
    }
    const area = list.map((c) => {
      const out: Record<string, unknown> = {};
      for (const f of AREA_FIELDS) if (c[f] !== undefined) out[f] = c[f];
      return out as unknown as MapCell;
    });
    chunks.set(chunkKey(ref, "area", ref.area), {
      world: "test",
      a,
      b,
      level: "area",
      rev: ref.area,
      cells: area,
      names: used,
    });
    chunks.set(chunkKey(ref, "tile", ref.tile), {
      world: "test",
      a,
      b,
      level: "tile",
      rev: ref.tile,
      cells: list,
      names: used,
    });
  }
  const rows: MapRow[] = [];
  for (let r = -radius; r <= radius; r++) {
    const q0 = Math.max(-radius, -r - radius);
    const q1 = Math.min(radius, -r + radius);
    const slots: number[] = [];
    for (let q = q0; q <= q1; q++) slots.push(regionOf({ q, r }));
    rows.push({ r, q: q0, slots });
  }
  const anchors = [
    { q: 4, r: 4 },
    { q: -4, r: 4 },
    { q: 4, r: -4 },
    { q: -4, r: -4 },
  ];
  const regions: MapRegions = {
    world: "test",
    rev: "regions-rev",
    regions: anchors.map((anchor, i) => ({
      ref: `region:${i}`,
      terrain: TERRAINS[i],
      anchor,
      tiles: [...cells.values()].filter((c) => c.region === `region:${i}`).length,
      name: `Region ${i}`,
    })),
    rows,
    places: [...cells.values()]
      .filter((c) => c.place && c.place !== "city-tile")
      .map((c) => ({ q: c.q, r: c.r, place: c.place ?? "" })),
  };
  const index: MapIndex = {
    world: "test",
    tick: 1000,
    ticksPerDay: 144,
    tickSeconds: 600,
    chunkRadius,
    tiles: cells.size,
    home: { q: 0, r: 0 },
    style: "style-rev",
    regions: regions.rev,
    chunks: refs,
  };
  return { index, regions, chunks, cells, discovered, radius };
}
