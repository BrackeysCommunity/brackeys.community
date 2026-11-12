import { physicsOf } from "../game/physics-of";
import type { EngineContext, SpawnShape } from "../game/types";
import { shapeColliderDesc } from "../physics";
import type { Bounds, ShapeObj } from "../scene/types";
import { roundLength } from "../scene/units";
import type { Vec2 } from "../types";

export type CastResult = { ok: true; at: Vec2 } | { ok: false; error: string };

/**
 * Every collision group, as a query filter: a query passing it skips only
 * colliders gated off with collision groups 0 (attached one-way solids).
 * Rapier applies collision groups to a query only through its `filterGroups`.
 */
export const ALL_GROUPS = 0xffff_ffff;

/**
 * Geometry sweeps after the first: each searches the last one's bracket
 * around the contact (a geometry sweep resolves 1/1024 of its length), until
 * the bracket is under `CAST_PRECISION` m.
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
 * Rapier casts with a unit velocity so the time of impact is in metres,
 * the distance travelled.
 * Queries see the colliders as of the last `refreshQueries`.
 */
function rapierTravel(
  ctx: EngineContext,
  at: Vec2,
  dir: Vec2,
  distance: number,
  shape: SpawnShape,
): number | null {
  const { rapier, physics } = physicsOf(ctx, "play from here");
  const s = shapeColliderDesc(rapier, shapeAt(shape, at)).shape;
  const pos = new rapier.Vector2(at.x, at.y);
  const vel = new rapier.Vector2(dir.x, dir.y);
  const flags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  const hit = physics.world.castShape(pos, 0, vel, s, 0, distance, false, flags, ALL_GROUPS);
  return hit ? hit.time_of_impact : null;
}

function geometryTravel(
  space: EngineContext["space"],
  at: Vec2,
  dir: Vec2,
  distance: number,
  shape: SpawnShape,
): number | null {
  const sweep = (from: Vec2, length: number) =>
    space.sweep(shapeAt(shape, from), { x: dir.x * length, y: dir.y * length });
  const hit = sweep(at, distance);
  if (!hit) return null;
  let travelled = hit.toi * distance;
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
 * colliders don't count.
 */
export function castSpawn(ctx: EngineContext, at: Vec2, shape: SpawnShape): CastResult {
  const { space } = ctx;
  const inside = space.overlaps(shapeAt(shape, at))[0];
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

  const travelled =
    space.backend === "rapier"
      ? rapierTravel(ctx, at, dir, distance, shape)
      : geometryTravel(space, at, dir, distance, shape);
  if (travelled === null) return { ok: true, at: { ...at } };
  return { ok: true, at: { x: at.x + dir.x * travelled, y: at.y + dir.y * travelled } };
}
