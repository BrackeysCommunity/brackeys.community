import {
  SCENE_FORMAT_VERSION,
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
