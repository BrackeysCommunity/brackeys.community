import type { EngineContext, Registry } from "../game/types";
import { degToRad } from "../physics";
import { geometryFields } from "../scene/schema";
import { geometryPose, shapeCentre, type GeometryPose } from "../scene/shape-geometry";
import type { PathDef, Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import type { Pose } from "./poses";

/** Radians for an entity's quarter turns. */
const turnRad = (transform: RuntimeEntity["transform"]) => ((transform?.turn ?? 0) * Math.PI) / 2;

const poseOf = ({ at, rotDeg }: GeometryPose, transform: RuntimeEntity["transform"]): Pose => ({
  x: at[0],
  y: at[1],
  rot: rotDeg === undefined ? turnRad(transform) : degToRad(rotDeg),
});

/**
 * A shape's pose in its own coordinates: its centre, and its angle from
 * `rotDeg`, else from the entity's quarter turns (circles, polygons, chains).
 */
export function shapeSpawnPose(shape: ShapeObj, transform?: RuntimeEntity["transform"]): Pose {
  return poseOf(shapeCentre(shape), transform);
}

/** Where a type's geometry puts an entity: its first shape, point and path fields. */
export type GeometryFields = ReturnType<typeof geometryFields>;

/** `spawnPose` over a type's geometry fields, for callers that look them up once per type. */
export function spawnPoseOf(e: RuntimeEntity, fields: GeometryFields): Pose {
  let shape: ShapeObj | undefined;
  let at: Pt | undefined;
  let path: PathDef | undefined;
  for (const { field, kind } of fields) {
    const value = e[field];
    if (value === undefined || value === null) continue;
    if (kind === "shape") shape ??= value as ShapeObj;
    else if (kind === "point") at ??= value as Pt;
    else if (kind === "path") path ??= value as PathDef;
  }
  const pose = geometryPose({ shape, at, path });
  return pose ? poseOf(pose, e.transform) : { x: 0, y: 0, rot: turnRad(e.transform) };
}

/**
 * Where an entity starts, from its type's geometry: a shape's centre (a
 * path rider's shape placed at the path's first point), else its point
 * field, else its path's first point. The angle is the shape's `rotDeg`,
 * else `RuntimeEntity.transform`'s quarter turns.
 */
export function spawnPose(e: RuntimeEntity, registry: Registry): Pose {
  const type = registry.types.get(e.type);
  return spawnPoseOf(e, type ? geometryFields(type) : []);
}

/** An entity's live pose, else where it spawns, else the origin when the scene has no such entity. */
export function currentPose(
  ctx: Pick<EngineContext, "poses" | "get" | "registry">,
  id: string,
): Pose {
  const pose = ctx.poses.get(id);
  if (pose) return pose;
  const e = ctx.get(id);
  return e ? spawnPose(e, ctx.registry) : { x: 0, y: 0, rot: 0 };
}
