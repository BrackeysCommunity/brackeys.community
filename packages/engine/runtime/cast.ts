import type { EngineContext, SpawnShape } from "../game/types";
import type { Bounds, ShapeObj } from "../scene/types";
import { roundLength } from "../scene/units";
import type { Vec2 } from "../types";

export type CastResult = { ok: true; at: Vec2 } | { ok: false; error: string };

export type CastSpawnOptions = {
  /** Entity ids whose colliders neither block the start nor stop the cast: the actor being placed. */
  exclude?: readonly string[];
};

/**
 * Every collision group, as a query filter: a query passing it skips only
 * colliders gated off with collision groups 0 (attached one-way solids).
 * Rapier applies collision groups to a query only through its `filterGroups`.
 */
export const ALL_GROUPS = 0xffff_ffff;

/**
 * Geometry sweeps after the first: each searches the last one's bracket
 * around the contact, until the bracket is under `CAST_PRECISION` m.
 */
const CAST_REFINES = 4;
const CAST_PRECISION = 1e-8;
const SWEEP_RESOLUTION = 1024;

function shapeAt(shape: SpawnShape, at: Vec2): ShapeObj {
  switch (shape.type) {
    case "box":
      return { type: "box", cx: at.x, cy: at.y, hw: shape.hw, hh: shape.hh, rotDeg: 0 };
    case "circle":
      return { type: "circle", cx: at.x, cy: at.y, r: shape.r };
    case "capsule":
      return { type: "capsule", cx: at.x, cy: at.y, halfLen: shape.halfLen, r: shape.r, rotDeg: 0 };
  }
}

function unit(x: number, y: number): Vec2 | null {
  const len = Math.sqrt(x * x + y * y);
  return len === 0 || !Number.isFinite(len) ? null : { x: x / len, y: y / len };
}

/** The unit direction `shape` settles along in `ctx`, or null when it stays put. */
function castDirection(ctx: Pick<EngineContext, "gravity">, shape: SpawnShape): Vec2 | null {
  const cast = shape.cast ?? "gravity";
  if (cast === "none") return null;
  if (cast === "gravity") return unit(ctx.gravity.x, ctx.gravity.y);
  return unit(cast[0], cast[1]);
}

/** How far `at` can travel along the unit `dir` before leaving `bounds`; 0 when outside. */
function reach(at: Vec2, dir: Vec2, [minX, minY, maxX, maxY]: Bounds): number {
  let t = Infinity;
  if (dir.x > 0) t = Math.min(t, (maxX - at.x) / dir.x);
  else if (dir.x < 0) t = Math.min(t, (minX - at.x) / dir.x);
  if (dir.y > 0) t = Math.min(t, (maxY - at.y) / dir.y);
  else if (dir.y < 0) t = Math.min(t, (minY - at.y) / dir.y);
  return t > 0 && Number.isFinite(t) ? t : 0;
}

/**
 * How far along the unit `dir` the shape at `at` travels free before it
 * touches a non-sensor collider, within `distance`; null when it never does.
 * A geometry sweep resolves only 1/1024 of its length, so on that backend
 * the contact is refined by shorter sweeps from the last one's stop.
 */
function travel(
  space: EngineContext["space"],
  at: Vec2,
  dir: Vec2,
  distance: number,
  shape: SpawnShape,
  exclude: readonly string[],
): number | null {
  const sweep = (from: Vec2, length: number) =>
    space.sweep(shapeAt(shape, from), { x: dir.x * length, y: dir.y * length }, { exclude });
  const hit = sweep(at, distance);
  if (!hit) return null;
  let travelled = hit.toi * distance;
  if (space.backend !== "geometry") return travelled;
  let length = distance;
  for (let i = 0; i < CAST_REFINES; i++) {
    length = length / SWEEP_RESOLUTION;
    if (length < CAST_PRECISION) break;
    const next = sweep({ x: at.x + dir.x * travelled, y: at.y + dir.y * travelled }, length);
    if (!next || next.toi === 0) break;
    travelled += next.toi * length;
  }
  return travelled;
}

/**
 * Where an actor of `shape` placed at `at` comes to rest: carried along its
 * `cast` direction (gravity's by default) onto the first non-sensor collider,
 * within the scene's bounds, on either backend. Refused when the shape
 * already overlaps one there (through `ctx.space`); with no direction (zero
 * gravity, `"none"`, a zero vector) or nothing ahead it stays at `at`. Gated
 * colliders and `opts.exclude`'s entities don't count.
 */
export function castSpawn(
  ctx: EngineContext,
  at: Vec2,
  shape: SpawnShape,
  opts: CastSpawnOptions = {},
): CastResult {
  const { space } = ctx;
  const exclude = opts.exclude ?? [];
  const inside = space.overlaps(shapeAt(shape, at), { exclude })[0];
  if (inside) {
    return {
      ok: false,
      error: `can't start inside a solid (${inside.tag.entityId}) at ${roundLength(at.x)}, ${roundLength(at.y)} m`,
    };
  }

  const dir = castDirection(ctx, shape);
  if (!dir) return { ok: true, at: { ...at } };
  const distance = reach(at, dir, ctx.bounds);
  if (distance === 0) return { ok: true, at: { ...at } };

  const travelled = travel(space, at, dir, distance, shape, exclude);
  if (travelled === null) return { ok: true, at: { ...at } };
  return { ok: true, at: { x: at.x + dir.x * travelled, y: at.y + dir.y * travelled } };
}
