import { z } from "zod";

import type {
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "../../game/behaviors";
import type { ColliderBlock } from "../../game/behaviors/collider";
import {
  forceAreaSensorMessage,
  type ForceAreaBlock,
  type ForceAreaSystem,
} from "../../game/behaviors/force-area";
import { EngineError, type EngineContext, type JsonValue } from "../../game/types";
import { parseShape } from "../../scene/shapes";
import type { RuntimeEntity, ShapeObj } from "../../scene/types";
import type { Pose } from "../poses";
import { SENSOR_ENTER, SENSOR_EXIT, type StepEvent } from "../types";

type Vec2 = { x: number; y: number };

type Area = {
  id: string;
  block: ForceAreaBlock;
  /** False while the entity is disabled. */
  on: boolean;
  /** What its sensor reports inside, in the order it entered. */
  inside: Set<string>;
  /** The collider's farthest point from the pose, for linear falloff, keyed by the shape it was measured from. */
  reach: { shape: unknown; r: number } | null;
};

const length = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** How far the shape reaches from its entity's pose, m. */
function farthest(shape: ShapeObj): number {
  const corners = (pts: readonly (readonly [number, number])[]) =>
    pts.reduce((r, [x, y]) => Math.max(r, length(x, y)), 0);
  switch (shape.type) {
    case "circle":
      return length(shape.cx, shape.cy) + shape.r;
    case "box": {
      const a = (shape.rotDeg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const at = (x: number, y: number): [number, number] => [
        shape.cx + x * c - y * s,
        shape.cy + x * s + y * c,
      ];
      const { hw, hh } = shape;
      return corners([at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)]);
    }
    case "capsule": {
      const a = (shape.rotDeg * Math.PI) / 180;
      const dx = -Math.sin(a) * shape.halfLen;
      const dy = Math.cos(a) * shape.halfLen;
      return (
        corners([
          [shape.cx - dx, shape.cy - dy],
          [shape.cx + dx, shape.cy + dy],
        ]) + shape.r
      );
    }
    case "poly":
    case "chain":
      return corners(shape.pts);
  }
}

/**
 * The `force-area` behavior's system. Each area tracks what its sensor
 * collider reports inside, from `sensor:enter` and `sensor:exit`, and each
 * tick pushes every dynamic body there that `affects` takes through
 * `ctx.bodies`: its acceleration times the body's mass, plus `drag`
 * against the body's velocity. `sample` gives the same acceleration, drag
 * aside, at any point, for kinematic controllers to add, filtered by
 * `affects` for the entity it is asked for. A world save holds
 * what is inside each area.
 */
export const createForceAreaSystem: BehaviorSystemFactory = (
  ctx: EngineContext,
  def: RegisteredBehavior,
) => {
  const schema = z.object(def.shape);
  const areas = new Map<string, Area>();
  let unsubscribe: (() => void) | null = null;

  function withDefaults(block: ForceAreaBlock): ForceAreaBlock {
    const parsed = schema.safeParse(block);
    return parsed.success ? (parsed.data as ForceAreaBlock) : block;
  }

  function colliderOf(e: RuntimeEntity): Partial<ColliderBlock> {
    const collider = e.behaviors?.collider as Partial<ColliderBlock> | undefined;
    if (!collider)
      throw new EngineError(
        "behavior-missing",
        `${e.id}'s behavior "force-area" requires "collider", which ${e.id} doesn't carry`,
        e.id,
      );
    if (collider.sensor !== true)
      throw new EngineError("schema", forceAreaSensorMessage(e.id), e.id);
    return collider;
  }

  function onSensor(event: StepEvent): void {
    if (event.entityId === undefined || event.other === undefined) return;
    const area = areas.get(event.entityId);
    if (!area?.on) return;
    if (event.type === SENSOR_ENTER) area.inside.add(event.other);
    else area.inside.delete(event.other);
  }

  function subscribe(): void {
    if (unsubscribe) return;
    const enter = ctx.events.on(SENSOR_ENTER, onSensor);
    const exit = ctx.events.on(SENSOR_EXIT, onSensor);
    unsubscribe = () => {
      enter();
      exit();
    };
  }

  function reachOf(area: Area): number {
    const shape = ctx.get(area.id)?.behaviors?.collider?.shape as unknown;
    if (area.reach && area.reach.shape === shape) return area.reach.r;
    const parsed = parseShape(shape);
    const r = parsed.ok ? farthest(parsed.shape) : 0;
    area.reach = { shape, r };
    return r;
  }

  /** The acceleration `area`, posed at `pose`, gives at `p`, m/s². */
  function field(area: Area, pose: Pose, p: Vec2): Vec2 {
    const { block } = area;
    if (block.kind !== "point") {
      const [fx, fy] = block.force ?? [0, 0];
      if (pose.rot === 0) return { x: fx, y: fy };
      const c = Math.cos(pose.rot);
      const s = Math.sin(pose.rot);
      return { x: fx * c - fy * s, y: fx * s + fy * c };
    }
    const dx = pose.x - p.x;
    const dy = pose.y - p.y;
    const d = length(dx, dy);
    if (d === 0) return { x: 0, y: 0 };
    let a = block.strength ?? 0;
    if (block.falloff === "linear") {
      const r = reachOf(area);
      a = r > 0 ? a * Math.max(0, 1 - d / r) : 0;
    } else if (block.falloff === "inverse-square") {
      const past = Math.max(d, 1);
      a /= past * past;
    }
    return { x: (a * dx) / d, y: (a * dy) / d };
  }

  /**
   * A collider's packed collision groups, from whichever world holds it; 0
   * while it is out of the world, as a collider a motion body stands in for is.
   */
  function groupsOf(handle: number): number {
    if (ctx.physics) {
      const c = ctx.physics.world.getCollider(handle);
      return c?.isEnabled() ? c.collisionGroups() : 0;
    }
    return ctx.geometry?.groups(handle) ?? 0;
  }

  /**
   * Whether `affects` takes `id`: in one of its collision groups and carrying
   * one of its tags, each when given. A group the game doesn't declare takes
   * nothing. `tagged` is the set of entities with one of the tags, for a loop
   * over many; without it `id`'s own tags are looked up.
   */
  function takes(area: Area, id: string, tagged?: Set<string> | null): boolean {
    const { groups, tags } = area.block.affects ?? {};
    if (groups) {
      let want = 0;
      const known = ctx.registry.collisionGroupNames;
      for (const g of groups) if (known.includes(g)) want |= ctx.registry.collisionGroups(g) >>> 16;
      const member = ctx.tags.handlesOf(id).some((h) => ((groupsOf(h) >>> 16) & want) !== 0);
      if (!member) return false;
    }
    if (!tags) return true;
    if (tagged) return tagged.has(id);
    return tags.some((t) => ctx.query.byTag(t).includes(id));
  }

  /** The entities carrying one of `affects.tags`, or null when it names none. */
  function taggedBy(area: Area): Set<string> | null {
    const tags = area.block.affects?.tags;
    return tags ? new Set(tags.flatMap((t) => ctx.query.byTag(t))) : null;
  }

  function push(area: Area, dt: number): void {
    const pose = ctx.poses.get(area.id);
    if (!pose) return;
    const tagged = taggedBy(area);
    const drag = Math.min(area.block.drag, 1 / dt);
    for (const id of area.inside) {
      if (ctx.bodies.kind(id) !== "dynamic" || !takes(area, id, tagged)) continue;
      const at = ctx.poses.get(id);
      if (!at) continue;
      const a = field(area, pose, at);
      if (drag > 0) {
        const v = ctx.bodies.velocity(id);
        a.x -= drag * v.x;
        a.y -= drag * v.y;
      }
      if (a.x === 0 && a.y === 0) continue;
      const m = ctx.bodies.mass(id);
      ctx.bodies.applyForce(id, { x: a.x * m, y: a.y * m });
    }
  }

  const system: ForceAreaSystem = {
    attach(id, block, e) {
      colliderOf(e);
      subscribe();
      areas.set(id, { id, block: withDefaults(block), on: true, inside: new Set(), reach: null });
    },
    update(id, block, _prev, e) {
      colliderOf(e);
      const area = areas.get(id);
      if (area) area.block = withDefaults(block);
    },
    detach(id) {
      areas.delete(id);
    },
    beforeStep() {
      if (areas.size === 0 || !ctx.physics) return;
      const dt = ctx.time.tickMs / 1000;
      for (const area of areas.values()) if (area.on && area.inside.size > 0) push(area, dt);
    },
    /** Its collider forgets what is inside and raises enters again on enable, so this forgets too. */
    disable(id) {
      const area = areas.get(id);
      if (!area) return;
      area.on = false;
      area.inside.clear();
    },
    enable(id) {
      const area = areas.get(id);
      if (area) area.on = true;
    },
    reset() {
      for (const area of areas.values()) area.inside.clear();
    },
    clear() {
      areas.clear();
      unsubscribe?.();
      unsubscribe = null;
    },
    size: () => areas.size,
    save(id) {
      const area = areas.get(id);
      if (!area || area.inside.size === 0) return undefined;
      return { inside: [...area.inside] };
    },
    restore(id, state: JsonValue) {
      const area = areas.get(id);
      if (!area || typeof state !== "object" || state === null || Array.isArray(state)) return;
      area.inside.clear();
      const { inside } = state as Record<string, unknown>;
      if (Array.isArray(inside))
        for (const other of inside) if (typeof other === "string") area.inside.add(other);
    },
    sample(point, entityId) {
      const sum = { x: 0, y: 0 };
      if (areas.size === 0) return sum;
      const hits = ctx.space.pointAt(point, { sensors: true });
      if (hits.length === 0) return sum;
      for (const area of areas.values()) {
        if (!area.on || !hits.some((h) => h.tag.entityId === area.id)) continue;
        if (entityId !== undefined && !takes(area, entityId)) continue;
        const pose = ctx.poses.get(area.id);
        if (!pose) continue;
        const a = field(area, pose, point);
        sum.x += a.x;
        sum.y += a.y;
      }
      return sum;
    },
  };
  return system as BehaviorSystem;
};
