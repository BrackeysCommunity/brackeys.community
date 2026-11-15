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
 * A kinematic anchor at `at` (m) and a spring joint to `body` at its local
 * point under `at`. The body is found the way the joint behavior finds one.
 * The pull is a spring of rest length 0 toward the pointer, `stiffness`
 * (default 200 N/m), with `damping` (default 20 N·s/m) against the held
 * point's velocity; `maxForce` (N, default unbounded) caps the two together.
 * Rapier's joints have no force cap, so the pull is shaped by where the
 * anchor goes: each `update` puts it where the spring alone pulls with that
 * force, never more than `maxForce / stiffness` m from the held point. Call
 * `update` every tick while dragging. The anchor has no collider, so
 * queries and contacts never see it. `release` is idempotent, and a drag
 * whose body is gone or whose world was replaced releases on its next
 * `update`. Throws `PhysicsRequiredError` outside a Rapier scene.
 */
export function createDragJoint(
  ctx: EngineContext,
  body: string,
  at: Vec2,
  opts: DragJointOptions = {},
): DragJoint {
  const { rapier, physics } = physicsOf(ctx, "createDragJoint", body);
  const target = bodyOf(ctx, physics, body);
  if (!target) {
    throw new EngineError("body-missing", `can't drag "${body}": it has no body`, body);
  }
  const stiffness = opts.stiffness ?? DEFAULT_DRAG_STIFFNESS;
  const damping = opts.damping ?? DEFAULT_DRAG_DAMPING;
  const maxStretch =
    opts.maxForce === undefined || stiffness <= 0 ? Infinity : opts.maxForce / stiffness;

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
    if (bodyOf(ctx, p, body, targetHandle)?.handle !== targetHandle) return null;
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
      const lag = stiffness > 0 ? damping / stiffness : 0;
      let dx = to.x - hx - lag * vx;
      let dy = to.y - hy - lag * vy;
      const len = Math.hypot(dx, dy);
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
