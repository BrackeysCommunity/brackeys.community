import { DEFAULT_LENGTH_UNIT } from "../../game/defaults";
import type { TilesetFile } from "../../project/kinds/tileset";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { paintGrid } from "../../scene/grid";
import {
  SCENE_FORMAT_VERSION,
  type CellEdit,
  type CellRect,
  type EntityDef,
  type Pt,
  type SceneDefinition,
  type ShapeTuple,
} from "../../scene/types";

export type GeneratedCounts = {
  /** Solids in the top-level `solid` bulk array. */
  bulkSolids: number;
  /** Solid entities: rotated boxes, one-way ledges, capsules, polygons and chains. */
  solids: number;
  props: number;
  sensors: number;
  followers: number;
};

/** 300 colliders: one per solid, prop, sensor and follower. */
export const DEFAULT_COUNTS: GeneratedCounts = {
  bulkSolids: 160,
  solids: 40,
  props: 50,
  sensors: 30,
  followers: 20,
};

export const colliderCount = (c: GeneratedCounts) =>
  c.bulkSolids + c.solids + c.props + c.sensors + c.followers;

const CELL_W = 200;
const CELL_H = 160;
const COLUMNS = 30;

/** mulberry32: small, fast and the same on every platform. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A primitives-only scene with one collider per generated entity, each in a
 * cell of its own so nothing overlaps. The same seed always gives the same scene.
 */
export function generateScene(seed = 1, counts: GeneratedCounts = DEFAULT_COUNTS): SceneDefinition {
  const rand = seeded(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const cells = colliderCount(counts) + 1;
  const rows = Math.ceil(cells / COLUMNS);
  let next = 0;
  const cell = (): Pt => {
    const i = next++;
    return [(i % COLUMNS) * CELL_W + CELL_W / 2, Math.floor(i / COLUMNS) * CELL_H + CELL_H / 2];
  };

  const bulk: ShapeTuple[] = [];
  for (let i = 0; i < counts.bulkSolids; i++) {
    const [x, y] = cell();
    bulk.push(["box", x, y + 50, int(40, 90), int(6, 20)]);
  }

  const entities: EntityDef[] = [];
  for (let i = 0; i < counts.solids; i++) {
    const [x, y] = cell();
    const id = `solid-${i}`;
    switch (i % 5) {
      case 0:
        entities.push({
          id,
          type: "solid",
          shape: ["box", x, y, int(30, 80), int(6, 14), int(-30, 30)],
        });
        break;
      case 1:
        entities.push({ id, type: "solid", shape: ["box", x, y, int(40, 90), 8], oneWay: true });
        break;
      case 2:
        entities.push({
          id,
          type: "solid",
          shape: ["capsule", x, y, int(20, 50), int(8, 16), int(0, 90)],
        });
        break;
      case 3:
        entities.push({
          id,
          type: "solid",
          shape: ["poly", x - 60, y + 30, x + 60, y + 30, x + int(-20, 20), y - int(20, 50)],
        });
        break;
      default:
        entities.push({
          id,
          type: "solid",
          shape: [
            "chain",
            x - 80,
            y + 40,
            x - 20,
            y + int(0, 30),
            x + 20,
            y + int(0, 30),
            x + 80,
            y + 40,
          ],
        });
    }
  }

  for (let i = 0; i < counts.props; i++) {
    const [x, y] = cell();
    const shape: ShapeTuple =
      i % 2 === 0 ? ["box", x, y, int(8, 24), int(8, 24)] : ["circle", x, y, int(8, 24)];
    entities.push({
      id: `prop-${i}`,
      type: "prop",
      shape,
      density: int(1, 4),
      restitution: int(0, 5) / 10,
    });
  }

  for (let i = 0; i < counts.sensors; i++) {
    const [x, y] = cell();
    entities.push({
      id: `sensor-${i}`,
      type: "sensor",
      shape: i % 3 === 0 ? ["circle", x, y, int(20, 40)] : ["box", x, y, int(20, 60), int(20, 40)],
      tags: [`zone-${i % 4}`],
    });
  }

  for (let i = 0; i < counts.followers; i++) {
    const [x, y] = cell();
    const reach = int(20, 60);
    entities.push({
      id: `follower-${i}`,
      type: "follower",
      shape: ["box", 0, 0, int(20, 30), 6],
      path: {
        pts: [
          [x - reach, y],
          [x + reach, y],
        ],
        mode: i % 2 === 0 ? "ping_pong" : "loop",
        speed: int(40, 120),
        pauseMs: int(0, 4) * 100,
      },
    });
  }

  entities.push({ id: "start", type: "marker", at: cell(), tags: ["spawn"] });

  return {
    v: 1,
    name: `generated-${seed}`,
    bounds: [0, 0, COLUMNS * CELL_W, rows * CELL_H],
    settings: { gravity: [0, 1200] },
    solid: bulk,
    entities,
  };
}

/** The shares of a `generateLargeScene` scene's entities. */
export type LargeMix = { solids: number; sensors: number; followers: number };

/** `large-5k`: 5,000 entities, 60% static solids, 30% sensors, 10% followers. */
export const LARGE_5K: LargeMix = { solids: 3000, sensors: 1500, followers: 500 };

const LARGE_COLUMNS = 100;
const LARGE_CELL_W = 2;
const LARGE_CELL_H = 1.6;

/**
 * A metric scene in the current format with one top-level entity per cell
 * so nothing overlaps: static solids, sensors (load only; nothing listens
 * without a game) and followers on short paths. `physics: "none"` gives the
 * physics-free twin, run on the geometry backend. Same seed, same scene.
 */
export function generateLargeScene(
  seed = 1,
  mix: LargeMix = LARGE_5K,
  physics: "rapier" | "none" = "rapier",
): SceneDefinition {
  const rand = seeded(seed);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  const total = mix.solids + mix.sensors + mix.followers;
  const rows = Math.ceil(total / LARGE_COLUMNS);
  let next = 0;
  const cell = (): Pt => {
    const i = next++;
    return [
      Math.round(((i % LARGE_COLUMNS) * LARGE_CELL_W + LARGE_CELL_W / 2) * 100) / 100,
      Math.round((Math.floor(i / LARGE_COLUMNS) * LARGE_CELL_H + LARGE_CELL_H / 2) * 100) / 100,
    ];
  };

  const entities: EntityDef[] = [];
  for (let i = 0; i < mix.solids; i++) {
    const [x, y] = cell();
    entities.push({
      id: `solid-${i}`,
      type: "solid",
      shape:
        i % 4 === 3
          ? ["circle", x, y, between(0.1, 0.3)]
          : ["box", x, y, between(0.2, 0.8), between(0.05, 0.2)],
    });
  }
  for (let i = 0; i < mix.sensors; i++) {
    const [x, y] = cell();
    entities.push({
      id: `sensor-${i}`,
      type: "sensor",
      shape: ["box", x, y, between(0.2, 0.6), between(0.2, 0.4)],
      tags: [`zone-${i % 4}`],
    });
  }
  for (let i = 0; i < mix.followers; i++) {
    const [x, y] = cell();
    const reach = between(0.2, 0.6);
    entities.push({
      id: `follower-${i}`,
      type: "follower",
      shape: ["box", 0, 0, between(0.2, 0.3), 0.06],
      path: {
        pts: [
          [Math.round((x - reach) * 100) / 100, y],
          [Math.round((x + reach) * 100) / 100, y],
        ],
        mode: i % 2 === 0 ? "ping_pong" : "loop",
        speed: between(0.4, 1.2),
        pauseMs: (i % 5) * 100,
      },
    });
  }

  return {
    v: SCENE_FORMAT_VERSION,
    name: physics === "none" ? "large-5k-geometry" : "large-5k",
    bounds: [0, 0, LARGE_COLUMNS * LARGE_CELL_W, Math.round(rows * LARGE_CELL_H * 100) / 100],
    settings: { gravity: [0, 12], ...(physics === "none" ? { physics } : {}) },
    entities,
  };
}

/** `tilemap-512`'s side, in cells. */
export const TILEMAP_SIZE = 512;
/** Its grid's cell, metres: one 32 px tile at the default px per metre. */
export const TILEMAP_CELL = 0.32;
const TILEMAP_TILE_PX = Math.round(TILEMAP_CELL * DEFAULT_LENGTH_UNIT);
const TILEMAP_TILESET = "tileset-512";
const TILEMAP_IMAGE = "texture-512";
/** Rows between `tilemap-512`'s ledges; the floor is its last `TILEMAP_FLOOR` rows. */
const TILEMAP_LEDGE_EVERY = 32;
const TILEMAP_FLOOR = 8;
/** Bodies dropped onto the map, so the ticks have contacts to solve. */
export const TILEMAP_PROPS = 40;

/** The tileset `tilemap-512` draws from: rock (solid), moss on top of it (solid), grass (decor). */
export const TILEMAP_TILESET_FILE: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: TILEMAP_IMAGE,
  tile: [TILEMAP_TILE_PX, TILEMAP_TILE_PX],
  columns: 4,
  tiles: [{ id: 0, solid: true }, { id: 1, solid: true }, { id: 2 }],
};

/** The in-memory project `tilemap-512` loads against: its tileset and the tileset's 4 × 1 texture. */
export function tilemapProject(): ProjectRuntimeView {
  return {
    settings: {},
    engine: {},
    table: () => [],
    asset: (id) =>
      id === TILEMAP_IMAGE
        ? {
            id,
            kind: "texture",
            sha256: "a".repeat(64),
            size: [TILEMAP_TILE_PX * 4, TILEMAP_TILE_PX],
          }
        : undefined,
    inputMap: null,
    doc: (<T>(kind: string, id: string) =>
      kind === "tileset" && id === TILEMAP_TILESET
        ? (TILEMAP_TILESET_FILE as T)
        : undefined) as ProjectRuntimeView["doc"],
    docs: () => [],
  };
}

/**
 * `tilemap-512`: one 512 × 512 tilemap on a 0.32 m grid (256 chunks), a
 * solid floor, a ledge every 32 rows with gaps at seeded columns, grass
 * scattered over the open cells, and props dropped onto the ledges. Its
 * solids are long runs, so the merged colliders stay a few per chunk. Same
 * seed, same scene.
 */
export function generateTilemapScene(seed = 1): SceneDefinition {
  const rand = seeded(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const ROCK = 1;
  const MOSS = 2;
  const GRASS = 3;
  const last = TILEMAP_SIZE - 1;
  const rects: CellRect[] = [
    [0, TILEMAP_SIZE - TILEMAP_FLOOR + 1, last, last, ROCK],
    [0, TILEMAP_SIZE - TILEMAP_FLOOR, last, TILEMAP_SIZE - TILEMAP_FLOOR, MOSS],
  ];
  for (
    let row = TILEMAP_LEDGE_EVERY;
    row < TILEMAP_SIZE - TILEMAP_FLOOR;
    row += TILEMAP_LEDGE_EVERY
  ) {
    let col = 0;
    while (col < TILEMAP_SIZE) {
      const run = int(24, 96);
      const end = Math.min(last, col + run - 1);
      rects.push([col, row, end, row, MOSS], [col, row + 1, end, row + 2, ROCK]);
      col = end + 1 + int(3, 8);
    }
  }
  const cells: CellEdit[] = [];
  for (let i = 0; i < 4096; i++) {
    const row = int(0, TILEMAP_SIZE - TILEMAP_FLOOR - 1);
    if (row % TILEMAP_LEDGE_EVERY === 0 || row % TILEMAP_LEDGE_EVERY > TILEMAP_LEDGE_EVERY - 3)
      continue;
    cells.push([int(0, last), row, GRASS]);
  }
  const grid = paintGrid({}, { rects, cells }).grid;
  const side = Math.round(TILEMAP_SIZE * TILEMAP_CELL * 100) / 100;

  const entities: EntityDef[] = [
    { id: "tiles", type: "tilemap", at: [0, 0], tileset: TILEMAP_TILESET, cells: grid },
  ];
  for (let i = 0; i < TILEMAP_PROPS; i++) {
    const x = Math.round((int(1, last - 1) + 0.5) * TILEMAP_CELL * 100) / 100;
    const ledge = TILEMAP_LEDGE_EVERY * int(1, TILEMAP_SIZE / TILEMAP_LEDGE_EVERY - 1);
    const y = Math.round((ledge - 4) * TILEMAP_CELL * 100) / 100;
    entities.push({
      id: `prop-${i}`,
      type: "prop",
      shape: ["box", x, y, 0.4, 0.4],
      density: 1,
      restitution: 0,
    });
  }
  entities.push({ id: "start", type: "marker", at: [side / 2, 1], tags: ["spawn"] });

  return {
    v: SCENE_FORMAT_VERSION,
    name: "tilemap-512",
    bounds: [0, 0, side, side],
    settings: { gravity: [0, 12], grid: { kind: "square", cell: [TILEMAP_CELL, TILEMAP_CELL] } },
    entities,
  };
}
