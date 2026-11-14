import { BEHAVIORS_FIELD } from "../../game/behaviors";
import { COLLIDER } from "../../game/behaviors/collider";
import { FORCE_AREA } from "../../game/behaviors/force-area";
import { JOINT } from "../../game/behaviors/joint";
import { SPAWNER } from "../../game/behaviors/spawner";
import { scopedRef, type Registry } from "../../game/types";
import { behaviorBlocks } from "../../scene/expand";
import { geometryPose, shapeAtPose, translateShape, turnBy } from "../../scene/shape-geometry";
import { parseShape } from "../../scene/shapes";
import type { EntityDef, Pt, Ref, SceneDefinition, ShapeObj } from "../../scene/types";
import { geometryOfRef, type EditGeometry } from "../spatial-index";

const DEG = Math.PI / 180;

/** Screen px of arrow per m/s² of a force area's `force`, and of ring radius per m/s² of its `strength`. */
export const FORCE_PX = 4;
/** Screen px of arrow per m/s of a spawner's `velocity`. */
export const VELOCITY_PX = 16;
/** Screen px from the pose a zero-length handle sits, so it can still be grabbed. */
export const REACH_PX = 16;

/** Where an entity's blocks are posed: what `shape`, `anchorA`, `force` and `velocity` are local to. */
export type EditPose = { at: Pt; rotDeg: number };

/**
 * The parts of an entity's standard behaviors its gizmos draw and edit, in
 * world metres unless a field says otherwise.
 */
export type BehaviorGizmo = {
  pose: EditPose;
  /** The `collider` block's shape, as written and placed at the pose; `sensor` when it is a trigger. */
  collider?: { local: ShapeObj; world: ShapeObj; sensor: boolean };
  joint?: {
    anchorA: Pt;
    /** The entity `to` names, at its pose; absent when it names nothing in the scene. */
    to?: { ref: Ref; pose: EditPose };
    /** Only when the block writes `anchorB`. */
    anchorB?: Pt;
  };
  force?: { kind: "directional"; force: Pt } | { kind: "point"; strength: number };
  /** `velocity` is local to the pose, m/s. */
  spawner?: { spread: number; velocity?: Pt };
};

/** Handle ids a behavior gizmo uses, `<behavior>:<part>`. */
const BEHAVIOR_HANDLE_PREFIXES = [
  `${COLLIDER.name}:`,
  `${JOINT.name}:`,
  `${FORCE_AREA.name}:`,
  `${SPAWNER.name}:`,
] as const;

export const isBehaviorHandle = (id: string): boolean =>
  BEHAVIOR_HANDLE_PREFIXES.some((p) => id.startsWith(p));

/** `local` turned by the pose and moved to it. */
export const poseToWorld = (pose: EditPose, local: Pt): Pt => {
  const [x, y] = pose.rotDeg % 360 === 0 ? local : turnBy(local, pose.rotDeg * DEG);
  return [pose.at[0] + x, pose.at[1] + y];
};

/** A world point in the pose's frame. */
export const worldToPose = (pose: EditPose, world: Pt): Pt => {
  const d: Pt = [world[0] - pose.at[0], world[1] - pose.at[1]];
  return pose.rotDeg % 360 === 0 ? d : turnBy(d, -pose.rotDeg * DEG);
};

/** A direction in the pose's frame, turned into the world's. */
export const turnToWorld = (pose: EditPose, v: Pt): Pt =>
  pose.rotDeg % 360 === 0 ? v : turnBy(v, pose.rotDeg * DEG);

export const shapeToWorld = (pose: EditPose, local: ShapeObj): ShapeObj =>
  shapeAtPose(local, { x: pose.at[0], y: pose.at[1], rot: pose.rotDeg * DEG });

export const shapeToPose = (pose: EditPose, world: ShapeObj): ShapeObj =>
  shapeAtPose(translateShape(world, [-pose.at[0], -pose.at[1]]), {
    x: 0,
    y: 0,
    rot: -pose.rotDeg * DEG,
  });

/** A vector's tip drawn `px` screen px per unit from the pose, or `REACH_PX` along +x when it's zero. */
export function vectorTip(b: BehaviorGizmo, v: Pt, px: number, scale: number): Pt {
  const [x, y] = turnToWorld(b.pose, v);
  if (x === 0 && y === 0) return [b.pose.at[0] + REACH_PX / scale, b.pose.at[1]];
  return [b.pose.at[0] + (x * px) / scale, b.pose.at[1] + (y * px) / scale];
}

/** A ring's handle on +x of the pose, `r` metres out, or `REACH_PX` when `r` is zero. */
export const ringHandle = (b: BehaviorGizmo, r: number, scale: number): Pt => [
  b.pose.at[0] + (r > 0 ? r : REACH_PX / scale),
  b.pose.at[1],
];

/**
 * Where the runtime starts an entity with geometry `g`: its shape's centre
 * (on a path, placed at the first point), else its point, else the path's
 * first point; turned by a box's or capsule's `rotDeg`, else by the angle
 * of what the entity sits in.
 */
export function editPose(g: EditGeometry, entity?: EntityDef): EditPose {
  const p = geometryPose({
    ...(g.local ? { shape: g.local } : {}),
    ...(g.at ? { at: g.at } : {}),
    ...(g.pts ? { path: { pts: g.pts } } : {}),
  });
  const transform = entity?.transform as { rot?: unknown } | undefined;
  const turn = typeof transform?.rot === "number" ? transform.rot : 0;
  return { at: p?.at ?? [0, 0], rotDeg: p?.rotDeg ?? turn };
}

const isPt = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function shapeOf(v: unknown): ShapeObj | undefined {
  const r = parseShape(v);
  return r.ok ? r.shape : undefined;
}

/** `ref`'s pose in `def`, for an entity or an instance's resolved child. */
function refPose(def: SceneDefinition, registry: Registry, ref: Ref): EditPose | undefined {
  const g = geometryOfRef(def, registry, ref);
  if (!g) return undefined;
  return editPose(
    g,
    (def.entities ?? []).find((e) => e.id === ref),
  );
}

/**
 * The behavior gizmo of the entity `ref` in `def` (the resolved view):
 * undefined when it carries none of `collider`, `joint`, `force-area` or
 * `spawner`, or is a bulk row.
 */
export function behaviorGizmo(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
  geometry?: EditGeometry,
): BehaviorGizmo | undefined {
  const entity = (def.entities ?? []).find((e) => e.id === ref);
  if (!entity || !registry.types.has(entity.type)) return undefined;
  const blocks = behaviorBlocks(registry, entity.type, entity[BEHAVIORS_FIELD]);
  const collider = blocks[COLLIDER.name];
  const joint = blocks[JOINT.name];
  const force = blocks[FORCE_AREA.name];
  const spawner = blocks[SPAWNER.name];
  if (!collider && !joint && !force && !spawner) return undefined;
  const g = geometry ?? geometryOfRef(def, registry, ref);
  if (!g) return undefined;
  const pose = editPose(g, entity);
  const out: BehaviorGizmo = { pose };

  const local = collider && shapeOf(collider.shape);
  if (local)
    out.collider = { local, world: shapeToWorld(pose, local), sensor: collider.sensor === true };

  if (joint) {
    const to = typeof joint.to === "string" ? jointTarget(def, registry, ref, joint.to) : undefined;
    out.joint = {
      anchorA: poseToWorld(pose, isPt(joint.anchorA) ? joint.anchorA : [0, 0]),
      ...(to ? { to } : {}),
      ...(to && isPt(joint.anchorB) ? { anchorB: poseToWorld(to.pose, joint.anchorB) } : {}),
    };
  }

  if (force) {
    out.force =
      force.kind === "point"
        ? { kind: "point", strength: num(force.strength, 0) }
        : { kind: "directional", force: isPt(force.force) ? force.force : [0, 0] };
  }

  if (spawner) {
    out.spawner = {
      spread: Math.max(0, num(spawner.spread, 0)),
      ...(isPt(spawner.velocity) ? { velocity: spawner.velocity } : {}),
    };
  }
  return out;
}

/** The entity a joint's `to` names, scoped like the runtime's (`scopedRef`). */
function jointTarget(
  def: SceneDefinition,
  registry: Registry,
  self: Ref,
  to: string,
): { ref: Ref; pose: EditPose } | undefined {
  const ids = new Set((def.entities ?? []).map((e) => e.id));
  const ref = scopedRef(self, to, (id) => ids.has(id));
  if (!ids.has(ref) || ref === self) return undefined;
  const pose = refPose(def, registry, ref);
  return pose && { ref, pose };
}
