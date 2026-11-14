import type { Collider, ColliderDesc, RigidBody, RigidBodyDesc } from "@dimforge/rapier2d";

import { createSensorCollider } from "../../collisions";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import { BODY, type BodyBlock } from "../../game/behaviors/body";
import type { ColliderBlock, ColliderSystem } from "../../game/behaviors/collider";
import { physicsOf } from "../../game/physics-of";
import {
  EngineError,
  type ColliderTag,
  type EngineContext,
  type JsonValue,
} from "../../game/types";
import { shapeColliderDesc, shapePose } from "../../physics";
import { parseShape } from "../../scene/shapes";
import type { RuntimeEntity, ShapeObj } from "../../scene/types";
import type { Attachment } from "../../systems/attachments";
import {
  createOverlapTracker,
  moveBodyNow,
  restoreOverlaps,
  saveOverlaps,
  type Overlaps,
} from "../../systems/bodies";
import {
  kinematicBodyEntry,
  rapierBodyEntry,
  registerBody,
  type BodyEntry,
} from "../bodies-control";
import { composePose, relativePose, type Pose } from "../poses";
import type { SpaceHit } from "../space";

type Vec = { x: number; y: number };
/** What carries the collider: a fixed body (no `body` block, or a static one), a kinematic or a dynamic one. */
type Kind = "fixed" | "kinematic" | "dynamic";

type Built = {
  entity: RuntimeEntity;
  /** The blocks it was built from; a rebuild with the same blocks and pose does nothing. */
  blocks: string;
  pose: Pose;
  kind: Kind;
  shape: ShapeObj;
  group: string;
  sensor: boolean;
  body: RigidBody | null;
  collider: Collider | null;
  /** Its seat on the body above it, when a fixed collider rides one instead of a body of its own. */
  attachment: Attachment | null;
  /** The host it rides. */
  riding: string | null;
  /** The entity's pose in the host body's frame, once its collider is on it. */
  rideOffset: Pose | null;
  /** The geometry world's collider, while the scene has no physics. */
  handle: number | null;
  /** The entity's pose in its Rapier body's frame. */
  offset: Pose;
  /** The Rapier body's pose in the entity's frame: the shape's own centre and turn. */
  frame: Pose;
  /** A kinematic body's velocity, m/s: code sets it, the step moves the body by it. */
  v: Vec;
  /** A kinematic body's angular velocity, rad/s, about the entity's pose. */
  w: number;
  inside: Overlaps;
  /** What a geometry sensor overlapped at the end of the last step: the next step's enters and exits. */
  next: Overlaps | null;
  /**
   * A restored sensor's saved overlaps, by entity id and collider index. They
   * become handles at the next step, after every restore has rebuilt its
   * colliders, since a rebuild gives a collider a new handle.
   */
  restored: { inside: JsonValue | undefined; next: JsonValue | undefined } | null;
  /** The pose last written while the body slept: a sleeping body that wrote it hasn't moved since. */
  rested: Readonly<Pose> | undefined;
  disabled: boolean;
  /** Another body stands in for this one (`standIn`): out of the world and of `ctx.bodies` until released. */
  stood: boolean;
  unregister: () => void;
};

const ZERO: Pose = { x: 0, y: 0, rot: 0 };

const moving = (b: Built) => b.v.x !== 0 || b.v.y !== 0 || b.w !== 0;

/** Out of the world: disabled, or stood in for. */
const off = (b: Built) => b.disabled || b.stood;

/** The collider it built: its own, or the one on the body it rides (null while that has no body). */
const colliderOf = (b: Built): Collider | null =>
  b.attachment ? b.attachment.collider() : b.collider;

const kindOf = (body: Partial<BodyBlock> | undefined): Kind => {
  if (!body) return "fixed";
  const kind = body.kind ?? "dynamic";
  return kind === "static" ? "fixed" : kind;
};

function shapeOf(block: ColliderBlock, entityId: string): ShapeObj {
  const parsed = parseShape(block.shape, `${entityId}.behaviors.collider.shape`);
  if (!parsed.ok) throw new EngineError("schema", parsed.issue.message, entityId);
  return parsed.shape;
}

/**
 * The `collider` behavior's system. It owns the entity's physics body and
 * collider for its `collider` and `body` blocks both: a fixed body without
 * `body` (or with a static one), a kinematic body moved by the velocity
 * code gives it through `ctx.bodies`, or a dynamic body that writes the
 * entity's pose after each step. The shape is local to the entity's pose.
 * Without physics, fixed and kinematic colliders go to the geometry world
 * and a dynamic body is `physics-required`. A sensor collider raises
 * `sensor:enter` and `sensor:exit` as the `sensor` type does. A kinematic
 * or dynamic body offers itself for colliders to ride; a fixed collider
 * under such a body rides it instead of having one of its own.
 */
export const createColliderSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const built = new Map<string, Built>();
  /** The body above each entity the tree said carries its collider. */
  const rides = new Map<string, string | null>();
  const overlaps = createOverlapTracker(ctx);
  const tickSeconds = () => ctx.time.tickMs / 1000;

  /**
   * The group of a collider whose block sets none: a body's by its kind; a
   * sensor's is `sensor`, which a game links to what it should see, but in a
   * project with no game, which can't link groups, it is `dynamic`, so it
   * meets the dynamic and motion bodies there.
   */
  function defaultGroup(sensor: boolean, kind: Kind): string {
    if (sensor) return ctx.registry.game ? "sensor" : "dynamic";
    return kind === "dynamic" ? "dynamic" : "static";
  }

  function tagOf(e: RuntimeEntity, block: ColliderBlock): ColliderTag {
    const tag: ColliderTag = { entityId: e.id, type: e.type };
    if (block.material !== undefined) tag.material = block.material;
    return tag;
  }

  function surfaceOf(block: ColliderBlock): { friction?: number; restitution?: number } {
    if (block.material === undefined) return block;
    const material = ctx.registry.materials.get(block.material);
    if (!material) throw new Error(`unknown material "${block.material}"`);
    return {
      friction: block.friction ?? material.friction,
      restitution: block.restitution ?? material.restitution,
    };
  }

  /** The body's desc with only the fields `body` sets, as a `prop`'s, so the rest keep Rapier's defaults. */
  function bodyDesc(desc: RigidBodyDesc, body: Partial<BodyBlock>, at: Pose): RigidBodyDesc {
    desc.setTranslation(at.x, at.y).setRotation(at.rot);
    if (body.gravityScale !== undefined) desc.setGravityScale(body.gravityScale);
    if (body.linearDamping !== undefined) desc.setLinearDamping(body.linearDamping);
    if (body.angularDamping !== undefined) desc.setAngularDamping(body.angularDamping);
    if (body.fixedRotation === true) desc.lockRotations();
    if (body.ccd !== undefined) desc.setCcdEnabled(body.ccd);
    return desc;
  }

  function entryOf(b: Built): BodyEntry {
    const id = b.entity.id;
    if (b.kind === "kinematic") {
      const body = b.entity.behaviors?.[BODY.name] as Partial<BodyBlock> | undefined;
      return kinematicBodyEntry(id, {
        velocity: () => ({ x: b.v.x, y: b.v.y }),
        setVelocity(v) {
          b.v = { x: v.x, y: v.y };
        },
        ...(body?.fixedRotation === true
          ? {}
          : {
              angularVelocity: () => b.w,
              setAngularVelocity(w: number) {
                b.w = w;
              },
            }),
        wake: () => b.body?.wakeUp(),
      });
    }
    return rapierBodyEntry(id, b.body!, b.kind === "dynamic" ? "dynamic" : "static");
  }

  function remove(id: string): Built | undefined {
    const b = built.get(id);
    if (!b) return undefined;
    built.delete(id);
    b.unregister();
    if (b.handle !== null) {
      ctx.tags.delete(b.handle);
      ctx.geometry?.remove(b.handle);
    }
    b.attachment?.detach();
    if (b.collider) ctx.tags.delete(b.collider.handle);
    if (b.body) {
      if (b.kind !== "fixed") ctx.attachments.unhost(id);
      physicsOf(ctx, "a collider", id).physics.removeRigidBody(b.body);
    }
    return b;
  }

  /** The host a fixed collider on `id` rides: the one the tree named, while it offers a body. */
  function hostFor(id: string): string | null {
    const host = rides.get(id);
    return host != null && ctx.attachments.hosted(host) ? host : null;
  }

  /** The collider for `block` on `body`, tagged `tag`. */
  function colliderOn(
    body: RigidBody,
    desc: ColliderDesc,
    block: ColliderBlock,
    sensor: boolean,
    group: string,
    tag: ColliderTag,
  ): Collider {
    let collider: Collider;
    if (sensor) {
      collider = createSensorCollider(ctx, body, desc);
      if (group !== "sensor") collider.setCollisionGroups(ctx.registry.collisionGroups(group));
    } else {
      const surface = surfaceOf(block);
      desc.setCollisionGroups(ctx.registry.collisionGroups(group)).setDensity(block.density ?? 1);
      if (surface.friction !== undefined) desc.setFriction(surface.friction);
      if (surface.restitution !== undefined) desc.setRestitution(surface.restitution);
      collider = physicsOf(ctx, "a collider").physics.addCollider(desc, body);
    }
    ctx.tags.set(collider.handle, tag);
    return collider;
  }

  /** The body and collider for `e`'s blocks at its pose now, replacing any it had; unless `force`, kept when those are unchanged. */
  function build(e: RuntimeEntity, block: ColliderBlock, force = false): void {
    const bodyBlock = e.behaviors?.[BODY.name] as Partial<BodyBlock> | undefined;
    const blocks = JSON.stringify([block, bodyBlock ?? null]);
    const pose: Pose = { ...(ctx.poses.get(e.id) ?? ZERO) };
    const was = built.get(e.id);
    if (
      !force &&
      was &&
      was.blocks === blocks &&
      was.pose.x === pose.x &&
      was.pose.y === pose.y &&
      was.pose.rot === pose.rot
    ) {
      was.entity = e;
      return;
    }
    const kind = kindOf(bodyBlock);
    if (kind === "dynamic" && !ctx.physics) physicsOf(ctx, "a dynamic body", e.id);
    const shape = shapeOf(block, e.id);
    let carried = { v: { x: 0, y: 0 }, w: 0 };
    if (was?.kind === kind) {
      carried =
        kind === "dynamic" && was.body
          ? { v: { ...was.body.linvel() }, w: was.body.angvel() }
          : { v: was.v, w: was.w };
    }
    remove(e.id);
    const sensor = block.sensor === true;
    const group = block.group ?? defaultGroup(sensor, kind);
    const tag = tagOf(e, block);
    const b: Built = {
      entity: e,
      blocks,
      pose,
      kind,
      shape,
      group,
      sensor,
      body: null,
      collider: null,
      attachment: null,
      riding: null,
      rideOffset: null,
      handle: null,
      offset: ZERO,
      frame: ZERO,
      v: kind === "kinematic" ? carried.v : { x: 0, y: 0 },
      w: kind === "kinematic" && bodyBlock?.fixedRotation !== true ? carried.w : 0,
      inside: was && was.blocks === blocks ? was.inside : new Map(),
      next: null,
      restored: was && was.blocks === blocks ? was.restored : null,
      rested: undefined,
      disabled: was?.disabled ?? false,
      stood: was?.stood ?? false,
      unregister: () => {},
    };
    if (!ctx.physics) {
      const world = ctx.geometry;
      if (world) {
        b.handle = world.add({
          shape,
          pose,
          body: kind === "kinematic" ? "kinematic" : "static",
          sensor,
          group,
        });
        ctx.tags.set(b.handle, tag);
        if (off(b)) world.setEnabled(b.handle, false);
      }
    } else {
      const { rapier, physics } = physicsOf(ctx, "a collider", e.id);
      const centre = shapePose(shape);
      const frame: Pose = { x: centre.x, y: centre.y, rot: centre.rotation };
      b.frame = frame;
      const host = kind === "fixed" ? hostFor(e.id) : null;
      if (host !== null) {
        b.riding = host;
        b.attachment = ctx.attachments.attach(e.id, host, (h) => {
          const t = h.body.translation();
          const offset = relativePose(b.pose, { x: t.x, y: t.y, rot: h.body.rotation() });
          b.rideOffset = offset;
          const at = composePose(offset.x, offset.y, offset.rot, frame);
          const desc = shapeColliderDesc(rapier, shape)
            .setTranslation(at.x, at.y)
            .setRotation(at.rot);
          const collider = colliderOn(h.body, desc, block, sensor, group, {
            ...tag,
            carrier: { entityId: h.id, type: h.type },
          });
          if (off(b)) collider.setEnabled(false);
          return collider;
        });
        built.set(e.id, b);
        return;
      }
      const at = composePose(pose.x, pose.y, pose.rot, frame);
      const desc =
        kind === "dynamic"
          ? rapier.RigidBodyDesc.dynamic()
          : kind === "kinematic"
            ? rapier.RigidBodyDesc.kinematicPositionBased()
            : rapier.RigidBodyDesc.fixed();
      const body = physics.addRigidBody(bodyDesc(desc, bodyBlock ?? {}, at));
      const collider = colliderOn(
        body,
        shapeColliderDesc(rapier, shape),
        block,
        sensor,
        group,
        tag,
      );
      b.body = body;
      b.collider = collider;
      b.offset = relativePose(pose, at);
      if (kind === "dynamic" && (carried.v.x !== 0 || carried.v.y !== 0 || carried.w !== 0)) {
        body.setLinvel(carried.v, true);
        body.setAngvel(carried.w, true);
      }
      if (off(b)) {
        body.setEnabled(false);
        collider.setEnabled(false);
      }
    }
    built.set(e.id, b);
    if (!b.stood && (ctx.physics || kind === "kinematic")) {
      b.unregister = registerBody(ctx, e.id, entryOf(b));
    }
    if (b.body && kind !== "fixed") ctx.attachments.host(e.id, e.type, b.body);
  }

  function writePose(b: Built, x: number, y: number, rot: number): void {
    const p = composePose(x, y, rot, b.offset);
    ctx.poses.set(b.entity.id, p.x, p.y, p.rot);
    b.pose = { x: p.x, y: p.y, rot: p.rot };
  }

  /**
   * Moves the kinematic bodies by their velocities over one tick: Rapier's
   * next pose, or the geometry collider now. A turning body turns about its
   * entity's pose on both backends.
   */
  function moveKinematic(): void {
    const dt = tickSeconds();
    for (const b of built.values()) {
      if (b.kind !== "kinematic" || off(b) || !moving(b)) continue;
      if (b.body) {
        const t = b.body.translation();
        if (b.w === 0) {
          b.body.setNextKinematicTranslation({ x: t.x + b.v.x * dt, y: t.y + b.v.y * dt });
          continue;
        }
        const e = composePose(t.x, t.y, b.body.rotation(), b.offset);
        const next = composePose(e.x + b.v.x * dt, e.y + b.v.y * dt, e.rot + b.w * dt, b.frame);
        b.body.setNextKinematicTranslation({ x: next.x, y: next.y });
        b.body.setNextKinematicRotation(next.rot);
        continue;
      }
      const from = ctx.poses.get(b.entity.id) ?? b.pose;
      const x = from.x + b.v.x * dt;
      const y = from.y + b.v.y * dt;
      const rot = b.w === 0 ? from.rot : from.rot + b.w * dt;
      ctx.poses.set(b.entity.id, x, y, rot);
      b.pose = { x, y, rot };
      if (b.handle !== null) ctx.geometry?.setPose(b.handle, x, y, rot);
    }
  }

  /** Writes the entity's pose from each Rapier body that moved this step. */
  function poseBodies(): void {
    for (const b of built.values()) {
      if (!b.body || off(b) || b.kind === "fixed") continue;
      if (b.kind === "kinematic") {
        if (!moving(b)) continue;
      } else {
        const asleep = b.body.isSleeping();
        if (asleep && b.rested !== undefined && b.rested === ctx.poses.get(b.entity.id)) continue;
        const t = b.body.translation();
        writePose(b, t.x, t.y, b.body.rotation());
        b.rested = asleep ? ctx.poses.get(b.entity.id) : undefined;
        continue;
      }
      const t = b.body.translation();
      writePose(b, t.x, t.y, b.body.rotation());
    }
  }

  /**
   * Where a geometry collider's body would be on Rapier: its entity's
   * position when its system reports one, else the hit's point.
   */
  function originOf(hit: SpaceHit | undefined, handle: number): Vec {
    const tag = hit?.tag ?? ctx.tags.get(handle);
    if (tag) {
      const system = ctx.system(tag.type) as { position?: (id: string) => Vec | null } | undefined;
      const at = system?.position?.(tag.entityId);
      if (at) return { x: at.x, y: at.y };
    }
    return hit ? { x: hit.at.x, y: hit.at.y } : { x: 0, y: 0 };
  }

  /** What overlaps a geometry sensor now, against what its group meets, in handle order. */
  function geometryOverlaps(b: Built): { now: Overlaps; hits: Map<number, SpaceHit> } {
    const now: Overlaps = new Map();
    const hits = new Map<number, SpaceHit>();
    const shape = b.handle !== null ? ctx.geometry?.shape(b.handle) : undefined;
    if (!shape) return { now, hits };
    for (const hit of ctx.space.overlaps(shape, { group: b.group })) {
      if (hit.handle === b.handle) continue;
      now.set(hit.handle, hit.tag.entityId);
      hits.set(hit.handle, hit);
    }
    return { now, hits };
  }

  /**
   * Raises each sensor's enters and exits for this step. On Rapier they
   * are what intersects it after the step; in the geometry world, what
   * overlapped it at the end of the last step, which is where the `sensor`
   * type takes its own, before anything moves.
   */
  function settle(b: Built): void {
    if (!b.restored) return;
    b.inside = restoreOverlaps(ctx.tags, b.restored.inside);
    b.next = b.restored.next === undefined ? null : restoreOverlaps(ctx.tags, b.restored.next);
    b.restored = null;
  }

  function raiseSensors(): void {
    let colliders: Collider[] | null = null;
    for (const [id, b] of built) {
      if (!b.sensor || off(b)) continue;
      settle(b);
      const collider = colliderOf(b);
      if (collider) {
        const { physics } = physicsOf(ctx, "a sensor collider", id);
        colliders ??= physics.world.colliders.getAll();
        const now: Overlaps = new Map();
        for (const other of colliders) {
          if (other !== collider && physics.world.intersectionPair(collider, other))
            now.set(other.handle, ctx.tags.get(other.handle)?.entityId);
        }
        overlaps.diff(id, b.inside, now, (handle) => {
          const t = (
            physics.world.getCollider(handle)?.parent() ?? collider.parent()
          )?.translation();
          return t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
        });
        b.inside = now;
        continue;
      }
      const taken = geometryOverlaps(b);
      const now = b.next ?? taken.now;
      overlaps.diff(id, b.inside, now, (handle) => originOf(taken.hits.get(handle), handle));
      b.inside = now;
      b.next = taken.now;
    }
  }

  function blockOf(e: RuntimeEntity): ColliderBlock | undefined {
    return e.behaviors?.collider as ColliderBlock | undefined;
  }

  /** Puts `b`'s body and collider in or out of the world. */
  function place(b: Built, on: boolean): void {
    b.body?.setEnabled(on);
    colliderOf(b)?.setEnabled(on);
    if (b.handle !== null) ctx.geometry?.setEnabled(b.handle, on);
  }

  const system: ColliderSystem = {
    attach(_id, block, e) {
      build(e, block);
    },
    update(_id, block, _prev, e) {
      build(e, block);
    },
    detach(id) {
      remove(id);
      rides.delete(id);
    },
    has: (id) => built.has(id),
    rebuild(id) {
      const b = built.get(id);
      const block = b ? blockOf(b.entity) : undefined;
      if (b && block) build(b.entity, block);
    },
    handle: (id) => ({ rebuild: () => system.rebuild(id) }),
    /** Moves the body it built there, whatever its kind; a moving one keeps its velocity. */
    posed(id, pose) {
      const b = built.get(id);
      if (!b) return;
      b.pose = { x: pose.x, y: pose.y, rot: pose.rot };
      b.rested = undefined;
      if (b.handle !== null) ctx.geometry?.setPose(b.handle, pose.x, pose.y, pose.rot);
      if (b.body && b.collider) {
        const at = composePose(pose.x, pose.y, pose.rot, b.frame);
        moveBodyNow(ctx, id, { body: b.body, collider: b.collider }, at);
      }
      if (!b.attachment || !b.rideOffset) return;
      b.rideOffset = b.attachment.follow(pose, b.rideOffset, b.frame) ?? b.rideOffset;
    },
    /** A dynamic body moves it in the world: a parent's movement doesn't carry it. */
    selfMoving: (id) => built.get(id)?.kind === "dynamic",
    /** A fixed collider moves onto `host`'s body where the entity is now, or back onto a body of its own. */
    ride(id, host) {
      rides.set(id, host);
      const b = built.get(id);
      if (!b || !ctx.physics || b.kind !== "fixed" || b.stood) return;
      if (hostFor(id) === b.riding) return;
      const block = blockOf(b.entity);
      if (block) build(b.entity, block, true);
    },
    /** A geometry sensor that just arrived takes what overlaps it now, as the `sensor` type does at the next step's start. */
    ready(ids) {
      for (const id of ids) {
        const b = built.get(id);
        if (b?.sensor && b.handle !== null && !off(b) && b.next === null && !b.restored)
          b.next = geometryOverlaps(b).now;
      }
    },
    beforePhysics: moveKinematic,
    step() {
      if (built.size === 0) return;
      poseBodies();
      raiseSensors();
    },
    /** The body stops where it is, keeping its velocity; a sensor forgets what is inside without raising exits. */
    disable(id) {
      const b = built.get(id);
      if (!b || b.disabled) return;
      b.disabled = true;
      b.inside = new Map();
      b.next = null;
      b.restored = null;
      place(b, false);
    },
    enable(id) {
      const b = built.get(id);
      if (!b || !b.disabled) return;
      b.disabled = false;
      if (!b.stood) place(b, true);
    },
    standIn(id) {
      const b = built.get(id);
      if (!b || b.stood) return;
      b.stood = true;
      place(b, false);
      b.unregister();
      b.unregister = () => {};
      ctx.physics?.refreshQueries();
    },
    release(id) {
      const b = built.get(id);
      const block = b ? blockOf(b.entity) : undefined;
      if (!b?.stood || !block) return;
      b.stood = false;
      build(b.entity, block, true);
    },
    reset() {
      for (const b of built.values()) {
        b.inside = new Map();
        b.next = null;
        b.restored = null;
      }
    },
    clear() {
      for (const id of [...built.keys()]) remove(id);
      rides.clear();
    },
    size: () => built.size,
    /** What overlaps a sensor collider since the last step, so a restore raises no enter for it again. */
    save(id): JsonValue | undefined {
      const b = built.get(id);
      if (!b?.sensor) return undefined;
      settle(b);
      const inside = saveOverlaps(ctx.tags, b.inside);
      const next = b.next ? saveOverlaps(ctx.tags, b.next) : null;
      if (inside.length === 0 && (next === null || next.length === 0)) return undefined;
      return next === null ? { inside } : { inside, next };
    },
    restore(id, state) {
      system.rebuild(id);
      const b = built.get(id);
      if (!b || typeof state !== "object" || state === null || Array.isArray(state)) return;
      b.inside = new Map();
      b.next = null;
      b.restored = { inside: state.inside, next: state.next };
    },
  };
  return system as BehaviorSystem;
};
