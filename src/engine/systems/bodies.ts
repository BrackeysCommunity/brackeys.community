import type { Collider, ColliderDesc, RigidBody } from "@dimforge/rapier2d";

import { createSensorCollider } from "../collisions";
import type { ViewLayer } from "../context";
import { styleOf } from "../game/style";
import type { ColliderTag, EngineContext, RegisteredType, SceneSystem } from "../game/types";
import { posedBodyDesc, shapeColliderDesc, shapePose } from "../physics";
import { SENSOR_ENTER, SENSOR_EXIT, type StepEvent } from "../runtime/types";
import { aabb, translateShape } from "../scene/shape-geometry";
import type { RuntimeEntity, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";
import type { Attachment } from "./attachments";

export type SolidEntity = RuntimeEntity<{
  shape: ShapeObj;
  material?: string;
  oneWay?: boolean;
  attach?: string;
}>;
export type PropEntity = RuntimeEntity<{
  shape: ShapeObj;
  density: number;
  restitution: number;
  friction?: number;
  material?: string;
}>;
export type SensorEntity = RuntimeEntity<{ shape: ShapeObj; tags?: string[]; attach?: string }>;

// ─── Shared parts ────────────────────────────────────────

export { styleOf };

/** Friction and restitution a type gives entities that name no material. */
export type SurfaceDefaults = { friction?: number; restitution?: number };

/** The entity's material when it names one (a material always wins), else the type's defaults. */
export function surfaceOf(
  ctx: Pick<EngineContext, "registry">,
  material: string | undefined,
  defaults: SurfaceDefaults,
): SurfaceDefaults {
  if (material === undefined) return defaults;
  const def = ctx.registry.materials.get(material);
  if (!def) throw new Error(`unknown material "${material}"`);
  return def;
}

export function applySurface(desc: ColliderDesc, surface: SurfaceDefaults): ColliderDesc {
  if (surface.friction !== undefined) desc.setFriction(surface.friction);
  if (surface.restitution !== undefined) desc.setRestitution(surface.restitution);
  return desc;
}

export function surfaceTag(
  entityId: string,
  type: RegisteredType,
  material: string | undefined,
): ColliderTag {
  const tag: ColliderTag = { entityId, type: type.type };
  if (material !== undefined) tag.material = material;
  return tag;
}

/** Draws an entity in its type's look; nothing without a view or a look. */
export function drawEntity(
  ctx: Pick<EngineContext, "registry" | "view">,
  type: RegisteredType,
  e: { id: string; shape: ShapeObj; material?: string },
  layer: ViewLayer,
  shape: ShapeObj = e.shape,
): void {
  if (!ctx.view) return;
  const style = styleOf(ctx, type, e.material);
  if (style) ctx.view.draw(e.id, shape, style, layer);
}

/** `shape` in the frame of a body `posedBodyDesc` made from it: centred and unrotated. */
export function bodyLocalShape(shape: ShapeObj): ShapeObj {
  switch (shape.type) {
    case "box":
    case "capsule":
      return { ...shape, cx: 0, cy: 0, rotDeg: 0 };
    case "circle":
      return { ...shape, cx: 0, cy: 0 };
    case "poly":
    case "chain":
      return shape;
  }
}

export type OwnedBody = { body: RigidBody; collider: Collider };

const sameShape = (a: ShapeObj, b: ShapeObj) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Bookkeeping for a system whose entities each own one body with one tagged
 * collider; despawning one also removes its visual.
 */
export function createBodyTable<T extends OwnedBody>(ctx: EngineContext) {
  const owned = new Map<string, T>();

  function despawn(id: string): void {
    const entry = owned.get(id);
    if (!entry) return;
    ctx.tags.delete(entry.collider.handle);
    ctx.physics.removeRigidBody(entry.body);
    ctx.view?.remove(id);
    owned.delete(id);
  }

  function poseBody(id: string, body: RigidBody): void {
    if (!ctx.view) return;
    const t = body.translation();
    ctx.view.pose(id, t.x, t.y, body.rotation());
  }

  return {
    owned,
    add: (id: string, entry: T, tag: ColliderTag): void => {
      ctx.tags.set(entry.collider.handle, tag);
      owned.set(id, entry);
    },
    /**
     * Re-poses a fixed body for `shape` and swaps its collider for the one
     * `attach` adds, tagged `tag`: a respawn that keeps the body and the
     * entity's place in spawn order.
     */
    reshape: (
      entry: T,
      shape: ShapeObj,
      attach: (body: RigidBody) => Collider,
      tag: ColliderTag,
    ) => {
      const pose = shapePose(shape);
      entry.body.setTranslation(new ctx.rapier.Vector2(pose.x, pose.y), true);
      entry.body.setRotation(pose.rotation, true);
      ctx.tags.delete(entry.collider.handle);
      ctx.physics.removeCollider(entry.collider);
      entry.collider = attach(entry.body);
      ctx.tags.set(entry.collider.handle, tag);
    },
    despawn,
    clear: (): void => {
      for (const id of [...owned.keys()]) despawn(id);
    },
    size: () => owned.size,
    position: (id: string): Vec2 | null => {
      const entry = owned.get(id);
      if (!entry) return null;
      const t = entry.body.translation();
      return { x: t.x, y: t.y };
    },
    /** Moves the entity's visual to its body's pose. */
    pose: (id: string): void => {
      const entry = owned.get(id);
      if (entry) poseBody(id, entry.body);
    },
    /** Moves every visual to its body's pose. */
    poseAll: (): void => {
      if (ctx.view) for (const [id, { body }] of owned) poseBody(id, body);
    },
  };
}

// ─── Riders: colliders on another entity's body ──────────

/** An entity whose collider rides its `attach` target's body, its shape held in the host's frame. */
export type Rider<E extends { id: string; shape: ShapeObj }> = {
  entity: E;
  attachment: Attachment;
  /** The shape in the host's frame, once a host has been seen. */
  local: ShapeObj | null;
};

/**
 * Entities attached to a host (`attach: "<follower id>"`): each collider
 * goes on the host's body at the entity's offset from the host's origin,
 * so the host's motion carries it with no per-tick sync. Visuals are
 * drawn in the host's frame and posed to its body.
 */
export function createRiders<E extends { id: string; shape: ShapeObj; attach?: string }>(
  ctx: EngineContext,
  type: RegisteredType,
  opts: {
    layer: ViewLayer;
    draw: boolean;
    material?: (e: E) => string | undefined;
    /** Makes the collider on the host's body from a descriptor of the host-local shape. */
    collider: (body: RigidBody, desc: ColliderDesc, e: E) => Collider;
    tag: (e: E) => ColliderTag;
  },
) {
  const riders = new Map<string, Rider<E>>();

  function draw(e: E, shape: ShapeObj): void {
    if (!opts.draw) return;
    ctx.view?.remove(e.id);
    drawEntity(ctx, type, { id: e.id, shape, material: opts.material?.(e) }, opts.layer, shape);
  }

  function pose(r: Rider<E>): void {
    const host = r.attachment.host();
    if (!ctx.view || !host || !r.local) return;
    const t = host.body.translation();
    ctx.view.pose(r.entity.id, t.x, t.y, host.body.rotation());
  }

  function add(e: E, hostId: string): void {
    const rider: Rider<E> = { entity: e, attachment: null as never, local: null };
    rider.attachment = ctx.attachments.attach(e.id, hostId, (host) => {
      const local = translateShape(e.shape, [-host.origin.x, -host.origin.y]);
      rider.local = local;
      const collider = opts.collider(host.body, shapeColliderDesc(ctx.rapier, local, true), e);
      ctx.tags.set(collider.handle, {
        ...opts.tag(e),
        carrier: { entityId: host.id, type: host.type },
      });
      draw(e, local);
      pose(rider);
      return collider;
    });
    riders.set(e.id, rider);
    if (!rider.attachment.collider()) draw(e, e.shape);
  }

  function remove(id: string): boolean {
    const r = riders.get(id);
    if (!r) return false;
    r.attachment.detach();
    ctx.view?.remove(id);
    riders.delete(id);
    return true;
  }

  return {
    riders,
    add,
    remove,
    clear: () => {
      for (const id of [...riders.keys()]) remove(id);
    },
    poseAll: () => {
      for (const r of riders.values()) pose(r);
    },
    /** Where a rider's collider is now, in world px; null while it waits for its host. */
    position: (id: string): Vec2 | null => {
      const c = riders.get(id)?.attachment.collider();
      if (!c) return null;
      const t = c.translation();
      return { x: t.x, y: t.y };
    },
  };
}

/** Where a system draws its entities, and whether it draws them at all. */
export type VisualOptions = {
  /** The draw layer; each system has its own default. */
  layer?: ViewLayer;
  /** False when the game draws the entities itself. */
  draw?: boolean;
};

// ─── Solid ───────────────────────────────────────────────

/** Visuals default to the `terrain` layer. */
export type SolidOptions = SurfaceDefaults &
  VisualOptions & {
    /** Every entity of the type is one-way, whatever its own `oneWay` says. */
    oneWay?: boolean;
    /** Collision group; `static` when omitted. */
    group?: string;
  };

export type SolidSystem = SceneSystem<SolidEntity> & {
  /**
   * Gates this system's one-way entities for one actor: each stays solid
   * while the actor's bottom is at or above its top (within 4 px) and the
   * actor isn't dropping through, and otherwise moves its body out of the
   * world so queries and contacts skip it. An attached one is gated by its
   * collider's collision groups instead.
   */
  gateOneWay(actorBottomY: number, dropping: boolean): void;
  isHidden(id: string): boolean;
  /** Where the entity's body is now; a hidden one-way body is off-world. */
  position(id: string): Vec2 | null;
};

const ONE_WAY_TOLERANCE = 4;
const HIDDEN_Y = -99999;

type SolidBody = OwnedBody & {
  pose: Vec2;
  top: number;
  oneWay: boolean;
  hidden: boolean;
};

export function createSolidSystem(
  ctx: EngineContext,
  type: RegisteredType,
  opts: SolidOptions = {},
): SolidSystem {
  const table = createBodyTable<SolidBody>(ctx);
  const { rapier, physics } = ctx;
  const groups = ctx.registry.collisionGroups(opts.group ?? "static");
  const isOneWay = (e: SolidEntity) => opts.oneWay === true || e.oneWay === true;
  /** Attached one-way solids gated off: their collider's groups are 0 until the actor is above them again. */
  const gated = new Set<string>();
  const riders = createRiders<SolidEntity>(ctx, type, {
    layer: opts.layer ?? "terrain",
    draw: opts.draw !== false,
    material: (e) => e.material,
    collider: (body, desc, e) =>
      physics.addCollider(
        applySurface(
          desc.setCollisionGroups(gated.has(e.id) ? 0 : groups),
          surfaceOf(ctx, e.material, opts),
        ),
        body,
      ),
    tag: (e) => tagOf(e),
  });

  function setHidden(solid: SolidBody, hidden: boolean): void {
    if (solid.hidden === hidden) return;
    const y = hidden ? HIDDEN_Y : solid.pose.y;
    solid.body.setTranslation(new rapier.Vector2(solid.pose.x, y), true);
    solid.hidden = hidden;
  }

  function colliderDesc(e: SolidEntity): ColliderDesc {
    const surface = surfaceOf(ctx, e.material, opts);
    return applySurface(shapeColliderDesc(rapier, e.shape).setCollisionGroups(groups), surface);
  }

  function tagOf(e: SolidEntity): ColliderTag {
    const tag = surfaceTag(e.id, type, e.material);
    if (opts.oneWay === true || e.oneWay === true) tag.oneWay = true;
    return tag;
  }

  function placement(e: SolidEntity): Omit<SolidBody, keyof OwnedBody> {
    const pose = shapePose(e.shape);
    return {
      pose: { x: pose.x, y: pose.y },
      top: aabb(e.shape).minY,
      oneWay: opts.oneWay === true || e.oneWay === true,
      hidden: false,
    };
  }

  function draw(e: SolidEntity): void {
    if (opts.draw !== false) drawEntity(ctx, type, e, opts.layer ?? "terrain");
  }

  function despawn(id: string): void {
    gated.delete(id);
    if (!riders.remove(id)) table.despawn(id);
  }

  function spawn(e: SolidEntity): void {
    despawn(e.id);
    if (e.attach !== undefined) return riders.add(e, e.attach);
    const desc = colliderDesc(e);
    const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
    const collider = physics.addCollider(desc, body);
    table.add(e.id, { body, collider, ...placement(e) }, tagOf(e));
    draw(e);
  }

  return {
    spawn,
    update(e) {
      const solid = table.owned.get(e.id);
      if (!solid || e.attach !== undefined) return spawn(e);
      const desc = colliderDesc(e);
      table.reshape(solid, e.shape, (body) => physics.addCollider(desc, body), tagOf(e));
      Object.assign(solid, placement(e));
      if (opts.draw !== false) ctx.view?.remove(e.id);
      draw(e);
    },
    despawn,
    clear() {
      riders.clear();
      gated.clear();
      table.clear();
    },
    reset() {
      for (const solid of table.owned.values()) setHidden(solid, false);
      for (const id of [...gated]) gate(id, false);
    },
    size: () => table.size() + riders.riders.size,
    gateOneWay(actorBottomY, dropping) {
      for (const solid of table.owned.values()) {
        if (!solid.oneWay) continue;
        const above = actorBottomY <= solid.top + ONE_WAY_TOLERANCE;
        setHidden(solid, !(above && !dropping));
      }
      for (const r of riders.riders.values()) {
        const host = r.attachment.host();
        if (!isOneWay(r.entity) || !host || !r.local) continue;
        const top = host.body.translation().y + aabb(r.local).minY;
        gate(r.entity.id, !(actorBottomY <= top + ONE_WAY_TOLERANCE && !dropping));
      }
    },
    isHidden: (id) => table.owned.get(id)?.hidden ?? gated.has(id),
    position: (id) => table.position(id) ?? riders.position(id),
    afterStep: riders.poseAll,
  };

  /**
   * An attached one-way solid can't leave the world without moving its
   * host, so it is gated by collision groups: 0 lets everything through,
   * and queries skip it when they pass `filterGroups`.
   */
  function gate(id: string, hidden: boolean): void {
    if (gated.has(id) === hidden) return;
    if (hidden) gated.add(id);
    else gated.delete(id);
    riders.riders
      .get(id)
      ?.attachment.collider()
      ?.setCollisionGroups(hidden ? 0 : groups);
  }
}

// ─── Prop ────────────────────────────────────────────────

export function createPropSystem(
  ctx: EngineContext,
  type: RegisteredType,
): SceneSystem<PropEntity> {
  const table = createBodyTable(ctx);
  const { rapier, physics } = ctx;
  const groups = ctx.registry.collisionGroups("dynamic");

  return {
    spawn(e) {
      table.despawn(e.id);
      const surface = surfaceOf(ctx, e.material, {});
      const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.dynamic(), e.shape));
      const desc = shapeColliderDesc(rapier, e.shape)
        .setCollisionGroups(groups)
        .setRestitution(e.restitution)
        .setDensity(e.density);
      const friction = e.friction ?? surface.friction;
      if (friction !== undefined) desc.setFriction(friction);
      const collider = physics.addCollider(desc, body);
      table.add(e.id, { body, collider }, surfaceTag(e.id, type, e.material));
      drawEntity(ctx, type, e, "body", bodyLocalShape(e.shape));
      table.pose(e.id);
    },
    despawn: table.despawn,
    clear: table.clear,
    size: table.size,
    afterStep: table.poseAll,
  };
}

// ─── Sensor ──────────────────────────────────────────────

/** Raises `sensor:enter` / `sensor:exit` after each step for every collider that starts or stops overlapping. */
export type SensorSystem = SceneSystem<SensorEntity> & { afterStep(dtMs: number): void };

/** Overlapping collider handle → the entity id its tag names. */
type Overlaps = Map<number, string | undefined>;
type SensorBody = OwnedBody & { inside: Overlaps };

export function createSensorSystem(ctx: EngineContext, type: RegisteredType): SensorSystem {
  const table = createBodyTable<SensorBody>(ctx);
  const { rapier, physics } = ctx;
  const inside = new Map<string, Overlaps>();
  const riders = createRiders<SensorEntity>(ctx, type, {
    layer: "terrain",
    draw: true,
    collider: (body, desc) => createSensorCollider(ctx, body, desc),
    tag: (e) => tagOf(e),
  });

  function positionOf(handle: number, fallback: Collider): Vec2 {
    const t = (physics.world.getCollider(handle)?.parent() ?? fallback.parent())?.translation();
    return t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
  }

  function raise(kind: string, id: string, sensor: Collider, handle: number, other?: string) {
    const event: Omit<StepEvent, "tick"> = {
      type: kind,
      entityId: id,
      at: positionOf(handle, sensor),
    };
    if (other !== undefined) event.other = other;
    ctx.emit(event);
  }

  function tagOf(e: SensorEntity): ColliderTag {
    const tag: ColliderTag = { entityId: e.id, type: type.type };
    if (e.tags) tag.tags = e.tags;
    return tag;
  }

  function despawn(id: string): void {
    inside.delete(id);
    if (!riders.remove(id)) table.despawn(id);
  }

  function spawn(e: SensorEntity): void {
    despawn(e.id);
    if (e.attach !== undefined) return riders.add(e, e.attach);
    const desc = shapeColliderDesc(rapier, e.shape);
    const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
    const collider = createSensorCollider(ctx, body, desc);
    table.add(e.id, { body, collider, inside: new Map() }, tagOf(e));
    drawEntity(ctx, type, e, "terrain");
  }

  return {
    spawn,
    update(e, prev) {
      const sensor = table.owned.get(e.id);
      if (!sensor || e.attach !== undefined || prev.attach !== undefined) return spawn(e);
      sensor.inside = new Map();
      if (sameShape(e.shape, prev.shape)) {
        ctx.tags.set(sensor.collider.handle, tagOf(e));
        return;
      }
      const desc = shapeColliderDesc(rapier, e.shape);
      table.reshape(sensor, e.shape, (body) => createSensorCollider(ctx, body, desc), tagOf(e));
      ctx.view?.remove(e.id);
      drawEntity(ctx, type, e, "terrain");
    },
    despawn,
    clear() {
      riders.clear();
      inside.clear();
      table.clear();
    },
    reset() {
      for (const sensor of table.owned.values()) sensor.inside.clear();
      inside.clear();
    },
    size: () => table.size() + riders.riders.size,
    afterStep() {
      riders.poseAll();
      if (table.owned.size === 0 && riders.riders.size === 0) return;
      // Pairwise checks rather than `intersectionPairsWith`, whose wasm callback fails under Node test runners.
      const colliders = physics.world.colliders.getAll();
      const check = (id: string, collider: Collider, before: Overlaps): Overlaps => {
        const now: Overlaps = new Map();
        for (const other of colliders) {
          if (other === collider) continue;
          if (physics.world.intersectionPair(collider, other)) {
            now.set(other.handle, ctx.tags.get(other.handle)?.entityId);
          }
        }
        for (const [handle, other] of now) {
          if (!before.has(handle)) raise(SENSOR_ENTER, id, collider, handle, other);
        }
        for (const [handle, other] of before) {
          if (!now.has(handle)) raise(SENSOR_EXIT, id, collider, handle, other);
        }
        return now;
      };
      for (const [id, sensor] of table.owned)
        sensor.inside = check(id, sensor.collider, sensor.inside);
      for (const [id, r] of riders.riders) {
        const collider = r.attachment.collider();
        if (collider) inside.set(id, check(id, collider, inside.get(id) ?? new Map()));
      }
    },
  };
}
