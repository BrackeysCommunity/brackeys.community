import type { Shape } from "@dimforge/rapier2d";

import type { EngineContext, SpawnShape } from "../game/types";
import type { Vec2 } from "../types";

export type CastResult = { ok: true; at: Vec2 } | { ok: false; error: string };

function rapierShape(ctx: EngineContext, shape: SpawnShape): Shape {
  const { rapier } = ctx;
  switch (shape.type) {
    case "box":
      return new rapier.Cuboid(shape.hw, shape.hh);
    case "circle":
      return new rapier.Ball(shape.r);
    case "capsule":
      return new rapier.Capsule(shape.halfLen, shape.r);
  }
}

/**
 * Every collision group, as a query filter: a query passing it skips only
 * colliders gated off with collision groups 0 (attached one-way solids).
 * Rapier applies collision groups to a query only through its `filterGroups`.
 */
export const ALL_GROUPS = 0xffff_ffff;

/**
 * Where an actor of `shape` placed at `at` comes to rest: dropped straight
 * down onto the first non-sensor collider below, within the scene's bounds.
 * Refused when the shape already overlaps one there; with nothing below it
 * stays at `at`. Gated colliders don't count. Queries see the colliders as
 * of the last `refreshQueries`.
 */
export function castSpawn(ctx: EngineContext, at: Vec2, shape: SpawnShape): CastResult {
  const { rapier } = ctx;
  const { world } = ctx.physics;
  const s = rapierShape(ctx, shape);
  const pos = new rapier.Vector2(at.x, at.y);
  const flags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;

  const inside = world.intersectionWithShape(pos, 0, s, flags, ALL_GROUPS);
  if (inside) {
    const owner = ctx.tags.get(inside.handle)?.entityId;
    return {
      ok: false,
      error: `can't start inside a solid${owner ? ` (${owner})` : ""} at ${Math.round(at.x)}, ${Math.round(at.y)}`,
    };
  }

  const distance = Math.max(0, ctx.bounds[3] - at.y);
  if (distance === 0) return { ok: true, at: { ...at } };
  const down = new rapier.Vector2(0, 1);
  const hit = world.castShape(pos, 0, down, s, 0, distance, false, flags, ALL_GROUPS);
  if (!hit) return { ok: true, at: { ...at } };
  return { ok: true, at: { x: at.x, y: at.y + hit.time_of_impact } };
}
