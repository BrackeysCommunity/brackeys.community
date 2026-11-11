import type { Collider, KinematicCharacterController, RigidBody } from "@dimforge/rapier2d";

import { TOP_DOWN_CONTROLLER } from "../game/defaults";
import { physicsOf } from "../game/physics-of";
import type { ColliderTag, EngineContext, JsonValue } from "../game/types";
import { shapeColliderDesc } from "../physics";
import type { SpaceCastHit, SpaceFilter } from "../runtime/space";
import type { ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";

/** State an object game code made for an entity holds, for a world save. */
export type SaveEntry = {
  save(): JsonValue | undefined;
  restore(state: JsonValue): void;
};

/**
 * A runtime's list of what game code made that holds state for a world
 * save, under each entity id and an owner name (`motion`, `grid-step`).
 * The runtime clears it at each load; capture writes each entry's `save`,
 * and restore hands it back to what the fresh load registered again.
 */
export type SaveRegistry = {
  /** Replaces any entry `entityId` already has for `owner`; returns its unregister. */
  register(entityId: string, owner: string, entry: SaveEntry): () => void;
};

/** The key a runtime keeps its `SaveRegistry` under on its context. */
export const SAVE_REGISTRY: unique symbol = Symbol("save registry");

/** The runtime's save registry, or null for a context without one (a bare test context). */
export function saveRegistryOf(ctx: EngineContext): SaveRegistry | null {
  return (ctx as EngineContext & { [SAVE_REGISTRY]?: SaveRegistry })[SAVE_REGISTRY] ?? null;
}

export type MotionBodyOptions = {
  /** Local, centred on 0, 0; not chain. */
  shape: ShapeObj;
  /** Collision group name; default "dynamic". */
  group?: string;
  /** Merged into the collider's tag (entityId and type come from the entity). */
  tag?: Partial<ColliderTag>;
};

export type MotionResult = {
  /** What it actually moved. */
  moved: Vec2;
  hits: SpaceCastHit[];
  /** True when the full delta couldn't be travelled. */
  blocked: boolean;
};

/** A body moved by code that writes its entity's pose. */
export interface MotionBody {
  readonly entityId: string;
  readonly handle: number;
  position(): Vec2;
  /** Moves by `delta`, sliding along what it hits (at most 4 iterations); writes the pose index. */
  move(delta: Vec2, opts?: { slide?: boolean }): MotionResult;
  /** Puts it at (x, y) with no sweep; the pose snaps. */
  teleport(x: number, y: number): void;
  /** A disabled body is out of the world: nothing hits it, and its moves travel in full. */
  setEnabled(enabled: boolean): void;
  /** m/s, kept for the controller moving it (`createTopDownController`); a world save keeps it. */
  velocity(): Vec2;
  setVelocity(v: Vec2): void;
  destroy(): void;
}

/** The `motion` owner's state in a world save. */
type SavedBody = { at: [number, number]; v?: [number, number]; off?: true };

function readSavedBody(state: JsonValue): SavedBody | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const pair = (p: JsonValue | undefined): p is [number, number] =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((n) => typeof n === "number" && Number.isFinite(n));
  const { at, v, off } = state;
  if (!pair(at) || (v !== undefined && !pair(v))) return null;
  return { at, ...(v ? { v } : {}), ...(off === true ? { off } : {}) };
}

/** Sweep-and-slide passes per move. */
const MAX_SLIDES = 4;
/** The gap kept from what a move hits, the same as the Rapier controller's. */
const SKIN = TOP_DOWN_CONTROLLER.offset ?? 0.0001;
/** Travel lost along the delta, m, below which a move counts as complete. */
const BLOCK_EPSILON = 1e-5;

const ZERO: Vec2 = { x: 0, y: 0 };
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

/** The one blocked rule for both backends: some of `delta` was lost along its own direction. */
function lostTravel(delta: Vec2, moved: Vec2): boolean {
  const len = Math.sqrt(dot(delta, delta));
  if (len === 0) return false;
  return (dot(delta, delta) - dot(moved, delta)) / len > BLOCK_EPSILON;
}

/** Backend operations behind a motion body. */
type Backend = {
  handle: number;
  /** Moves from `from` by `delta`; returns the travel and what it hit. */
  move(from: Vec2, delta: Vec2, slide: boolean): { moved: Vec2; hits: SpaceCastHit[] };
  place(at: Vec2, snap: boolean): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
};

/** Rapier: a kinematic position-based body moved by a top-down character controller. */
function rapierBackend(
  ctx: EngineContext,
  entityId: string,
  at: Vec2,
  opts: MotionBodyOptions,
  groups: number,
  tag: ColliderTag,
): Backend {
  const { rapier, physics } = physicsOf(ctx, "motion bodies", entityId);
  const body: RigidBody = physics.addRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y),
  );
  const collider: Collider = physics.addCollider(
    shapeColliderDesc(rapier, opts.shape, true).setCollisionGroups(groups),
    body,
  );
  ctx.tags.set(collider.handle, tag);
  const controller: KinematicCharacterController =
    physics.createCharacterController(TOP_DOWN_CONTROLLER);
  // The controller still splits moves along `up`, and at a slide limit of a
  // right angle it drops the "downward" part of a slide along a vertical
  // wall. A top-down body has no up: every slope climbs and every one slides.
  controller.setMaxSlopeClimbAngle(Math.PI);
  controller.setMinSlopeSlideAngle(0);

  return {
    handle: collider.handle,
    move(_from, delta, slide) {
      controller.setSlideEnabled(slide);
      controller.computeColliderMovement(
        collider,
        new rapier.Vector2(delta.x, delta.y),
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        collider.collisionGroups(),
      );
      const m = controller.computedMovement();
      const len = Math.sqrt(dot(delta, delta));
      const hits: SpaceCastHit[] = [];
      for (let i = 0; i < controller.numComputedCollisions(); i++) {
        const c = controller.computedCollision(i);
        const hitTag = c?.collider ? ctx.tags.get(c.collider.handle) : undefined;
        if (!c?.collider || !hitTag) continue;
        const applied = c.translationDeltaApplied;
        const n = Math.sqrt(c.normal1.x * c.normal1.x + c.normal1.y * c.normal1.y);
        hits.push({
          handle: c.collider.handle,
          tag: hitTag,
          at: { x: c.witness1.x, y: c.witness1.y },
          toi: len === 0 ? 0 : Math.min(1, Math.sqrt(dot(applied, applied)) / len),
          normal: n === 0 ? { ...ZERO } : { x: c.normal1.x / n, y: c.normal1.y / n },
        });
      }
      return { moved: { x: m.x, y: m.y }, hits };
    },
    place(p, snap) {
      const v = new rapier.Vector2(p.x, p.y);
      // The collider moves now, so later moves and queries this tick start from
      // here; the body follows at the step, as a kinematic body's next position.
      collider.setTranslation(v);
      if (snap) body.setTranslation(v, true);
      else body.setNextKinematicTranslation(v);
    },
    setEnabled(enabled) {
      body.setEnabled(enabled);
      collider.setEnabled(enabled);
      // Character controllers don't skip disabled colliders; groups 0 gates it off for them too.
      collider.setCollisionGroups(enabled ? groups : 0);
    },
    destroy() {
      ctx.tags.delete(collider.handle);
      physics.world.removeCharacterController(controller);
      physics.removeRigidBody(body);
    },
  };
}

/** Geometry: a kinematic collider moved by sweeping it and sliding along what it hits. */
function geometryBackend(
  ctx: EngineContext,
  entityId: string,
  at: Vec2,
  opts: MotionBodyOptions,
  group: string,
  tag: ColliderTag,
): Backend {
  const world = ctx.geometry;
  if (!world) throw new Error(`motion body "${entityId}" needs a loaded scene`);
  const handle = world.add({
    shape: opts.shape,
    body: "kinematic",
    group,
    pose: { x: at.x, y: at.y, rot: 0 },
  });
  ctx.tags.set(handle, tag);
  const filter: SpaceFilter = { exclude: [entityId], group };

  return {
    handle,
    move(from, delta, slide) {
      const hits: SpaceCastHit[] = [];
      let x = from.x;
      let y = from.y;
      let rest = delta;
      for (let i = 0; i < MAX_SLIDES && (rest.x !== 0 || rest.y !== 0); i++) {
        world.setPose(handle, x, y, 0);
        const shape = world.shape(handle);
        const hit = shape ? ctx.space.sweep(shape, rest, filter) : null;
        if (!hit) {
          x += rest.x;
          y += rest.y;
          break;
        }
        hits.push(hit);
        const n = hit.normal;
        x += rest.x * hit.toi + n.x * SKIN;
        y += rest.y * hit.toi + n.y * SKIN;
        if (!slide) break;
        const left = { x: rest.x * (1 - hit.toi), y: rest.y * (1 - hit.toi) };
        const into = dot(left, n);
        rest = into < 0 ? { x: left.x - n.x * into, y: left.y - n.y * into } : left;
      }
      world.setPose(handle, from.x, from.y, 0);
      return { moved: { x: x - from.x, y: y - from.y }, hits };
    },
    place(p) {
      world.setPose(handle, p.x, p.y, 0);
    },
    setEnabled(enabled) {
      world.setEnabled(handle, enabled);
    },
    destroy() {
      ctx.tags.delete(handle);
      world.remove(handle);
    },
  };
}

/** Rapier: a kinematic position-based body with a TOP_DOWN_CONTROLLER character controller; geometry: a kinematic collider, sweep and slide. */
export function createMotionBody(
  ctx: EngineContext,
  entity: { id: string; type: string },
  at: Vec2,
  opts: MotionBodyOptions,
): MotionBody {
  if (opts.shape.type === "chain") throw new Error(`motion body "${entity.id}" can't be a chain`);
  const group = opts.group ?? "dynamic";
  const groups = ctx.registry.collisionGroups(group);
  const tag: ColliderTag = { ...opts.tag, entityId: entity.id, type: entity.type };
  const backend =
    ctx.space.backend === "rapier"
      ? rapierBackend(ctx, entity.id, at, opts, groups, tag)
      : geometryBackend(ctx, entity.id, at, opts, group, tag);

  let pos: Vec2 = { x: at.x, y: at.y };
  let velocity: Vec2 = { x: 0, y: 0 };
  let enabled = true;
  let destroyed = false;
  ctx.poses.set(entity.id, pos.x, pos.y, undefined, { snap: true });

  const live = (what: string) => {
    if (destroyed) throw new Error(`motion body "${entity.id}" was destroyed before ${what}`);
  };

  const unregister = saveRegistryOf(ctx)?.register(entity.id, "motion", {
    save() {
      const saved: SavedBody = { at: [pos.x, pos.y] };
      if (velocity.x !== 0 || velocity.y !== 0) saved.v = [velocity.x, velocity.y];
      if (!enabled) saved.off = true;
      return saved;
    },
    restore(state) {
      const saved = readSavedBody(state);
      if (!saved || destroyed) return;
      body.setEnabled(saved.off !== true);
      body.teleport(saved.at[0], saved.at[1]);
      velocity = saved.v ? { x: saved.v[0], y: saved.v[1] } : { x: 0, y: 0 };
    },
  });

  const body: MotionBody = {
    entityId: entity.id,
    handle: backend.handle,
    position: () => ({ ...pos }),
    move(delta, moveOpts) {
      live("move");
      const { moved, hits } = enabled
        ? backend.move(pos, delta, moveOpts?.slide !== false)
        : { moved: { x: delta.x, y: delta.y }, hits: [] };
      pos = { x: pos.x + moved.x, y: pos.y + moved.y };
      backend.place(pos, false);
      ctx.poses.set(entity.id, pos.x, pos.y);
      return { moved, hits, blocked: lostTravel(delta, moved) };
    },
    teleport(x, y) {
      live("teleport");
      pos = { x, y };
      backend.place(pos, true);
      ctx.poses.set(entity.id, x, y, undefined, { snap: true });
    },
    setEnabled(next) {
      live("setEnabled");
      if (next === enabled) return;
      enabled = next;
      backend.setEnabled(next);
    },
    velocity: () => ({ ...velocity }),
    setVelocity(v) {
      velocity = { x: v.x, y: v.y };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unregister?.();
      backend.destroy();
    },
  };
  return body;
}
