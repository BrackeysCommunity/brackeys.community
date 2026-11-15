import type { ImpulseJoint, RigidBody } from "@dimforge/rapier2d";

import { physicsOf } from "../game/physics-of";
import { EngineError, type EngineContext } from "../game/types";
import { rotate } from "../math";
import type { PhysicsWorld } from "../physics";
import type { Vec2 } from "../types";
import { bodyOf } from "./body-of";

/** A pointer drag: a kinematic anchor pulling a body by a spring. */
export interface DragJoint {
  /** Moves the anchor; call each tick with the pointer's world position, m. */
  update(to: Vec2): void;
  release(): void;
  /** The entity being dragged. */
  readonly body: string;
}

/** Spring settings for a drag: stiffness N/m, damping N·s/m, maxForce N. */
export type DragJointOptions = { stiffness?: number; damping?: number; maxForce?: number };

const DEFAULT_DRAG_STIFFNESS = 200;
const DEFAULT_DRAG_DAMPING = 20;

/**
 * Drags `body` toward a pointer through a kinematic anchor on a zero-length
 * spring, capped at `maxForce`. Call `update` each tick; `release` is
 * idempotent and happens by itself once the body or world is gone, or once
 * `body` no longer owns it. Throws `PhysicsRequiredError` outside a Rapier
 * scene and `schema` for a bad stiffness, damping or maxForce.
 */
export function createDragJoint(
  ctx: EngineContext,
  body: string,
  at: Vec2,
  opts: DragJointOptions = {},
): DragJoint {
  const stiffness = opts.stiffness ?? DEFAULT_DRAG_STIFFNESS;
  const damping = opts.damping ?? DEFAULT_DRAG_DAMPING;
  const bad = !(Number.isFinite(stiffness) && stiffness > 0)
    ? `stiffness must be above 0 N/m, got ${stiffness}`
    : !(Number.isFinite(damping) && damping >= 0)
      ? `damping must be 0 N·s/m or more, got ${damping}`
      : opts.maxForce !== undefined && !(opts.maxForce > 0)
        ? `maxForce must be above 0 N, got ${opts.maxForce}`
        : null;
  if (bad) throw new EngineError("schema", `can't drag "${body}": ${bad}`, body);
  const { rapier, physics } = physicsOf(ctx, "createDragJoint", body);
  const target = bodyOf(ctx, physics, body);
  if (!target) {
    throw new EngineError("body-missing", `can't drag "${body}": it has no body`, body);
  }
  // Rapier's joints have no force cap, so the anchor never strays further than the cap allows.
  const maxStretch = opts.maxForce === undefined ? Infinity : opts.maxForce / stiffness;

  const t = target.translation();
  const local = rotate({ x: at.x - t.x, y: at.y - t.y }, -target.rotation());
  const anchor = physics.addRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y),
  );
  const joint = physics.world.createImpulseJoint(
    rapier.JointData.spring(0, stiffness, 0, { x: 0, y: 0 }, local),
    anchor,
    target,
    true,
  );

  const world = physics;
  const anchorHandle = anchor.handle;
  const targetHandle = target.handle;
  const jointHandle = joint.handle;
  let released = false;

  type Live = { anchor: RigidBody; target: RigidBody; joint: ImpulseJoint };
  function live(p: PhysicsWorld | null): Live | null {
    if (p !== world) return null;
    const a = p.world.bodies.get(anchorHandle);
    const b = p.world.bodies.get(targetHandle);
    const j = p.world.impulseJoints.get(jointHandle);
    if (!a || !b?.isEnabled() || !j) return null;
    if (bodyOf(ctx, p, body)?.handle !== targetHandle) return null;
    return { anchor: a, target: b, joint: j };
  }

  function release(): void {
    if (released) return;
    released = true;
    const p = ctx.physics;
    if (p !== world) return;
    const j = p.world.impulseJoints.get(jointHandle);
    if (j) p.world.removeImpulseJoint(j, true);
    const a = p.world.bodies.get(anchorHandle);
    if (a) p.removeRigidBody(a);
  }

  return {
    body,
    update(to) {
      if (released) return;
      const l = live(ctx.physics);
      if (!l) return release();
      // Measured where the held point will be after this step, so the cap
      // limits the pull rather than the body's speed.
      const bt = l.target.translation();
      const v = l.target.linvel();
      const w = l.target.angvel();
      const dt = ctx.time.tickMs / 1000;
      const off = rotate(local, l.target.rotation());
      const vx = v.x - w * off.y;
      const vy = v.y + w * off.x;
      const hx = bt.x + off.x + vx * dt;
      const hy = bt.y + off.y + vy * dt;
      const lag = damping / stiffness;
      let dx = to.x - hx - lag * vx;
      let dy = to.y - hy - lag * vy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxStretch) {
        dx *= maxStretch / len;
        dy *= maxStretch / len;
      }
      l.anchor.setNextKinematicTranslation({ x: hx + dx, y: hy + dy });
      l.target.wakeUp();
    },
    release,
  };
}
