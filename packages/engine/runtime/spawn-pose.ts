import { isNodeType } from "../game/primitives";
import type { EngineContext, RegisteredType, Registry } from "../game/types";
import { degToRad } from "../physics";
import { geometryFields } from "../scene/schema";
import { geometryPose, shapeCentre, type GeometryPose } from "../scene/shape-geometry";
import { turnRadians } from "../scene/transform";
import type { PathDef, Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import type { Pose } from "./poses";

/** Radians for the angle of what an entity sits in. */
const turnRad = (transform: RuntimeEntity["transform"]) => turnRadians(transform?.rot ?? 0);

/** A pose at `at`, turned by `rotDeg` degrees when set, else by the angle of what it sits in. */
export const poseOf = (
  { at, rotDeg }: GeometryPose,
  transform: RuntimeEntity["transform"],
): Pose => ({
  x: at[0],
  y: at[1],
  rot: rotDeg === undefined ? turnRad(transform) : degToRad(rotDeg),
});

/**
 * A shape's pose in its own coordinates: its centre, and its angle from
 * `rotDeg`, else from the entity's frame (circles, polygons, chains).
 */
export function shapeSpawnPose(shape: ShapeObj, transform?: RuntimeEntity["transform"]): Pose {
  return poseOf(shapeCentre(shape), transform);
}

/**
 * What a type's spawn pose reads, for callers that look it up once per type:
 * whether it is a node, and its geometry fields.
 */
export type SpawnGeometry = { node: boolean; fields: ReturnType<typeof geometryFields> };

export const spawnGeometryOf = (t: RegisteredType | undefined): SpawnGeometry => ({
  node: isNodeType(t),
  fields: t ? geometryFields(t) : [],
});

/** A node's pose: its `at`, at its own `rot` when set, else at the angle of what it sits in. */
export const nodePose = (e: RuntimeEntity<{ at: Pt; rot?: number }>): Pose =>
  poseOf({ at: e.at, rotDeg: e.rot }, e.transform);

/** `spawnPose` over the type's `spawnGeometryOf`. */
export function spawnPoseOf(e: RuntimeEntity, { node, fields }: SpawnGeometry): Pose {
  if (node) return nodePose(e as RuntimeEntity<{ at: Pt; rot?: number }>);
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
 * else `RuntimeEntity.transform`'s angle; a node's is its own `rot`.
 */
export function spawnPose(e: RuntimeEntity, registry: Registry): Pose {
  return spawnPoseOf(e, spawnGeometryOf(registry.types.get(e.type)));
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
