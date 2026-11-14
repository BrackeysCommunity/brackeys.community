import type { BehaviorName } from "../game/behaviors";
import type { EngineContext, EntityQuery, EntitySelector } from "../game/types";
import { geometryFields, tagFieldsOf } from "../scene/schema";
import {
  aabb,
  distanceToShape,
  isConvex,
  shapeAtPose,
  shapeCentre,
  shapesIntersect,
  translateShape,
} from "../scene/shape-geometry";
import { createSpatialHash } from "../scene/spatial-hash";
import type { Aabb, EntityTypeName, Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";
import { carriedBehaviors } from "./behaviors";
import { isWatched, type Pose } from "./poses";
import { spawnPoseOf, type GeometryFields } from "./spawn-pose";

/** A runtime's query index: `EngineContext.query` plus what the lifecycle tells it. */
export type RuntimeQueryIndex = EntityQuery & {
  /** `e` spawned, or its record was replaced by an edit (an id already indexed keeps its place). */
  added(e: RuntimeEntity): void;
  removed(id: string): void;
  enabledChanged(id: string, enabled: boolean): void;
  /** Forgets every entity; at unload. */
  clear(): void;
};

type Slot = {
  id: string;
  type: EntityTypeName;
  seq: number;
  enabled: boolean;
  tags: ReadonlySet<string>;
  /** The behaviors whose blocks the record carries. */
  behaviors: ReadonlySet<BehaviorName>;
  spawn: Pose;
  /** The entity's shape where it spawned, in world px; none for an entity without one. */
  shape: ShapeObj | undefined;
  /** A polygon that isn't convex (a walk area): overlaps test its outline and inside. */
  concave: boolean;
  /** The pose `extent` was computed at; a new pose object means the entity moved. */
  pose: Readonly<Pose> | undefined;
  extent: ShapeObj | null;
};

const isShape = (area: ShapeObj | Aabb): area is ShapeObj => "type" in area;

const rectShape = (r: Aabb): ShapeObj => ({
  type: "poly",
  pts: [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY],
  ],
});

const anyPoint = (s: ShapeObj): Pt =>
  s.type === "poly" || s.type === "chain" ? s.pts[0]! : [s.cx, s.cy];

const outline = (s: ShapeObj): ShapeObj =>
  s.type === "poly" ? { type: "chain", pts: [...s.pts, s.pts[0]!] } : s;

/** Whether two shapes share a point, polygons that aren't convex by their outline and inside. */
function overlaps(a: ShapeObj, aConcave: boolean, b: ShapeObj, bConcave: boolean): boolean {
  if (!aConcave && !bConcave) return shapesIntersect(a, b);
  if (shapesIntersect(aConcave ? outline(a) : a, bConcave ? outline(b) : b)) return true;
  return (
    (aConcave && distanceToShape(a, anyPoint(b)) === 0) ||
    (bConcave && distanceToShape(b, anyPoint(a)) === 0)
  );
}

const isConcave = (s: ShapeObj | undefined) =>
  s?.type === "poly" && s.pts.length >= 3 && !isConvex(s.pts);

/**
 * Entities by type, tag, behavior, ancestor, area, point and nearness, over the pose index and
 * each entity's shape: never the physics or geometry world, so both
 * backends answer alike. Extents refresh lazily, for the entities whose
 * pose changed since they were last computed: from the first area query
 * on, a pose index that reports its writes names them, and one that
 * doesn't has every entity looked at.
 */
export function createQueryIndex(ctx: EngineContext): RuntimeQueryIndex {
  const slots = new Map<string, Slot>();
  const byType = new Map<EntityTypeName, Set<string>>();
  const byTag = new Map<string, Set<string>>();
  const byBehavior = new Map<BehaviorName, Set<string>>();
  const none: ReadonlySet<string> = new Set();
  const hash = createSpatialHash<string>();
  const geometry = new Map<EntityTypeName, { fields: GeometryFields; tags: string[] }>();
  let nextSeq = 0;
  /** Entities to look at before the next area query; kept only while `tracking`. */
  const stale = new Set<string>();
  let tracking = false;
  const poses = ctx.poses;
  const watched = isWatched(poses);
  if (isWatched(poses)) {
    poses.watch((id) => {
      if (tracking && slots.has(id)) stale.add(id);
    });
  }

  function fieldsOf(type: EntityTypeName) {
    let f = geometry.get(type);
    if (!f) {
      const t = ctx.registry.types.get(type);
      f = { fields: t ? geometryFields(t) : [], tags: tagFieldsOf(t) };
      geometry.set(type, f);
    }
    return f;
  }

  const join = (index: Map<string, Set<string>>, key: string, id: string) => {
    let set = index.get(key);
    if (!set) index.set(key, (set = new Set()));
    set.add(id);
  };
  const leave = (index: Map<string, Set<string>>, key: string, id: string) => {
    const set = index.get(key);
    set?.delete(id);
    if (set?.size === 0) index.delete(key);
  };

  function unindex(slot: Slot): void {
    leave(byType, slot.type, slot.id);
    for (const tag of slot.tags) leave(byTag, tag, slot.id);
    for (const name of slot.behaviors) leave(byBehavior, name, slot.id);
  }

  /** The shape at spawn moved rigidly by the pose's change since: translated, and turned about the spawn pose. */
  function computeExtent(slot: Slot, pose: Readonly<Pose>): ShapeObj {
    const { shape, spawn } = slot;
    if (!shape) return { type: "circle", cx: pose.x, cy: pose.y, r: 0 };
    const turn = pose.rot - spawn.rot;
    if (turn === 0) {
      const dx = pose.x - spawn.x;
      const dy = pose.y - spawn.y;
      return dx === 0 && dy === 0 ? shape : translateShape(shape, [dx, dy]);
    }
    return shapeAtPose(translateShape(shape, [0 - spawn.x, 0 - spawn.y]), {
      x: pose.x,
      y: pose.y,
      rot: turn,
    });
  }

  function refreshed(slot: Slot): ShapeObj {
    const pose = ctx.poses.get(slot.id) ?? slot.spawn;
    if (slot.extent && slot.pose === pose) return slot.extent;
    slot.pose = pose;
    slot.extent = computeExtent(slot, pose);
    hash.update(slot.id, aabb(slot.extent));
    return slot.extent;
  }

  function refreshAll(): void {
    if (!tracking) {
      for (const slot of slots.values()) refreshed(slot);
      tracking = watched;
      return;
    }
    for (const id of stale) {
      const slot = slots.get(id);
      if (slot) refreshed(slot);
    }
    stale.clear();
  }

  function matches(slot: Slot, sel: EntitySelector | undefined): boolean {
    if ((sel?.enabled ?? true) && !slot.enabled) return false;
    const type = sel?.type;
    if (type !== undefined) {
      if (typeof type === "string" ? slot.type !== type : !type.includes(slot.type)) return false;
    }
    if (sel?.behavior !== undefined && !slot.behaviors.has(sel.behavior)) return false;
    if (sel?.tag !== undefined && !slot.tags.has(sel.tag)) return false;
    return sel?.under === undefined || below(slot.id, sel.under);
  }

  /** Whether `id` is one of `ancestor`'s descendants. */
  const below = (id: string, ancestor: string) => id !== ancestor && ctx.tree.isUnder(id, ancestor);

  /** `ancestor`'s descendants; none for an id that isn't live. */
  function descendants(ancestor: string): ReadonlySet<string> {
    const ids = ctx.tree.subtree(ancestor);
    return ids.length > 1 ? new Set(ids.slice(1)) : none;
  }

  /** The slots of `ids` that match, in spawn order. */
  function ordered(ids: Iterable<string>, sel: EntitySelector | undefined): Slot[] {
    const out: Slot[] = [];
    for (const id of ids) {
      const slot = slots.get(id);
      if (slot && matches(slot, sel)) out.push(slot);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  /** The smallest index set the selector names, or every slot when it names none. */
  function candidates(sel: EntitySelector | undefined): Iterable<string> {
    let best: ReadonlySet<string> | undefined;
    const narrow = (set: ReadonlySet<string> | undefined) => {
      const s = set ?? none;
      if (!best || s.size < best.size) best = s;
    };
    if (sel?.tag !== undefined) narrow(byTag.get(sel.tag));
    if (sel?.behavior !== undefined) narrow(byBehavior.get(sel.behavior));
    if (typeof sel?.type === "string") narrow(byType.get(sel.type));
    if (sel?.under !== undefined) narrow(descendants(sel.under));
    return best ?? slots.keys();
  }

  const ids = (list: Slot[]) => list.map((s) => s.id);

  function select(sel?: EntitySelector): string[] {
    return ids(ordered(candidates(sel), sel));
  }

  function inArea(area: ShapeObj | Aabb, sel?: EntitySelector): string[] {
    const shape = isShape(area) ? area : rectShape(area);
    const concave = isShape(area) && isConcave(area);
    refreshAll();
    const near = ordered(hash.query(aabb(shape)), sel);
    return ids(near.filter((s) => overlaps(refreshed(s), s.concave, shape, concave)));
  }

  function at(p: Vec2, sel?: EntitySelector): string[] {
    const pt: Pt = [p.x, p.y];
    refreshAll();
    const near = ordered(hash.query({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }), sel);
    return ids(near.filter((s) => distanceToShape(refreshed(s), pt) === 0));
  }

  function nearest(p: Vec2, sel?: EntitySelector & { maxDist?: number }): string | undefined {
    const pt: Pt = [p.x, p.y];
    const maxDist = sel?.maxDist ?? Infinity;
    if (!(maxDist >= 0)) return undefined;
    refreshAll();
    const pool = Number.isFinite(maxDist)
      ? ordered(
          hash.query({
            minX: p.x - maxDist,
            minY: p.y - maxDist,
            maxX: p.x + maxDist,
            maxY: p.y + maxDist,
          }),
          sel,
        )
      : ordered(candidates(sel), sel);
    let best: Slot | undefined;
    let bestDist = Infinity;
    for (const slot of pool) {
      const d = distanceToShape(refreshed(slot), pt);
      if (d <= maxDist && d < bestDist) {
        best = slot;
        bestDist = d;
      }
    }
    return best?.id;
  }

  return {
    select,
    byType: (type) => select({ type }),
    byTag: (tag) => select({ tag }),
    count: (sel) => ordered(candidates(sel), sel).length,
    inArea,
    at,
    nearest,
    extent(id) {
      const slot = slots.get(id);
      return slot ? refreshed(slot) : undefined;
    },
    added(e) {
      const was = slots.get(e.id);
      if (was) unindex(was);
      const { fields, tags: tagFields } = fieldsOf(e.type);
      const tags = new Set<string>();
      for (const field of tagFields) {
        const value = e[field];
        if (Array.isArray(value)) for (const t of value) if (typeof t === "string") tags.add(t);
      }
      const behaviors = new Set<BehaviorName>(carriedBehaviors(e));
      const spawn = spawnPoseOf(e, fields);
      let local: ShapeObj | undefined;
      for (const { field, kind } of fields) {
        const value = e[field];
        if (kind === "shape" && value !== undefined && value !== null) {
          local = value as ShapeObj;
          break;
        }
      }
      // A path rider's shape is local to its path: put it where the entity spawned.
      const centre = local && shapeCentre(local).at;
      const shape =
        local && centre && (centre[0] !== spawn.x || centre[1] !== spawn.y)
          ? translateShape(local, [spawn.x - centre[0], spawn.y - centre[1]])
          : local;
      const slot: Slot = {
        id: e.id,
        type: e.type,
        seq: was?.seq ?? nextSeq++,
        enabled: was?.enabled ?? true,
        tags,
        behaviors,
        spawn,
        shape,
        concave: isConcave(shape),
        pose: undefined,
        extent: null,
      };
      slots.set(e.id, slot);
      if (tracking) stale.add(e.id);
      join(byType, e.type, e.id);
      for (const tag of tags) join(byTag, tag, e.id);
      for (const name of behaviors) join(byBehavior, name, e.id);
    },
    removed(id) {
      const slot = slots.get(id);
      if (!slot) return;
      unindex(slot);
      slots.delete(id);
      stale.delete(id);
      hash.remove(id);
    },
    enabledChanged(id, enabled) {
      const slot = slots.get(id);
      if (slot) slot.enabled = enabled;
    },
    clear() {
      slots.clear();
      byType.clear();
      byTag.clear();
      byBehavior.clear();
      hash.clear();
      geometry.clear();
      stale.clear();
      tracking = false;
      nextSeq = 0;
    },
  };
}
