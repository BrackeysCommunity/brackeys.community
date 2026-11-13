import { BEHAVIORS_FIELD } from "../../game/behaviors";
import { COLLIDER } from "../../game/behaviors/collider";
import { PATH_FOLLOW } from "../../game/behaviors/path-follow";
import type { Registry } from "../../game/types";
import { behaviorBlocks } from "../../scene/expand";
import { rotateShape, translateShape } from "../../scene/shape-geometry";
import { parseShape } from "../../scene/shapes";
import type { Pt, Ref, SceneDefinition, ShapeObj } from "../../scene/types";
import { entityGeometry } from "../spatial-index";
import type { GizmoHandle } from "../tools";
import {
  editPose,
  FORCE_PX,
  shapeToWorld,
  vectorTip,
  VELOCITY_PX,
  type BehaviorGizmo,
} from "./behavior-target";
import { behaviorHandles, shapeHandles, shapePivot } from "./handles";

const DEG = Math.PI / 180;

/** What a selected entity's behavior gizmo draws, world metres; the host draws it under the handles. */
export type BehaviorMarks = {
  /** The collider's shape. */
  outlines: { shape: ShapeObj; sensor: boolean }[];
  /**
   * A joint: `link` from the entity's pose to the entity `to` names, so a
   * joint whose anchors coincide still shows its partner; `anchors` from its
   * anchor to the other body's, when that one is written and apart from it.
   */
  lines: { kind: "link" | "anchors"; from: Pt; to: Pt }[];
  /** A force area's direction, a spawner's velocity. */
  arrows: { from: Pt; to: Pt }[];
  /** A spawner's spread; a point force area's strength, `inward` when it pulls. */
  rings: { at: Pt; r: number; inward?: boolean }[];
};

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const deg = (v: Pt) => Math.atan2(v[1], v[0]) / DEG;

/**
 * The collider's shape as its handles now place it: while a drag previews,
 * the host's handles move before the document does. A box follows its
 * corners, a circle its radius, a capsule its length and radius, a polygon
 * its rotate handle; `committed` is what the document holds.
 */
function colliderFromHandles(
  committed: ShapeObj,
  at: (id: string) => Pt | undefined,
  scale: number,
): ShapeObj {
  switch (committed.type) {
    case "box": {
      const nw = at("collider:resize:nw");
      const ne = at("collider:resize:ne");
      const sw = at("collider:resize:sw");
      const se = at("collider:resize:se");
      if (!nw || !ne || !sw || !se) return committed;
      const [cx, cy] = mid(nw, se);
      const rotDeg = Math.round(deg([ne[0] - nw[0], ne[1] - nw[1]]));
      return { ...committed, cx, cy, hw: dist(nw, ne) / 2, hh: dist(nw, sw) / 2, rotDeg };
    }
    case "circle": {
      const r = at("collider:radius");
      return r ? { ...committed, r: dist(r, [committed.cx, committed.cy]) } : committed;
    }
    case "capsule": {
      const len = at("collider:length");
      const side = at("collider:radius");
      if (!len || !side) return committed;
      const c: Pt = [committed.cx, committed.cy];
      const r = dist(side, c);
      const rotDeg = Math.round(deg([len[0] - c[0], len[1] - c[1]]) + 90);
      return { ...committed, r, halfLen: Math.max(0, dist(len, c) - r), rotDeg };
    }
    default: {
      const was = shapeHandles(committed, scale).find((h) => h.id === "rotate")?.at;
      const now = at("collider:rotate");
      if (!was || !now) return committed;
      const pivot = shapePivot(committed);
      const turn =
        deg([now[0] - pivot[0], now[1] - pivot[1]]) - deg([was[0] - pivot[0], was[1] - pivot[1]]);
      return turn === 0 ? committed : rotateShape(committed, pivot, turn);
    }
  }
}

/** `b` moved by `by`: what a previewed move of its entity shows. The joint's other end stays. */
function shifted(b: BehaviorGizmo, by: Pt): BehaviorGizmo {
  if (by[0] === 0 && by[1] === 0) return b;
  const move = (p: Pt): Pt => [p[0] + by[0], p[1] + by[1]];
  return {
    ...b,
    pose: { ...b.pose, at: move(b.pose.at) },
    ...(b.collider
      ? { collider: { ...b.collider, world: translateShape(b.collider.world, by) } }
      : {}),
    ...(b.joint ? { joint: { ...b.joint, anchorA: move(b.joint.anchorA) } } : {}),
  };
}

/**
 * What `b` draws at screen scale `scale` (px per metre): the collider's
 * outline, the joint's line to the entity it links and between its anchors,
 * the force area's arrow or strength ring, the spawner's spread ring
 * and velocity arrow. `handles` are the host's handles this frame: one of
 * `b`'s that isn't where the document puts it is being dragged, and its
 * mark follows it. `shift` is how far a previewed move has taken the entity.
 */
export function behaviorMarks(
  committed: BehaviorGizmo,
  scale: number,
  handles: readonly GizmoHandle[] = [],
  opts: { shift?: Pt } = {},
): BehaviorMarks {
  const b = shifted(committed, opts.shift ?? [0, 0]);
  const was = new Map(behaviorHandles(b, scale).map((h) => [h.id, h.at]));
  const now = new Map(handles.map((h) => [h.id, h.at]));
  const live = (id: string): Pt | undefined => {
    const p = now.get(id);
    const q = was.get(id);
    return p && q && dist(p, q) > 1e-9 ? p : undefined;
  };
  const out: BehaviorMarks = { outlines: [], lines: [], arrows: [], rings: [] };
  const pose = b.pose.at;
  if (b.collider) {
    const dragged = [...was.keys()].some((id) => id.startsWith("collider:") && live(id));
    out.outlines.push({
      shape: dragged
        ? colliderFromHandles(b.collider.world, (id) => now.get(id), scale)
        : b.collider.world,
      sensor: b.collider.sensor,
    });
  }
  if (b.joint) {
    const partner = b.joint.to?.pose.at;
    if (partner && dist(pose, partner) > 1e-9)
      out.lines.push({ kind: "link", from: pose, to: partner });
    const a = live("joint:anchorA") ?? b.joint.anchorA;
    const other = live("joint:anchorB") ?? b.joint.anchorB;
    if (other && dist(a, other) > 1e-9) out.lines.push({ kind: "anchors", from: a, to: other });
  }
  const arrow = (id: string, v: Pt, px: number) => {
    const tip = live(id);
    if (tip || v[0] !== 0 || v[1] !== 0)
      out.arrows.push({ from: pose, to: tip ?? vectorTip(b, v, px, scale) });
  };
  const ring = (id: string, r: number, inward?: boolean) => {
    const handle = live(id);
    const radius = handle ? dist(handle, pose) : r;
    if (radius > 0)
      out.rings.push({ at: pose, r: radius, ...(inward !== undefined ? { inward } : {}) });
  };
  if (b.force?.kind === "directional") arrow("force-area:force", b.force.force, FORCE_PX);
  if (b.force?.kind === "point")
    ring(
      "force-area:strength",
      (Math.abs(b.force.strength) * FORCE_PX) / scale,
      b.force.strength > 0,
    );
  if (b.spawner) {
    ring("spawner:spread", b.spawner.spread);
    if (b.spawner.velocity) arrow("spawner:velocity", b.spawner.velocity, VELOCITY_PX);
  }
  return out;
}

/**
 * The world collider shape of every entity in `def` (the resolved view)
 * that carries a `collider` block, but those in `skip` (drawn by their gizmo):
 * what the canvas outlines faintly, so an entity with no art still shows.
 */
export function colliderOutlines(
  def: SceneDefinition,
  registry: Registry,
  skip: readonly Ref[] = [],
): { ref: Ref; shape: ShapeObj; sensor: boolean }[] {
  const out: { ref: Ref; shape: ShapeObj; sensor: boolean }[] = [];
  for (const e of def.entities ?? []) {
    const type = registry.types.get(e.type);
    if (!type || skip.includes(e.id)) continue;
    const collider = behaviorBlocks(registry, e.type, e[BEHAVIORS_FIELD])[COLLIDER.name];
    if (!collider) continue;
    const local = parseShape(collider.shape);
    if (!local.ok) continue;
    const pose = editPose(entityGeometry(type, e), e);
    out.push({
      ref: e.id,
      shape: shapeToWorld(pose, local.shape),
      sensor: collider.sensor === true,
    });
  }
  return out;
}

/** The waypoints `ref`'s `path-follow` block moves it along, world metres; undefined without one. */
export function pathFollowPath(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
): { pts: Pt[]; closed: boolean } | undefined {
  const e = (def.entities ?? []).find((x) => x.id === ref);
  if (!e || !registry.types.has(e.type)) return undefined;
  const block = behaviorBlocks(registry, e.type, e[BEHAVIORS_FIELD])[PATH_FOLLOW.name];
  const path = block?.path as { pts?: unknown; mode?: unknown } | undefined;
  const pts = Array.isArray(path?.pts) ? path.pts.filter(isPt) : [];
  if (pts.length < 2) return undefined;
  return { pts: pts.map(([x, y]) => [x, y] as Pt), closed: path?.mode === "loop" };
}

const isPt = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
