import type {
  Collider,
  ColliderDesc,
  InteractionGroups,
  KinematicCharacterController,
  QueryFilterFlags,
  RigidBody,
  RigidBodyDesc,
  Vector,
} from "@dimforge/rapier2d";

import { createSensorCollider } from "../collisions";
import { DRAW_LAYERS, type ViewLayer } from "../context";
import { SPRITE } from "../game/behaviors/sprite";
import { physicsOf } from "../game/physics-of";
import { oneWaySideOf } from "../game/primitives";
import { styleOf } from "../game/style";
import type {
  ColliderTag,
  ColliderTags,
  EngineContext,
  JsonValue,
  RegisteredType,
  SceneSystem,
  Side,
} from "../game/types";
import { posedBodyDesc, shapeColliderDesc, shapePose } from "../physics";
import { rapierBodyEntry, registerBody, type BodyEntry } from "../runtime/bodies-control";
import type { GeometryColliderDesc } from "../runtime/geometry-world";
import { composePose, framePose, relativePose, samePose, type Pose } from "../runtime/poses";
import type { SpaceHit } from "../runtime/space";
import { shapeSpawnPose } from "../runtime/spawn-pose";
import { SENSOR_ENTER, SENSOR_EXIT, type StepEvent } from "../runtime/types";
import { parseBulkId } from "../scene/bulk-ref";
import { defaultLayer } from "../scene/layers";
import { aabb, shapeAtPose } from "../scene/shape-geometry";
import type { Aabb, RuntimeEntity, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";
import type { Attachment, AttachmentHost } from "./attachments";
import { colliderCandidates } from "./sensor-candidates";

export type SolidEntity = RuntimeEntity<{
  shape: ShapeObj;
  material?: string;
  oneWay?: boolean | Side;
}>;
export type PropEntity = RuntimeEntity<{
  shape: ShapeObj;
  density: number;
  restitution: number;
  friction?: number;
  material?: string;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  fixedRotation?: boolean;
  ccd?: boolean;
}>;
export type SensorEntity = RuntimeEntity<{ shape: ShapeObj; tags?: string[] }>;

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

/**
 * The draw order of the scene layer `e` names, else `fallback`: an engine
 * system's own visuals sit on the entity's layer only when it names one.
 */
export function entityDrawLayer(
  ctx: Pick<EngineContext, "registry">,
  e: { layer?: string },
  fallback: ViewLayer,
): ViewLayer {
  if (e.layer === undefined) return fallback;
  return ctx.registry.layers.find((l) => l.name === e.layer)?.draw ?? fallback;
}

/**
 * The draw order an entity's own visuals (a sprite, an emitter) sit on: the
 * scene layer it names, else its type's default layer, else the body layer.
 */
export function entityHomeLayer(
  ctx: Pick<EngineContext, "registry">,
  id: string,
  entity: { type: string; layer?: string },
): ViewLayer {
  const { layers, types } = ctx.registry;
  const home = defaultLayer(types.get(entity.type), parseBulkId(id) !== null, layers);
  return entityDrawLayer(
    ctx,
    entity,
    layers.find((l) => l.name === home)?.draw ?? DRAW_LAYERS.body,
  );
}

/**
 * Draws an entity in its type's look; nothing without a view or a look, or
 * for an entity with a sprite, which draws instead. An entity with a `z` or
 * a `layer` gets its depth, which orders it inside its layer and makes it
 * one of the layer's entity visuals (hidden in play on an editor-only one).
 */
export function drawEntity(
  ctx: Pick<EngineContext, "registry" | "view">,
  type: RegisteredType,
  e: {
    id: string;
    shape: ShapeObj;
    material?: string;
    behaviors?: RuntimeEntity["behaviors"];
    z?: number;
    layer?: string;
  },
  layer: ViewLayer,
  shape: ShapeObj = e.shape,
): void {
  if (!ctx.view || e.behaviors?.[SPRITE.name]) return;
  const style = styleOf(ctx, type, e.material);
  if (!style) return;
  ctx.view.draw(e.id, shape, style, layer);
  if (e.z || e.layer !== undefined) ctx.view.depth?.(e.id, e.z ?? 0);
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

/**
 * Moves a body and its collider to `to` at once, keeping its velocity and
 * waking it: Rapier carries a body's move to its colliders only at the next
 * step, and queries before then must find the collider where the body is.
 */
export function moveBodyNow(ctx: EngineContext, id: string, entry: OwnedBody, to: Pose): void {
  const { rapier, physics } = physicsOf(ctx, "a body", id);
  entry.body.setTranslation(new rapier.Vector2(to.x, to.y), true);
  entry.body.setRotation(to.rot, true);
  const t = entry.collider.translationWrtParent();
  const at = t
    ? composePose(to.x, to.y, to.rot, {
        x: t.x,
        y: t.y,
        rot: entry.collider.rotationWrtParent() ?? 0,
      })
    : to;
  entry.collider.setTranslation(new rapier.Vector2(at.x, at.y));
  entry.collider.setRotation(at.rot);
  physics.moved(entry.body);
}

const sameShape = (a: ShapeObj, b: ShapeObj) => JSON.stringify(a) === JSON.stringify(b);

/** What a body table reads of an entity: its id, its shape and its quarter turns. */
type ShapedEntity = Pick<RuntimeEntity, "id" | "transform"> & { shape: ShapeObj };

/** Where a body `posedBodyDesc` made for `shape` sits, as a pose. */
const framedAt = (shape: ShapeObj): Pose => {
  const frame = shapePose(shape);
  return { x: frame.x, y: frame.y, rot: frame.rotation };
};

/**
 * The entity's pose in its body's frame. A body `posedBodyDesc` made sits
 * at `shapePose(shape)`; a `local` one (a follower's) carries the shape at
 * its own offset.
 */
function bodyOffset(e: ShapedEntity, local: boolean): Pose {
  const pose = shapeSpawnPose(e.shape, e.transform);
  return local ? pose : relativePose(pose, framedAt(e.shape));
}

/** What a geometry collider is, apart from its shape and pose. */
export type GeometryPart = Omit<GeometryColliderDesc, "shape" | "pose">;

/**
 * Adds `shape` to the geometry world, tagged `tag`, and returns its handle;
 * null when the runtime has no geometry world. Without `at` the collider
 * is posed as a Rapier body made by `posedBodyDesc` would be; with it,
 * `shape` is local to `at` (a follower's path point).
 */
export function addGeometryCollider(
  ctx: Pick<EngineContext, "geometry" | "tags">,
  shape: ShapeObj,
  part: GeometryPart,
  tag: ColliderTag,
  at?: Pose,
): number | null {
  const world = ctx.geometry;
  if (!world) return null;
  let pose = at;
  let local = shape;
  if (!pose) {
    pose = framedAt(shape);
    local = bodyLocalShape(shape);
  }
  const handle = world.add({ ...part, shape: local, pose });
  ctx.tags.set(handle, tag);
  return handle;
}

/** Removes a collider `addGeometryCollider` added, and its tag. */
export function removeGeometryCollider(
  ctx: Pick<EngineContext, "geometry" | "tags">,
  handle: number | null,
): void {
  if (handle === null) return;
  ctx.tags.delete(handle);
  ctx.geometry?.remove(handle);
}

/**
 * Bookkeeping for a system whose entities each own one body with one tagged
 * collider; despawning one also removes its visual. With `view` false the
 * entities have no visuals to pose. While the scene has no physics an
 * entity is `placed` instead: drawn and posed where its shape is, with a
 * collider in the geometry world when the runtime has one.
 *
 * Each body it adds answers `ctx.bodies` under its entity id, as `body`
 * says: a dynamic or static Rapier body, or the entry the owner makes for
 * it. Placed entities have no body and don't.
 */
export function createBodyTable<T extends OwnedBody>(
  ctx: EngineContext,
  opts: { view?: boolean; body: "dynamic" | "static" | ((id: string, owned: T) => BodyEntry) },
) {
  const owned = new Map<string, T>();
  const unregisters = new Map<string, () => void>();
  const offsets = new Map<string, Pose>();
  const placed = new Map<string, { at: Vec2; handle: number | null }>();
  const disabled = new Set<string>();
  /**
   * For each entity `setPose` moved, its body's frame where its shape was
   * drawn and where it is now: a world-space drawing is shifted by the
   * difference.
   */
  const moved = new Map<string, { drawn: Pose; now: Pose }>();
  const posesView = opts.view !== false;
  /**
   * The pose `poseAll` wrote for each body asleep when it wrote it. A body
   * asleep then and now hasn't moved since, so while nothing else wrote its
   * pose it is skipped: asking Rapier whether a body sleeps costs a tenth of
   * reading where it is.
   */
  const resting = new Map<string, Readonly<Pose> | undefined>();

  function despawn(id: string): void {
    disabled.delete(id);
    resting.delete(id);
    moved.delete(id);
    const p = placed.get(id);
    if (p) {
      removeGeometryCollider(ctx, p.handle);
      placed.delete(id);
      offsets.delete(id);
      ctx.view?.remove(id);
      return;
    }
    const entry = owned.get(id);
    if (!entry) return;
    unregisters.get(id)?.();
    unregisters.delete(id);
    ctx.tags.delete(entry.collider.handle);
    physicsOf(ctx, "a body", id).physics.removeRigidBody(entry.body);
    ctx.view?.remove(id);
    owned.delete(id);
    offsets.delete(id);
  }

  const drawsPoses = () => posesView && ctx.view !== null;

  function poseView(id: string, body: RigidBody): void {
    if (!drawsPoses()) return;
    const t = body.translation();
    ctx.view!.pose(id, t.x, t.y, body.rotation());
  }

  /** Writes the entity's pose from its body to the pose index, and to the view when there is one. */
  function poseBody(id: string, body: RigidBody, snap: boolean): void {
    const offset = offsets.get(id);
    const view = drawsPoses();
    if (!offset && !view) return;
    const t = body.translation();
    const rot = body.rotation();
    if (offset) {
      const p = composePose(t.x, t.y, rot, offset);
      ctx.poses.set(id, p.x, p.y, p.rot, snap ? { snap } : undefined);
    }
    if (view) ctx.view!.pose(id, t.x, t.y, rot);
  }

  return {
    owned,
    /** `local` for a body that carries the shape at its own offset rather than one posed at it. */
    add: (e: ShapedEntity, entry: T, tag: ColliderTag, local = false): void => {
      ctx.tags.set(entry.collider.handle, tag);
      owned.set(e.id, entry);
      offsets.set(e.id, bodyOffset(e, local));
      const { body } = opts;
      const control =
        typeof body === "function" ? body(e.id, entry) : rapierBodyEntry(e.id, entry.body, body);
      unregisters.set(e.id, registerBody(ctx, e.id, control));
    },
    /**
     * Re-poses a fixed body for `e`'s shape and swaps its collider for the
     * one `attach` adds, tagged `tag`: a respawn that keeps the body and the
     * entity's place in spawn order.
     */
    reshape: (
      e: ShapedEntity,
      entry: T,
      attach: (body: RigidBody) => Collider,
      tag: ColliderTag,
    ) => {
      const { rapier, physics } = physicsOf(ctx, "a body", e.id);
      const pose = shapePose(e.shape);
      entry.body.setTranslation(new rapier.Vector2(pose.x, pose.y), true);
      entry.body.setRotation(pose.rotation, true);
      ctx.tags.delete(entry.collider.handle);
      physics.removeCollider(entry.collider);
      entry.collider = attach(entry.body);
      if (disabled.has(e.id)) entry.collider.setEnabled(false);
      ctx.tags.set(entry.collider.handle, tag);
      offsets.set(e.id, bodyOffset(e, false));
      moved.delete(e.id);
    },
    /**
     * Holds `e` with no body, at its shape's pose, with a geometry collider
     * made of `part` and tagged `tag` when there is a geometry world; its
     * system draws it. Returns the collider's handle, else null.
     */
    place: (e: ShapedEntity, part: GeometryPart, tag: ColliderTag): number | null => {
      const pose = shapePose(e.shape);
      const handle = addGeometryCollider(ctx, e.shape, part, tag);
      placed.set(e.id, { at: { x: pose.x, y: pose.y }, handle });
      offsets.set(e.id, bodyOffset(e, false));
      return handle;
    },
    /**
     * Moves the entity to `pose` (its own, as the pose index holds it): its
     * body or geometry collider goes with it, and the pose index is
     * written without a snap so the view eases there. Returns the body's
     * frame there, else null for an entity the table doesn't hold.
     */
    setPose: (id: string, pose: Readonly<Pose>, shape: ShapeObj): Pose | null => {
      const offset = offsets.get(id);
      if (!offset) return null;
      const frame = framePose(pose, offset);
      const p = placed.get(id);
      const entry = owned.get(id);
      if (p) {
        p.at = { x: frame.x, y: frame.y };
        if (p.handle !== null) ctx.geometry?.setPose(p.handle, frame.x, frame.y, frame.rot);
      } else if (entry) {
        moveBodyNow(ctx, id, entry, frame);
        resting.delete(id);
      } else return null;
      moved.set(id, { drawn: moved.get(id)?.drawn ?? framedAt(shape), now: frame });
      ctx.poses.set(id, pose.x, pose.y, pose.rot);
      return frame;
    },
    /**
     * Shifts the world-space drawing of an entity `setPose` moved to where
     * its body is now; nothing for one that never moved.
     */
    poseDrawn: (id: string): void => {
      const m = moved.get(id);
      if (!m || !ctx.view || disabled.has(id)) return;
      // The current frame seen from the drawn one: the shift that carries one to the other.
      const at = framePose(m.now, m.drawn);
      ctx.view.pose(id, at.x, at.y, at.rot);
    },
    /** Whether `setPose` moved the entity since it spawned. */
    wasMoved: (id: string): boolean => moved.has(id),
    /** The geometry collider of a placed entity, else null. */
    placedHandle: (id: string): number | null => placed.get(id)?.handle ?? null,
    despawn,
    /**
     * Takes the entity's body and collider out of the world (or its geometry
     * collider out of queries) and removes its visual, keeping both for
     * `enable`. False for an unknown or already disabled id.
     */
    disable: (id: string): boolean => {
      if (disabled.has(id)) return false;
      const p = placed.get(id);
      const entry = owned.get(id);
      if (p) {
        if (p.handle !== null) ctx.geometry?.setEnabled(p.handle, false);
      } else if (entry) {
        entry.body.setEnabled(false);
        entry.collider.setEnabled(false);
      } else return false;
      disabled.add(id);
      ctx.view?.remove(id);
      return true;
    },
    /**
     * Puts a disabled entity's body and collider back where they were; its
     * system redraws it. `collider` false leaves a geometry collider out of
     * queries (a one-way solid its gate hides). False unless `id` was disabled.
     */
    enable: (id: string, collider = true): boolean => {
      if (!disabled.delete(id)) return false;
      const p = placed.get(id);
      if (p) {
        if (p.handle !== null) ctx.geometry?.setEnabled(p.handle, collider);
        return true;
      }
      const entry = owned.get(id);
      if (entry) {
        entry.body.setEnabled(true);
        entry.collider.setEnabled(true);
      }
      return true;
    },
    disabled: (id: string): boolean => disabled.has(id),
    clear: (): void => {
      for (const id of [...placed.keys()]) despawn(id);
      for (const id of [...owned.keys()]) despawn(id);
    },
    size: () => owned.size + placed.size,
    position: (id: string): Vec2 | null => {
      const p = placed.get(id);
      if (p) return { ...p.at };
      const entry = owned.get(id);
      if (!entry) return null;
      const t = entry.body.translation();
      return { x: t.x, y: t.y };
    },
    /** Moves the entity's visual to its body's pose; its spawn pose is the runtime's to set. */
    pose: (id: string): void => {
      const entry = owned.get(id);
      if (entry) poseView(id, entry.body);
    },
    /** `pose` for a body whose translation and rotation the caller has just read. */
    poseAt: (id: string, at: Readonly<Pose>): void => {
      if (drawsPoses() && owned.has(id)) ctx.view!.pose(id, at.x, at.y, at.rot);
    },
    /**
     * Poses every entity to its body, in the pose index and the view; `snap`
     * after a jump. A body that slept through the step is left as it was.
     */
    poseAll: (snap = false): void => {
      for (const [id, { body }] of owned) {
        if (disabled.has(id)) continue;
        const asleep = body.isSleeping();
        if (asleep && !snap && resting.has(id) && resting.get(id) === ctx.poses.get(id)) continue;
        poseBody(id, body, snap);
        if (asleep) resting.set(id, ctx.poses.get(id));
        else resting.delete(id);
      }
    },
  };
}

// ─── Riders: colliders on another entity's body ──────────

/** Where `body` is now. */
function bodyPose(body: RigidBody): Pose {
  const t = body.translation();
  return { x: t.x, y: t.y, rot: body.rotation() };
}

const ZERO_POSE: Pose = { x: 0, y: 0, rot: 0 };

/** The pose that undoes `pose`: what a world point becomes in `pose`'s frame. */
const inverse = (pose: Pose): Pose => relativePose(ZERO_POSE, pose);

/** Where a collider made by `shapeColliderDesc(rapier, shape, true)` sits in its body's frame. */
function localColliderPose(shape: ShapeObj): Pose {
  if (shape.type === "poly" || shape.type === "chain") return ZERO_POSE;
  return framedAt(shape);
}

/**
 * An entity whose collider rides another entity's body, its shape held in
 * the host body's frame.
 */
export type Rider<E extends { id: string; shape: ShapeObj }> = {
  entity: E;
  attachment: Attachment;
  /** The entity whose body it rides. */
  hostId: string;
  /** The shape in the host body's frame, once a host has been seen. */
  local: ShapeObj | null;
  /** The entity's pose in the host body's frame, once a host has been seen. */
  offset: Pose | null;
  /** The shape in the entity's own frame, once a host has been seen. */
  own: ShapeObj | null;
  /** The collider's pose in the entity's frame, once a host has been seen. */
  frame: Pose | null;
};

/**
 * Entities whose collider rides a host's body, so the host's motion carries
 * it with no per-tick sync. One the scene tree puts there rides at the pose
 * it has when it gets on. Visuals are drawn in the host's frame.
 * The riding entity's pose is the scene tree's write: one that only says
 * where the host carried it changes nothing, and any other moves the
 * collider on the host's body. A disabled host takes its riders' colliders
 * out of the world with its body.
 */
export function createRiders<
  E extends {
    id: string;
    shape: ShapeObj;
    transform?: RuntimeEntity["transform"];
    behaviors?: RuntimeEntity["behaviors"];
    z?: number;
    layer?: string;
  },
>(
  ctx: EngineContext,
  type: RegisteredType,
  opts: {
    layer: (e: E) => ViewLayer;
    draw: boolean;
    material?: (e: E) => string | undefined;
    /** Makes the collider on the host's body from a descriptor of the host-local shape. */
    collider: (body: RigidBody, desc: ColliderDesc, e: E) => Collider;
    tag: (e: E) => ColliderTag;
  },
) {
  const riders = new Map<string, Rider<E>>();
  const disabled = new Set<string>();

  function draw(e: E, shape: ShapeObj): void {
    if (!opts.draw || disabled.has(e.id)) return;
    ctx.view?.remove(e.id);
    drawEntity(
      ctx,
      type,
      {
        id: e.id,
        shape,
        material: opts.material?.(e),
        behaviors: e.behaviors,
        z: e.z,
        layer: e.layer,
      },
      opts.layer(e),
      shape,
    );
  }

  function poseView(id: string, host: AttachmentHost): void {
    if (disabled.has(id) || !ctx.view) return;
    const t = host.body.translation();
    ctx.view.pose(id, t.x, t.y, host.body.rotation());
  }

  /** `e` rides `hostId`'s body from where it is now. The collider waits while the host has no body. */
  function add(e: E, hostId: string): void {
    const rider: Rider<E> = {
      entity: e,
      attachment: null as never,
      hostId,
      local: null,
      offset: null,
      own: null,
      frame: null,
    };
    const make = (host: AttachmentHost) => {
      const spawn = shapeSpawnPose(e.shape, e.transform);
      const offset = relativePose(ctx.poses.get(e.id) ?? spawn, bodyPose(host.body));
      const local = shapeAtPose(shapeAtPose(e.shape, inverse(spawn)), offset);
      rider.local = local;
      rider.offset = offset;
      rider.own = shapeAtPose(local, inverse(offset));
      rider.frame = relativePose(localColliderPose(local), offset);
      const { rapier } = physicsOf(ctx, type.type, e.id);
      const collider = opts.collider(host.body, shapeColliderDesc(rapier, local, true), e);
      if (disabled.has(e.id)) collider.setEnabled(false);
      ctx.tags.set(collider.handle, {
        ...opts.tag(e),
        carrier: { entityId: host.id, type: host.type },
      });
      draw(e, local);
      poseView(e.id, host);
      return collider;
    };
    rider.attachment = ctx.attachments.attach(e.id, hostId, make);
    riders.set(e.id, rider);
    if (!rider.attachment.collider()) draw(e, e.shape);
  }

  function remove(id: string): boolean {
    const r = riders.get(id);
    if (!r) return false;
    r.attachment.detach();
    ctx.view?.remove(id);
    riders.delete(id);
    disabled.delete(id);
    return true;
  }

  return {
    riders,
    add,
    remove,
    /**
     * Writes a rider's pose: where its host carried it changes nothing
     * else; any other pose moves its collider on the host's body there.
     * False unless `id` rides.
     */
    setPose(id: string, pose: Readonly<Pose>): boolean {
      const r = riders.get(id);
      if (!r) return false;
      const host = r.attachment.host();
      const collider = r.attachment.collider();
      if (host && collider && r.offset && r.own && r.frame) {
        const offset = r.attachment.follow(pose, r.offset, r.frame);
        if (offset) {
          r.offset = offset;
          r.local = shapeAtPose(r.own, offset);
          draw(r.entity, r.local);
        }
        poseView(id, host);
      }
      ctx.poses.set(id, pose.x, pose.y, pose.rot);
      return true;
    },
    /**
     * `setPose` for a rider the tree carries because `hostId`, the body it
     * rides, moved: the body already put its collider there, so only its
     * pose and visual are written. False when it doesn't ride `hostId`'s body.
     */
    carried: (id: string, hostId: string, pose: Readonly<Pose>, snap: boolean): boolean => {
      const r = riders.get(id);
      if (!r || r.hostId !== hostId || !r.attachment.collider()) return false;
      if (ctx.view) {
        const host = r.attachment.host();
        if (host) poseView(id, host);
      }
      ctx.poses.set(id, pose.x, pose.y, pose.rot, snap ? { snap } : undefined);
      return true;
    },
    /** Takes a rider's collider out of the world and removes its visual; false unless `id` rides and is enabled. */
    disable(id: string): boolean {
      if (!riders.has(id) || disabled.has(id)) return false;
      riders.get(id)!.attachment.collider()?.setEnabled(false);
      ctx.view?.remove(id);
      disabled.add(id);
      return true;
    },
    /** Puts a disabled rider's collider back and redraws it where its host is now. */
    enable(id: string): boolean {
      const r = riders.get(id);
      if (!r || !disabled.delete(id)) return false;
      const collider = r.attachment.collider();
      collider?.setEnabled(true);
      const host = r.attachment.host();
      if (collider && host && r.local) {
        draw(r.entity, r.local);
        poseView(id, host);
      } else draw(r.entity, r.entity.shape);
      return true;
    },
    disabled: (id: string): boolean => disabled.has(id),
    clear: () => {
      for (const id of [...riders.keys()]) remove(id);
      disabled.clear();
    },
    /** Where a rider's collider is now, in metres; null while it waits for its host. */
    position: (id: string): Vec2 | null => {
      const c = riders.get(id)?.attachment.collider();
      if (!c) return null;
      const t = c.translation();
      return { x: t.x, y: t.y };
    },
  };
}

/** The host `host` when it has offered its body, else null: `e` keeps a body of its own that the tree moves. */
function rideTarget(ctx: EngineContext, host: string | null): string | null {
  return host !== null && ctx.attachments.hosted(host) ? host : null;
}

/**
 * The body `e`'s collider rides: the host the tree named, else, before the
 * tree has said, its `parent`, whose body it waits for, so a child that
 * spawns before its host is made on the host's body once rather than on a
 * body of its own first. Null for a body of its own.
 */
function ridingOf(
  ctx: EngineContext,
  e: { id: string; parent?: string },
  rides: ReadonlyMap<string, string | null>,
): string | null {
  if (rides.has(e.id)) return rides.get(e.id)!;
  return ctx.physics && e.parent !== undefined ? e.parent : null;
}

/** Where a system draws its entities, and whether it draws them at all. */
export type VisualOptions = {
  /** The draw layer for every entity, whatever its `layer`; omitted, the entity's layer, else the system's default. */
  layer?: ViewLayer;
  /** False when the game draws the entities itself. */
  draw?: boolean;
};

// ─── Solid ───────────────────────────────────────────────

/** Visuals default to the `terrain` layer. */
export type SolidOptions = SurfaceDefaults &
  VisualOptions & {
    /** Every entity of the type is one-way, whatever its own `oneWay` says; `true` is `"up"`, and an entity's own side wins. Omitted, the type's `oneWay`. */
    oneWay?: boolean | Side;
    /** Collision group; `static` when omitted. */
    group?: string;
  };

export type SolidSystem = SceneSystem<SolidEntity> & {
  setPose(id: string, x: number, y: number, rot: number): void;
  /**
   * Gates this system's one-way entities for one actor's box: each stays
   * solid while the actor is on its one-way side (within 0.04 m of that face)
   * and isn't `passing` through, and otherwise moves its body out of the
   * world so queries and contacts skip it. An attached one is gated by its
   * collider's collision groups instead, and one in the geometry world by
   * disabling its collider.
   */
  gateOneWaySides(actor: Aabb, passing: boolean): void;
  /** `gateOneWaySides` for the `"up"` solids alone, by the actor's bottom edge; other sides are left as they are. */
  gateOneWay(actorBottomY: number, dropping: boolean): void;
  /**
   * Gates the one-way entities for the actor `actorId` alone: each holds it
   * while it is on that solid's one-way side, and `passing` (rising, or
   * dropping through) lets it through the `"up"` solids alone, as
   * `gateOneWay` does; a `"down"`, `"left"` or `"right"` solid goes by side
   * only. The colliders it passes go into `oneWayPasses(ctx, actorId)` for
   * its own sweeps to skip, and the world is left as it is, so every other
   * actor and body still meets them.
   */
  passesOneWay(actorId: string, actor: Aabb, passing: boolean): void;
  isHidden(id: string): boolean;
  /** Where the entity's body is now; a hidden one-way body is off-world. */
  position(id: string): Vec2 | null;
};

/** m. */
const ONE_WAY_TOLERANCE = 0.04;

/** The key a context keeps each actor's one-way passes under. */
const ONE_WAY_PASSES: unique symbol = Symbol("one-way passes");

/** One actor's passes: all of them, and the ones each solid system put there, by the system's key. */
type ActorPasses = { all: Set<number>; by: Map<object, Set<number>> };

type PassesHolder = EngineContext & { [ONE_WAY_PASSES]?: Map<string, ActorPasses> };

function actorsOf(ctx: EngineContext): Map<string, ActorPasses> {
  const holder = ctx as PassesHolder;
  let actors = holder[ONE_WAY_PASSES];
  if (!actors) {
    actors = new Map();
    Object.defineProperty(holder, ONE_WAY_PASSES, { value: actors });
  }
  return actors;
}

function actorPasses(ctx: EngineContext, actorId: string): ActorPasses {
  const actors = actorsOf(ctx);
  let passes = actors.get(actorId);
  if (!passes) {
    passes = { all: new Set(), by: new Map() };
    actors.set(actorId, passes);
  }
  return passes;
}

const passesOf = (ctx: EngineContext, actorId: string): Set<number> =>
  actorPasses(ctx, actorId).all;

/**
 * Forgets an actor that is gone, with every solid system's passes for it.
 * With `passes` (the set `oneWayPasses` gave), only while that set is still
 * the actor's: a body made for it since keeps its own.
 */
export function forgetOneWayActor(
  ctx: EngineContext,
  actorId: string,
  passes?: ReadonlySet<number>,
): void {
  const actors = actorsOf(ctx);
  if (passes === undefined || actors.get(actorId)?.all === passes) actors.delete(actorId);
}

/**
 * The handles of the one-way colliders `actorId` passes through, from every
 * solid system's last `passesOneWay` for it: what its sweeps skip (a
 * `SpaceFilter`'s `skip`). The same live set for the actor on this context,
 * empty for an actor no system gated.
 */
export function oneWayPasses(ctx: EngineContext, actorId: string): ReadonlySet<number> {
  return passesOf(ctx, actorId);
}

/**
 * A character controller's move that leaves out the colliders in `skip`.
 * Rapier's filter callbacks don't reach JS from every wasm loader, so a
 * collider in `skip` the move meets has its collision groups lifted to 0 and
 * the move is run again; each gets its groups back before this returns, so
 * no step and no other query sees the change. With `skip` empty it is the
 * one plain call.
 */
export function computeMovementSkipping(
  controller: KinematicCharacterController,
  collider: Collider,
  delta: Vector,
  filterFlags: QueryFilterFlags,
  filterGroups: InteractionGroups,
  skip: ReadonlySet<number>,
): void {
  controller.computeColliderMovement(collider, delta, filterFlags, filterGroups);
  if (skip.size === 0) return;
  const lifted: { collider: Collider; groups: InteractionGroups }[] = [];
  for (;;) {
    let more = false;
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      const hit = controller.computedCollision(i)?.collider;
      if (!hit || !skip.has(hit.handle) || lifted.some((l) => l.collider.handle === hit.handle))
        continue;
      lifted.push({ collider: hit, groups: hit.collisionGroups() });
      hit.setCollisionGroups(0);
      more = true;
    }
    if (!more) break;
    controller.computeColliderMovement(collider, delta, filterFlags, filterGroups);
  }
  for (let i = lifted.length - 1; i >= 0; i--) {
    const l = lifted[i]!;
    l.collider.setCollisionGroups(l.groups);
  }
}
/** Where a hidden one-way body waits, m: far outside any scene. */
const HIDDEN_Y = -999.99;

/** Whether `actor` is on a one-way solid's `side`, at most the tolerance past that face: where the solid holds it. */
function onOneWaySide(side: Side, solid: Aabb, actor: Aabb): boolean {
  switch (side) {
    case "up":
      return actor.maxY <= solid.minY + ONE_WAY_TOLERANCE;
    case "down":
      return actor.minY >= solid.maxY - ONE_WAY_TOLERANCE;
    case "left":
      return actor.maxX <= solid.minX + ONE_WAY_TOLERANCE;
    case "right":
      return actor.minX >= solid.maxX - ONE_WAY_TOLERANCE;
  }
}

/** A posed body's save: `state` plus `moved` when `setPose` moved it; undefined when that holds nothing. */
function savedBody(moved: boolean, state: Record<string, JsonValue>): JsonValue | undefined {
  const out = moved ? { ...state, moved: true } : state;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Puts a body `setPose` moved before a save where the save's pose index,
 * already restored, holds it, since a fresh load placed it at its spawn.
 */
function restoreMoved(
  ctx: EngineContext,
  id: string,
  state: Readonly<Record<string, JsonValue>>,
  setPose: (id: string, x: number, y: number, rot: number) => void,
): void {
  const pose = state.moved === true ? ctx.poses.get(id) : undefined;
  if (pose) setPose(id, pose.x, pose.y, pose.rot);
}

type SolidBody = OwnedBody & {
  pose: Vec2;
  box: Aabb;
  oneWay: Side | null;
  hidden: boolean;
};

export function createSolidSystem(
  ctx: EngineContext,
  type: RegisteredType,
  opts: SolidOptions = {},
): SolidSystem {
  const table = createBodyTable<SolidBody>(ctx, { body: "static" });
  const physicsFor = (id: string) => physicsOf(ctx, type.type, id);
  const group = opts.group ?? "static";
  const groups = ctx.registry.collisionGroups(group);
  /** One-way solids in the geometry world, gated by enabling their colliders. */
  const placedOneWay = new Map<
    string,
    { handle: number; box: Aabb; side: Side; hidden: boolean }
  >();
  const typeSide = opts.oneWay ?? type.oneWay;
  const sideOf = (e: SolidEntity) => oneWaySideOf(e.oneWay, typeSide);
  /** Attached one-way solids gated off: their collider's groups are 0 until the actor is above them again. */
  const gated = new Set<string>();
  /** Each live entity's record, to redraw it on enable. */
  const records = new Map<string, SolidEntity>();
  /** The key this system's own share of each actor's `oneWayPasses` is kept under. */
  const passKey = {};
  /** The body above each entity the tree said carries its collider; null for its own. */
  const rides = new Map<string, string | null>();
  const riders = createRiders<SolidEntity>(ctx, type, {
    layer: (e) => opts.layer ?? entityDrawLayer(ctx, e, "terrain"),
    draw: opts.draw !== false,
    material: (e) => e.material,
    collider: (body, desc, e) =>
      physicsFor(e.id).physics.addCollider(
        applySurface(
          desc.setCollisionGroups(gated.has(e.id) ? 0 : groups),
          surfaceOf(ctx, e.material, opts),
        ),
        body,
      ),
    tag: (e) => tagOf(e),
  });

  function setHidden(id: string, solid: SolidBody, hidden: boolean): void {
    if (solid.hidden === hidden) return;
    const { rapier, physics } = physicsFor(id);
    const y = hidden ? HIDDEN_Y : solid.pose.y;
    solid.body.setTranslation(new rapier.Vector2(solid.pose.x, y), true);
    physics.moved(solid.body);
    solid.hidden = hidden;
  }

  function colliderDesc(e: SolidEntity): ColliderDesc {
    const { rapier } = physicsFor(e.id);
    const surface = surfaceOf(ctx, e.material, opts);
    return applySurface(shapeColliderDesc(rapier, e.shape).setCollisionGroups(groups), surface);
  }

  function tagOf(e: SolidEntity): ColliderTag {
    const tag = surfaceTag(e.id, type, e.material);
    const side = sideOf(e);
    if (side) {
      tag.oneWay = true;
      tag.oneWaySide = side;
    }
    return tag;
  }

  function placement(e: SolidEntity): Omit<SolidBody, keyof OwnedBody> {
    const pose = shapePose(e.shape);
    return {
      pose: { x: pose.x, y: pose.y },
      box: aabb(e.shape),
      oneWay: sideOf(e),
      hidden: false,
    };
  }

  function draw(e: SolidEntity): void {
    if (opts.draw === false || table.disabled(e.id)) return;
    drawEntity(ctx, type, e, opts.layer ?? entityDrawLayer(ctx, e, "terrain"));
    table.poseDrawn(e.id);
  }

  /** Takes the entity's collider and body (or its seat on a host) out, keeping its record. */
  function drop(id: string): void {
    forgetPasses(ctx.tags.handlesOf(id));
    gated.delete(id);
    placedOneWay.delete(id);
    if (!riders.remove(id)) table.despawn(id);
  }

  function despawn(id: string): void {
    drop(id);
    records.delete(id);
    rides.delete(id);
  }

  /** Gates a one-way solid in the geometry world; a disabled one keeps its collider off and only tracks the gate. */
  function setPlacedHidden(
    id: string,
    solid: { handle: number; hidden: boolean },
    hidden: boolean,
  ): void {
    if (solid.hidden === hidden) return;
    if (!table.disabled(id)) ctx.geometry?.setEnabled(solid.handle, !hidden);
    solid.hidden = hidden;
  }

  function spawn(e: SolidEntity): void {
    drop(e.id);
    records.set(e.id, e);
    const host = ridingOf(ctx, e, rides);
    if (host) return riders.add(e, host);
    if (!ctx.physics) {
      const handle = table.place(e, { body: "static", group }, tagOf(e));
      const side = sideOf(e);
      if (handle !== null && side)
        placedOneWay.set(e.id, { handle, box: aabb(e.shape), side, hidden: false });
      return draw(e);
    }
    const { rapier, physics } = physicsFor(e.id);
    const desc = colliderDesc(e);
    const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
    const collider = physics.addCollider(desc, body);
    table.add(e, { body, collider, ...placement(e) }, tagOf(e));
    draw(e);
  }

  /**
   * Moves the solid's body (or geometry collider) with it, so a moved door
   * blocks where it is drawn; a hidden one-way solid stays out of the world
   * until its gate shows it there. A riding solid's collider moves on its
   * host's body, unless the pose is where the host carried it.
   */
  function setPose(id: string, x: number, y: number, rot: number): void {
    const e = records.get(id);
    if (!e || riders.setPose(id, { x, y, rot })) return;
    const frame = table.setPose(id, { x, y, rot }, e.shape);
    if (!frame) return;
    const box = aabb(shapeAtPose(bodyLocalShape(e.shape), frame));
    const solid = table.owned.get(id);
    if (solid) {
      solid.pose = { x: frame.x, y: frame.y };
      solid.box = box;
      if (solid.hidden) moveBodyNow(ctx, id, solid, { ...frame, y: HIDDEN_Y });
    }
    const placed = placedOneWay.get(id);
    if (placed) placed.box = box;
    if (opts.draw !== false) table.poseDrawn(id);
  }

  return {
    spawn,
    update(e) {
      const solid = table.owned.get(e.id);
      if (!solid) return spawn(e);
      records.set(e.id, e);
      const desc = colliderDesc(e);
      table.reshape(e, solid, (body) => physicsFor(e.id).physics.addCollider(desc, body), tagOf(e));
      Object.assign(solid, placement(e));
      if (opts.draw !== false) ctx.view?.remove(e.id);
      draw(e);
    },
    despawn,
    disable,
    /** A one-way solid comes back as its gate holds it now, solid or passed through. */
    enable(id) {
      if (riders.enable(id)) return;
      if (!table.enable(id, placedOneWay.get(id)?.hidden !== true)) return;
      const e = records.get(id);
      if (e) draw(e);
    },
    clear() {
      forgetPasses(null);
      riders.clear();
      gated.clear();
      placedOneWay.clear();
      records.clear();
      rides.clear();
      table.clear();
    },
    reset() {
      for (const [id, solid] of table.owned) setHidden(id, solid, false);
      for (const [id, solid] of placedOneWay) setPlacedHidden(id, solid, false);
      for (const id of [...gated]) gate(id, false);
      forgetPasses(null);
    },
    size: () => table.size() + riders.riders.size,
    /** A one-way solid's gate while it lets actors through, and whether `setPose` moved it. */
    save(id) {
      const hidden = table.owned.get(id)?.hidden ?? placedOneWay.get(id)?.hidden ?? gated.has(id);
      return savedBody(table.wasMoved(id), hidden ? { hidden: true } : {});
    },
    restore(id, state) {
      if (typeof state !== "object" || state === null || Array.isArray(state)) return;
      restoreMoved(ctx, id, state, setPose);
      setGate(id, state.hidden === true);
    },
    /** A rider still waiting for a parent the tree never linked gets a body of its own. */
    ready(ids) {
      for (const id of ids) if (riders.riders.has(id) && !rides.has(id)) this.ride!(id, null);
    },
    /** Moves the collider onto `host`'s body where the solid is now, or back onto its own. */
    ride(id, host) {
      const e = records.get(id);
      if (!e || !ctx.physics) return;
      const target = rideTarget(ctx, host);
      const was = riders.riders.get(id)?.hostId ?? null;
      rides.set(id, target);
      if (target === was) return;
      const off = table.disabled(id) || riders.disabled(id);
      const hidden = isHidden(id);
      const pose = ctx.poses.get(id);
      spawn(e);
      if (pose && !riders.riders.has(id) && !samePose(pose, shapeSpawnPose(e.shape, e.transform)))
        setPose(id, pose.x, pose.y, pose.rot);
      if (hidden) setGate(id, true);
      if (off) disable(id);
    },
    gateOneWaySides: (actor, passing) => gateSides(actor, passing, null),
    passesOneWay(actorId, actor, passing) {
      const { all, by } = actorPasses(ctx, actorId);
      let mine = by.get(passKey);
      if (!mine) {
        mine = new Set();
        by.set(passKey, mine);
      }
      for (const handle of mine) all.delete(handle);
      mine.clear();
      eachOneWay(null, (_id, side, box, handle) => {
        const passes = (passing && side === "up") || !onOneWaySide(side, box, actor);
        if (!passes || handle === undefined) return;
        mine.add(handle);
        all.add(handle);
      });
    },
    gateOneWay(actorBottomY, dropping) {
      const edge = { minX: 0, minY: actorBottomY, maxX: 0, maxY: actorBottomY };
      gateSides(edge, dropping, "up");
    },
    isHidden,
    position: (id) => table.position(id) ?? riders.position(id),
    setPose,
    carried: riders.carried,
  };

  function disable(id: string): void {
    if (!riders.disable(id)) table.disable(id);
  }

  function isHidden(id: string): boolean {
    return table.owned.get(id)?.hidden ?? placedOneWay.get(id)?.hidden ?? gated.has(id);
  }

  /** Gates a one-way solid as a save or a move between bodies held it. */
  function setGate(id: string, hidden: boolean): void {
    const solid = table.owned.get(id);
    if (solid) return solid.oneWay ? setHidden(id, solid, hidden) : undefined;
    const placed = placedOneWay.get(id);
    if (placed) return setPlacedHidden(id, placed, hidden);
    if (riders.riders.has(id)) gate(id, hidden);
  }

  /** Gates each one-way solid, or each of side `only`: hidden unless the actor is on its side and not passing. */
  function gateSides(actor: Aabb, passing: boolean, only: Side | null): void {
    eachOneWay(only, (id, side, box) => {
      const hidden = passing || !onOneWaySide(side, box, actor);
      const solid = table.owned.get(id);
      if (solid) return setHidden(id, solid, hidden);
      const placed = placedOneWay.get(id);
      if (placed) return setPlacedHidden(id, placed, hidden);
      gate(id, hidden);
    });
  }

  /**
   * Visits each one-way solid, or each of side `only`, with its side, its
   * box where it is now and its collider's handle: the solids this system
   * owns, then those in the geometry world, then the attached ones.
   */
  function eachOneWay(
    only: Side | null,
    visit: (id: string, side: Side, box: Aabb, handle: number | undefined) => void,
  ): void {
    const takes = (side: Side | null): side is Side => !!side && (only === null || side === only);
    for (const [id, solid] of table.owned)
      if (takes(solid.oneWay)) visit(id, solid.oneWay, solid.box, solid.collider.handle);
    for (const [id, solid] of placedOneWay)
      if (takes(solid.side)) visit(id, solid.side, solid.box, solid.handle);
    for (const r of riders.riders.values()) {
      const side = sideOf(r.entity);
      const host = r.attachment.host();
      if (!takes(side) || !host || !r.local) continue;
      const at = bodyPose(host.body);
      let box: Aabb;
      if (at.rot === 0) {
        const b = aabb(r.local);
        box = {
          minX: at.x + b.minX,
          minY: at.y + b.minY,
          maxX: at.x + b.maxX,
          maxY: at.y + b.maxY,
        };
      } else box = aabb(shapeAtPose(r.local, at));
      visit(r.entity.id, side, box, r.attachment.collider()?.handle);
    }
  }

  /** Takes `handles` (all of them, for null) back out of every actor's `oneWayPasses`. */
  function forgetPasses(handles: readonly number[] | null): void {
    for (const { all, by } of actorsOf(ctx).values()) {
      const mine = by.get(passKey);
      if (!mine) continue;
      for (const handle of handles ?? mine) {
        if (!mine.has(handle)) continue;
        all.delete(handle);
        if (handles) mine.delete(handle);
      }
      if (!handles) mine.clear();
    }
  }

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

/** A prop's body: posed at its shape, with only the body fields it sets, so others keep Rapier's defaults. */
function propBodyDesc(desc: RigidBodyDesc, e: PropEntity): RigidBodyDesc {
  posedBodyDesc(desc, e.shape);
  if (e.gravityScale !== undefined) desc.setGravityScale(e.gravityScale);
  if (e.linearDamping !== undefined) desc.setLinearDamping(e.linearDamping);
  if (e.angularDamping !== undefined) desc.setAngularDamping(e.angularDamping);
  if (e.fixedRotation === true) desc.lockRotations();
  if (e.ccd !== undefined) desc.setCcdEnabled(e.ccd);
  return desc;
}

export function createPropSystem(
  ctx: EngineContext,
  type: RegisteredType,
): SceneSystem<PropEntity> {
  const table = createBodyTable(ctx, { body: "dynamic" });
  const groups = ctx.registry.collisionGroups("dynamic");
  const records = new Map<string, PropEntity>();

  const draw = (e: PropEntity) =>
    drawEntity(ctx, type, e, entityDrawLayer(ctx, e, "body"), bodyLocalShape(e.shape));

  function despawn(id: string): void {
    if (table.owned.has(id)) ctx.attachments.unhost(id);
    table.despawn(id);
  }

  return {
    spawn(e) {
      despawn(e.id);
      records.set(e.id, e);
      const { rapier, physics } = physicsOf(ctx, type.type, e.id);
      const surface = surfaceOf(ctx, e.material, {});
      const body = physics.addRigidBody(propBodyDesc(rapier.RigidBodyDesc.dynamic(), e));
      const desc = shapeColliderDesc(rapier, e.shape)
        .setCollisionGroups(groups)
        .setRestitution(e.restitution)
        .setDensity(e.density);
      const friction = e.friction ?? surface.friction;
      if (friction !== undefined) desc.setFriction(friction);
      const collider = physics.addCollider(desc, body);
      table.add(e, { body, collider }, surfaceTag(e.id, type, e.material));
      ctx.attachments.host(e.id, type.type, body);
      draw(e);
      table.pose(e.id);
    },
    despawn(id) {
      records.delete(id);
      despawn(id);
    },
    /** The body stops where it is, keeping its velocity for `enable`. */
    disable(id) {
      table.disable(id);
    },
    enable(id) {
      const e = records.get(id);
      if (!table.enable(id) || !e) return;
      draw(e);
      table.pose(id);
    },
    clear() {
      for (const id of table.owned.keys()) ctx.attachments.unhost(id);
      records.clear();
      table.clear();
    },
    size: table.size,
    afterStep: () => table.poseAll(),
    /** Puts the body there now, with what rides it, keeping its velocity, and wakes it. */
    setPose(id, x, y, rot) {
      const e = records.get(id);
      if (!e || !table.setPose(id, { x, y, rot }, e.shape)) return;
      table.pose(id);
      if (ctx.attachments.attachedTo(id).length > 0)
        physicsOf(ctx, type.type, id).physics.world.propagateModifiedBodyPositionsToColliders();
    },
    /** Its body moves it in the world: a parent's movement doesn't carry it. */
    selfMoving: () => true,
  };
}

// ─── Sensor ──────────────────────────────────────────────

const sameColliders = (a: readonly Collider[] | undefined, b: readonly Collider[]): boolean =>
  a !== undefined && a.length === b.length && a.every((collider, i) => collider === b[i]);

/**
 * From this many sensors up, each one tests only the colliders near it;
 * below, finding those costs more than testing every pair.
 */
const CANDIDATES_MIN_SENSORS = 32;

/** Raises `sensor:enter` / `sensor:exit` after each step for every collider that starts or stops overlapping. */
export type SensorSystem = SceneSystem<SensorEntity> & {
  afterStep(dtMs: number): void;
  setPose(id: string, x: number, y: number, rot: number): void;
};

/** Overlapping collider handle → the entity id its tag names. */
export type Overlaps = Map<number, string | undefined>;

/** Raises a sensor's `sensor:enter` and `sensor:exit` from what overlapped it before and now. */
export type OverlapTracker = {
  /**
   * Enter for each handle in `now` and not `before`, then exit for each in
   * `before` and not `now`, each at `at(handle)`, with the handle's entity
   * as `other`.
   */
  diff(id: string, before: Overlaps, now: Overlaps, at: (handle: number) => Vec2): void;
};

export function createOverlapTracker(ctx: EngineContext): OverlapTracker {
  function raise(kind: string, id: string, at: Vec2, other?: string) {
    const event: Omit<StepEvent, "tick"> = { type: kind, entityId: id, at };
    if (other !== undefined) event.other = other;
    ctx.emit(event);
  }

  return {
    diff(id, before, now, at) {
      for (const [handle, other] of now) {
        if (!before.has(handle)) raise(SENSOR_ENTER, id, at(handle), other);
      }
      for (const [handle, other] of before) {
        if (!now.has(handle)) raise(SENSOR_EXIT, id, at(handle), other);
      }
    },
  };
}
type SensorBody = OwnedBody & { inside: Overlaps };
type PlacedSensor = {
  handle: number;
  inside: Overlaps;
  next: Map<number, SpaceHit> | null;
  fresh: boolean;
};

/**
 * An overlap kept by what owns the collider rather than by its handle, which
 * a fresh load may hand out differently: the entity id and the collider's
 * place among that entity's handles in ascending order.
 */
type SavedOverlap = [entityId: string, nth: number];

export function saveOverlaps(tags: ColliderTags, overlaps: Overlaps): SavedOverlap[] {
  const saved: SavedOverlap[] = [];
  for (const [handle, entityId] of overlaps) {
    if (entityId === undefined) continue;
    const nth = tags
      .handlesOf(entityId)
      .sort((a, b) => a - b)
      .indexOf(handle);
    if (nth >= 0) saved.push([entityId, nth]);
  }
  return saved;
}

export function restoreOverlaps(tags: ColliderTags, saved: JsonValue | undefined): Overlaps {
  const overlaps: Overlaps = new Map();
  if (!Array.isArray(saved)) return overlaps;
  for (const item of saved) {
    if (!Array.isArray(item)) continue;
    const [entityId, nth] = item;
    if (typeof entityId !== "string" || typeof nth !== "number") continue;
    const handle = tags.handlesOf(entityId).sort((a, b) => a - b)[nth];
    if (handle !== undefined) overlaps.set(handle, entityId);
  }
  return overlaps;
}

export function createSensorSystem(ctx: EngineContext, type: RegisteredType): SensorSystem {
  const table = createBodyTable<SensorBody>(ctx, { body: "static" });
  const physicsFor = (id: string) => physicsOf(ctx, type.type, id);
  const inside = new Map<string, Overlaps>();
  /**
   * Sensors in the geometry world, in spawn order: what overlapped each at
   * the last step, and what overlaps it at the start of this one. `fresh`
   * after an enable that came too late for this step's `beforeStep`: its
   * overlaps are taken at `afterStep` instead.
   */
  const placedSensors = new Map<string, PlacedSensor>();
  /**
   * The colliders as the coming step finds them, and who is near whom:
   * Rapier tests overlaps where bodies stand when a step starts, so that is
   * where a sensor's candidates are taken, not where the step leaves them.
   */
  let stepStart: { colliders: Collider[]; near: (c: Collider) => number[] } | null = null;
  const records = new Map<string, SensorEntity>();
  /** The body above each entity the tree said carries its collider; null for its own. */
  const rides = new Map<string, string | null>();
  const draw = (e: SensorEntity) => {
    drawEntity(ctx, type, e, entityDrawLayer(ctx, e, "terrain"));
    table.poseDrawn(e.id);
  };
  const riders = createRiders<SensorEntity>(ctx, type, {
    layer: (e) => entityDrawLayer(ctx, e, "terrain"),
    draw: true,
    collider: (body, desc) => createSensorCollider(ctx, body, desc),
    tag: (e) => tagOf(e),
  });

  function positionOf(id: string, handle: number, fallback: Collider): Vec2 {
    const { physics } = physicsFor(id);
    const t = (physics.world.getCollider(handle)?.parent() ?? fallback.parent())?.translation();
    return t ? { x: t.x, y: t.y } : { x: 0, y: 0 };
  }

  const tracker = createOverlapTracker(ctx);

  /**
   * Where a geometry collider's body would be on Rapier: its entity's
   * position when its system reports one, else the hit's point.
   */
  function originOf(hit: SpaceHit | undefined, handle: number): Vec2 {
    const tag = hit?.tag ?? ctx.tags.get(handle);
    if (tag) {
      const system = ctx.system(tag.type) as
        | (SceneSystem & { position?: (id: string) => Vec2 | null })
        | undefined;
      const at = system?.position?.(tag.entityId);
      if (at) return { x: at.x, y: at.y };
    }
    return hit ? { x: hit.at.x, y: hit.at.y } : { x: 0, y: 0 };
  }

  /**
   * Takes each geometry sensor's overlaps (`space.overlaps`, in handle
   * order, against what the sensor group meets) before anything moves this
   * step, as Rapier's step finds intersections before it moves bodies.
   */
  function overlapsOf(sensor: PlacedSensor): Map<number, SpaceHit> {
    const next = new Map<number, SpaceHit>();
    const shape = ctx.geometry?.shape(sensor.handle);
    if (!shape) return next;
    for (const hit of ctx.space.overlaps(shape, { group: "sensor" })) {
      if (hit.handle !== sensor.handle) next.set(hit.handle, hit);
    }
    return next;
  }

  function takePlaced(): void {
    if (!ctx.geometry) return;
    for (const [id, sensor] of placedSensors) {
      if (table.disabled(id)) continue;
      sensor.fresh = false;
      sensor.next = overlapsOf(sensor);
    }
  }

  function raisePlaced(): void {
    for (const [id, sensor] of placedSensors) {
      if (table.disabled(id)) continue;
      if (sensor.fresh) {
        sensor.fresh = false;
        sensor.next = overlapsOf(sensor);
      }
      const hits = sensor.next;
      if (!hits) continue;
      const now: Overlaps = new Map([...hits].map(([h, hit]) => [h, hit.tag.entityId]));
      tracker.diff(id, sensor.inside, now, (h) => originOf(hits.get(h), h));
      sensor.inside = now;
      sensor.next = null;
    }
  }

  function tagOf(e: SensorEntity): ColliderTag {
    const tag: ColliderTag = { entityId: e.id, type: type.type };
    if (e.tags) tag.tags = e.tags;
    return tag;
  }

  /** Takes the sensor's collider and body (or its seat on a host) out, keeping its record. */
  function drop(id: string): void {
    inside.delete(id);
    placedSensors.delete(id);
    if (!riders.remove(id)) table.despawn(id);
  }

  function despawn(id: string): void {
    drop(id);
    records.delete(id);
    rides.delete(id);
  }

  function spawn(e: SensorEntity): void {
    drop(e.id);
    records.set(e.id, e);
    const host = ridingOf(ctx, e, rides);
    if (host) return riders.add(e, host);
    if (!ctx.physics) {
      const handle = table.place(e, { body: "static", sensor: true, group: "sensor" }, tagOf(e));
      if (handle !== null)
        placedSensors.set(e.id, { handle, inside: new Map(), next: null, fresh: false });
      return draw(e);
    }
    const { rapier, physics } = physicsFor(e.id);
    const desc = shapeColliderDesc(rapier, e.shape);
    const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
    const collider = createSensorCollider(ctx, body, desc);
    table.add(e, { body, collider, inside: new Map() }, tagOf(e));
    draw(e);
  }

  /**
   * Moves the sensor's collider with it: what it overlaps where it is now
   * raises the enters and exits of the next step. A riding sensor's
   * collider moves on its host's body, unless the pose is where the host
   * carried it.
   */
  function setPose(id: string, x: number, y: number, rot: number): void {
    const e = records.get(id);
    if (!e || riders.setPose(id, { x, y, rot })) return;
    if (table.setPose(id, { x, y, rot }, e.shape)) table.poseDrawn(id);
  }

  function disable(id: string): void {
    if (riders.disable(id)) {
      inside.delete(id);
      return;
    }
    if (!table.disable(id)) return;
    const owned = table.owned.get(id);
    if (owned) owned.inside = new Map();
    const placed = placedSensors.get(id);
    if (placed) {
      placed.inside = new Map();
      placed.next = null;
    }
  }

  return {
    spawn,
    update(e, prev) {
      const sensor = table.owned.get(e.id);
      if (!sensor) return spawn(e);
      records.set(e.id, e);
      sensor.inside = new Map();
      if (sameShape(e.shape, prev.shape)) {
        ctx.tags.set(sensor.collider.handle, tagOf(e));
        return;
      }
      const desc = shapeColliderDesc(physicsFor(e.id).rapier, e.shape);
      table.reshape(e, sensor, (body) => createSensorCollider(ctx, body, desc), tagOf(e));
      ctx.view?.remove(e.id);
      if (!table.disabled(e.id)) draw(e);
    },
    despawn,
    /** Forgets what is inside without raising exits. */
    disable,
    /** What is inside at the next `afterStep` raises enters then. */
    enable(id) {
      const e = records.get(id);
      if (riders.enable(id)) return;
      if (!table.enable(id)) return;
      const placed = placedSensors.get(id);
      if (placed) placed.fresh = true;
      if (e) draw(e);
    },
    /** A rider still waiting for a parent the tree never linked gets a body of its own. */
    ready(ids) {
      for (const id of ids) if (riders.riders.has(id) && !rides.has(id)) this.ride!(id, null);
    },
    /** Moves the collider onto `host`'s body where the sensor is now, or back onto its own, keeping what is inside. */
    ride(id, host) {
      const e = records.get(id);
      if (!e || !ctx.physics) return;
      const target = rideTarget(ctx, host);
      const was = riders.riders.get(id)?.hostId ?? null;
      rides.set(id, target);
      if (target === was) return;
      const off = table.disabled(id) || riders.disabled(id);
      const kept = table.owned.get(id)?.inside ?? inside.get(id);
      const pose = ctx.poses.get(id);
      spawn(e);
      if (pose && !riders.riders.has(id) && !samePose(pose, shapeSpawnPose(e.shape, e.transform)))
        setPose(id, pose.x, pose.y, pose.rot);
      if (kept) {
        const owned = table.owned.get(id);
        if (owned) owned.inside = kept;
        else inside.set(id, kept);
      }
      if (off) disable(id);
    },
    clear() {
      riders.clear();
      inside.clear();
      placedSensors.clear();
      records.clear();
      rides.clear();
      table.clear();
    },
    reset() {
      for (const sensor of table.owned.values()) sensor.inside.clear();
      for (const sensor of placedSensors.values()) {
        sensor.inside.clear();
        sensor.next = null;
        sensor.fresh = false;
      }
      inside.clear();
    },
    size: () => table.size() + riders.riders.size,
    setPose,
    carried: riders.carried,
    /**
     * What overlaps the sensor since the last step, so a restore raises no
     * enter for it again, and whether `setPose` moved it.
     */
    save(id): JsonValue | undefined {
      const placed = placedSensors.get(id);
      const overlaps = placed?.inside ?? table.owned.get(id)?.inside ?? inside.get(id);
      const saved = overlaps ? saveOverlaps(ctx.tags, overlaps) : [];
      const moved = table.wasMoved(id);
      if (placed?.fresh) return savedBody(moved, { inside: saved, fresh: true });
      return savedBody(moved, saved.length > 0 ? { inside: saved } : {});
    },
    restore(id, state) {
      if (typeof state !== "object" || state === null || Array.isArray(state)) return;
      restoreMoved(ctx, id, state, setPose);
      const overlaps = restoreOverlaps(ctx.tags, state.inside);
      const placed = placedSensors.get(id);
      if (placed) {
        placed.inside = overlaps;
        placed.next = null;
        placed.fresh = state.fresh === true;
        return;
      }
      const owned = table.owned.get(id);
      if (owned) owned.inside = overlaps;
      else if (riders.riders.has(id)) inside.set(id, overlaps);
    },
    beforeStep() {
      if (placedSensors.size > 0) takePlaced();
    },
    beforePhysics() {
      stepStart = null;
      if (table.owned.size + riders.riders.size < CANDIDATES_MIN_SENSORS) return;
      const colliders = physicsOf(ctx, type.type).physics.world.colliders.getAll();
      const sensors: Collider[] = [];
      for (const sensor of table.owned.values()) sensors.push(sensor.collider);
      for (const r of riders.riders.values()) {
        const collider = r.attachment.collider();
        if (collider) sensors.push(collider);
      }
      stepStart = { colliders, near: colliderCandidates(colliders, sensors) };
    },
    afterStep() {
      if (placedSensors.size > 0) raisePlaced();
      if (table.owned.size === 0 && riders.riders.size === 0) return;
      // Pairwise checks rather than `intersectionPairsWith`, whose wasm callback fails under Node test runners.
      const { physics } = physicsOf(ctx, type.type);
      const colliders = physics.world.colliders.getAll();
      const candidates = sameColliders(stepStart?.colliders, colliders) ? stepStart!.near : null;
      stepStart = null;
      const check = (id: string, collider: Collider, before: Overlaps): Overlaps => {
        const now: Overlaps = new Map();
        const test = (other: Collider) => {
          if (other !== collider && physics.world.intersectionPair(collider, other)) {
            now.set(other.handle, ctx.tags.get(other.handle)?.entityId);
          }
        };
        if (candidates) for (const i of candidates(collider)) test(colliders[i]!);
        else for (const other of colliders) test(other);
        tracker.diff(id, before, now, (handle) => positionOf(id, handle, collider));
        return now;
      };
      for (const [id, sensor] of table.owned) {
        if (!table.disabled(id)) sensor.inside = check(id, sensor.collider, sensor.inside);
      }
      for (const [id, r] of riders.riders) {
        if (riders.disabled(id)) continue;
        const collider = r.attachment.collider();
        if (collider) inside.set(id, check(id, collider, inside.get(id) ?? new Map()));
      }
    },
  };
}
