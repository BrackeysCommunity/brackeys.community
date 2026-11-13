import type { ImpulseJoint, RigidBody, UnitImpulseJoint } from "@dimforge/rapier2d";

import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { JointBlock, JointSystem } from "../../game/behaviors/joint";
import { physicsOf } from "../../game/physics-of";
import { EngineError, scopedRef, type EngineContext, type JsonValue } from "../../game/types";
import type { PhysicsWorld } from "../../physics";
import { composePose, relativePose, type Pose } from "../poses";

type Vec = { x: number; y: number };

/** A spring's pull when its block sets none, N/m. */
const DEFAULT_SPRING_STIFFNESS = 100;
/** A spring's damping when its block sets none, N·s/m. */
const DEFAULT_SPRING_DAMPING = 1;

type Linked = {
  block: JointBlock;
  /** The entity `to` resolved to (`scopedRef`). */
  target: string;
  /**
   * Where the joint holds `to`, from its pose, when the block sets no
   * `anchorB`: the point under this body's anchor when the joint was first
   * made, kept so a remade joint holds where the first one did.
   */
  held: Vec | null;
  /** The Rapier joint and the two bodies it was made between, while it exists. */
  joint: number | null;
  self: number | null;
  other: number | null;
  disabled: boolean;
};

const ZERO: Pose = { x: 0, y: 0, rot: 0 };

const rotate = (v: Vec, rot: number): Vec => {
  if (rot === 0) return { x: v.x, y: v.y };
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/** `to` as the entity it names (`scopedRef`): a load already scoped an instance's own, so this covers a block written live. */
const targetOf = (ctx: EngineContext, id: string, to: string): string =>
  scopedRef(id, to, (other) => ctx.exists(other));

/** The inverse inertia (or mass) a motor pushes against: 0 for a body that isn't dynamic. */
const inverse = (dynamic: boolean, amount: number): number =>
  dynamic && Number.isFinite(amount) && amount > 0 ? 1 / amount : 0;

/**
 * The `joint` behavior's system. It links the entity's body to the body of
 * the entity `to` names (Rapier's first body is `to`'s, the second this
 * one's, so limits and the motor read this body relative to `to`). Joints
 * are made in `ready`, after every body of the load exists, and follow
 * their bodies: before each physics step a joint whose end is gone or
 * disabled is removed, and one whose ends are both live again, or were
 * rebuilt, is made again, in attach order. A motor drives the relative
 * speed toward its target with at most `maxForce` each tick, through
 * `ctx.bodies`; it keeps nothing between ticks.
 */
export const createJointSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const linked = new Map<string, Linked>();

  /**
   * The body that holds `id`'s first collider that isn't a sensor, in handle
   * order: what validation's `joint-ref-type` expects of an entity with a
   * body, a non-sensor collider, or a type that declares `ownsBody`.
   */
  function bodyOf(physics: PhysicsWorld, id: string, cached: number | null): RigidBody | null {
    if (cached !== null) {
      const body = physics.world.bodies.get(cached);
      if (body) return body;
    }
    let best: RigidBody | null = null;
    let bestHandle = Infinity;
    for (const handle of ctx.tags.handlesOf(id)) {
      const collider = physics.world.getCollider(handle);
      if (!collider || collider.isSensor() || handle >= bestHandle) continue;
      const parent = collider.parent();
      if (!parent) continue;
      best = parent;
      bestHandle = handle;
    }
    return best;
  }

  function live(physics: PhysicsWorld, l: Linked): ImpulseJoint | null {
    return l.joint === null ? null : physics.world.impulseJoints.get(l.joint);
  }

  function drop(l: Linked): void {
    const physics = ctx.physics;
    const joint = physics && live(physics, l);
    if (joint) physics.world.removeImpulseJoint(joint, true);
    l.joint = null;
    l.self = null;
    l.other = null;
  }

  /** Where `anchor`, local to the entity's pose, sits in the world. */
  function worldOf(entityId: string, anchor: Vec): Pose {
    const pose = ctx.poses.get(entityId) ?? ZERO;
    return composePose(pose.x, pose.y, pose.rot, { x: anchor.x, y: anchor.y, rot: 0 });
  }

  /** Where `anchor`, local to the entity's pose, sits in `body`'s own frame. */
  function anchorIn(body: RigidBody, entityId: string, anchor: Vec): Vec {
    const at = worldOf(entityId, anchor);
    const t = body.translation();
    const local = relativePose(at, { x: t.x, y: t.y, rot: body.rotation() });
    return { x: local.x, y: local.y };
  }

  function make(id: string, l: Linked, self: RigidBody, other: RigidBody): void {
    const { rapier, physics } = physicsOf(ctx, "a joint", id);
    const { block } = l;
    const anchorA = vec(block.anchorA);
    if (block.anchorB === undefined && l.held === null) {
      const at = relativePose(worldOf(id, anchorA), ctx.poses.get(l.target) ?? ZERO);
      l.held = { x: at.x, y: at.y };
    }
    const onOther = anchorIn(other, l.target, block.anchorB ? vec(block.anchorB) : l.held!);
    const onSelf = anchorIn(self, id, anchorA);
    const { JointData } = rapier;
    let data;
    switch (block.kind) {
      case "revolute":
        data = JointData.revolute(onOther, onSelf);
        break;
      case "prismatic": {
        const selfRot = ctx.poses.get(id)?.rot ?? 0;
        const axis = rotate(slideAxis(id, block), selfRot - other.rotation());
        data = JointData.prismatic(onOther, onSelf, axis);
        break;
      }
      case "rope":
        data = JointData.rope(block.length ?? 0, onOther, onSelf);
        break;
      case "weld":
        data = JointData.fixed(onOther, 0, onSelf, other.rotation() - self.rotation());
        break;
      case "spring":
        data = JointData.spring(
          block.length ?? 0,
          block.stiffness ?? DEFAULT_SPRING_STIFFNESS,
          block.damping ?? DEFAULT_SPRING_DAMPING,
          onOther,
          onSelf,
        );
        break;
    }
    const joint = physics.world.createImpulseJoint(data, other, self, true);
    if (block.limits && (block.kind === "revolute" || block.kind === "prismatic"))
      (joint as UnitImpulseJoint).setLimits(block.limits[0], block.limits[1]);
    joint.setContactsEnabled(block.collide);
    l.joint = joint.handle;
    l.self = self.handle;
    l.other = other.handle;
  }

  /**
   * Makes `id`'s joint match its ends now: removed while either is missing
   * or disabled, kept while it links the bodies both ends have, made again
   * otherwise. `strict` refuses a live `to` with no body to hold.
   */
  function sync(id: string, l: Linked, strict = false): void {
    const physics = ctx.physics;
    if (!physics) return;
    l.target = targetOf(ctx, id, l.block.to);
    if (l.disabled || !ctx.enabled(id) || !ctx.enabled(l.target)) {
      if (l.joint !== null) drop(l);
      return;
    }
    const self = bodyOf(physics, id, l.self);
    const other = bodyOf(physics, l.target, l.other);
    if (strict && !other)
      throw new EngineError(
        "joint-ref-type",
        `${id}'s joint links to ${l.target}, which has no body to hold`,
        id,
      );
    if (!self || !other) {
      if (l.joint !== null) drop(l);
      return;
    }
    if (live(physics, l) && l.self === self.handle && l.other === other.handle) return;
    drop(l);
    make(id, l, self, other);
  }

  /** Pushes each motor's relative speed toward its target, with at most its `maxForce`. */
  function drive(physics: PhysicsWorld): void {
    const dt = ctx.time.tickMs / 1000;
    for (const [id, l] of linked) {
      const motor = l.block.motor;
      if (
        !motor ||
        l.joint === null ||
        (l.block.kind !== "revolute" && l.block.kind !== "prismatic")
      )
        continue;
      if (!live(physics, l)) continue;
      const self = bodyOf(physics, id, l.self);
      const other = bodyOf(physics, l.target, l.other);
      if (!self || !other) continue;
      const selfDynamic = ctx.bodies.kind(id) === "dynamic";
      const otherDynamic = ctx.bodies.kind(l.target) === "dynamic";
      if (l.block.kind === "revolute") {
        const give =
          inverse(selfDynamic, self.effectiveAngularInertia()) +
          inverse(otherDynamic, other.effectiveAngularInertia());
        if (give === 0) continue;
        const speed = self.angvel() - other.angvel();
        const torque = clamp((motor.velocity - speed) / dt / give, motor.maxForce);
        if (torque === 0) continue;
        if (selfDynamic) ctx.bodies.applyTorque(id, torque);
        if (otherDynamic) ctx.bodies.applyTorque(l.target, -torque);
        continue;
      }
      const give = inverse(selfDynamic, self.mass()) + inverse(otherDynamic, other.mass());
      if (give === 0) continue;
      const axis = rotate(slideAxis(id, l.block), ctx.poses.get(id)?.rot ?? 0);
      const vs = self.linvel();
      const vo = other.linvel();
      const speed = (vs.x - vo.x) * axis.x + (vs.y - vo.y) * axis.y;
      const force = clamp((motor.velocity - speed) / dt / give, motor.maxForce);
      if (force === 0) continue;
      if (selfDynamic) ctx.bodies.applyForce(id, { x: axis.x * force, y: axis.y * force });
      if (otherDynamic) ctx.bodies.applyForce(l.target, { x: -axis.x * force, y: -axis.y * force });
    }
  }

  const system: JointSystem = {
    attach(id, block) {
      physicsOf(ctx, "a joint", id);
      if (targetOf(ctx, id, block.to) === id)
        throw new EngineError("joint-self", `${id}'s joint links ${id} to itself`, id);
      if (block.kind === "prismatic") slideAxis(id, block);
      linked.set(id, {
        block,
        target: block.to,
        held: null,
        joint: null,
        self: null,
        other: null,
        disabled: false,
      });
    },
    update(id, block) {
      const l = linked.get(id);
      if (!l) return;
      if (block.kind === "prismatic") slideAxis(id, block);
      drop(l);
      l.block = block;
      l.held = null;
      sync(id, l);
    },
    detach(id) {
      const l = linked.get(id);
      if (!l) return;
      linked.delete(id);
      drop(l);
    },
    ready(ids) {
      for (const id of ids) {
        const l = linked.get(id);
        if (l) sync(id, l, true);
      }
    },
    beforePhysics() {
      if (linked.size === 0) return;
      const physics = ctx.physics;
      if (!physics) return;
      for (const [id, l] of linked) sync(id, l);
      drive(physics);
    },
    disable(id) {
      const l = linked.get(id);
      if (!l) return;
      l.disabled = true;
      drop(l);
    },
    enable(id) {
      const l = linked.get(id);
      if (!l) return;
      l.disabled = false;
      sync(id, l);
    },
    joined(id) {
      const l = linked.get(id);
      const physics = ctx.physics;
      if (!l || !physics || l.disabled || !live(physics, l)) return false;
      if (!ctx.enabled(id) || !ctx.enabled(l.target)) return false;
      return (
        l.self !== null &&
        l.other !== null &&
        physics.world.bodies.contains(l.self) &&
        physics.world.bodies.contains(l.other)
      );
    },
    clear() {
      for (const l of linked.values()) drop(l);
      linked.clear();
    },
    size: () => linked.size,
    /**
     * The joint's handle, so a restored world's joint is taken up again
     * rather than made twice, and the point it holds on `to` when the block
     * sets none. The motor keeps nothing between ticks.
     */
    save(id): JsonValue | undefined {
      const l = linked.get(id);
      if (!l) return undefined;
      const saved: { joint?: number; held?: [number, number] } = {};
      if (l.joint !== null && system.joined(id)) saved.joint = l.joint;
      if (l.held) saved.held = [l.held.x, l.held.y];
      return saved.joint === undefined && saved.held === undefined ? undefined : saved;
    },
    restore(id, state) {
      const l = linked.get(id);
      const physics = ctx.physics;
      if (!l || !physics) return;
      const record = typeof state === "object" && state !== null && !Array.isArray(state);
      const handle = record ? state.joint : undefined;
      const held = record ? state.held : undefined;
      if (Array.isArray(held) && held.length === 2 && finite(held[0]) && finite(held[1]))
        l.held = { x: held[0], y: held[1] };
      const saved = typeof handle === "number" ? physics.world.impulseJoints.get(handle) : null;
      l.target = targetOf(ctx, id, l.block.to);
      const self = bodyOf(physics, id, null);
      const other = bodyOf(physics, l.target, null);
      if (
        saved &&
        self &&
        other &&
        saved.body1().handle === other.handle &&
        saved.body2().handle === self.handle
      ) {
        if (l.joint !== saved.handle) drop(l);
        l.joint = saved.handle;
        l.self = self.handle;
        l.other = other.handle;
        return;
      }
      sync(id, l);
    },
  };
  return system as BehaviorSystem;
};

const vec = (p: readonly [number, number] | undefined): Vec =>
  p ? { x: p[0], y: p[1] } : { x: 0, y: 0 };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

const clamp = (value: number, limit: number): number =>
  value > limit ? limit : value < -limit ? -limit : value;

/** A prismatic joint's slide direction in this entity's frame, unit length; `[1, 0]` when it sets none. */
function slideAxis(id: string, block: JointBlock): Vec {
  const [ax, ay] = block.axis ?? [1, 0];
  const length = Math.sqrt(ax * ax + ay * ay);
  if (!(length > 0)) throw new EngineError("schema", `${id}'s joint axis has no length`, id);
  return { x: ax / length, y: ay / length };
}
