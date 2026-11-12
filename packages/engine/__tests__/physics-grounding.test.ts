// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { SIDE_VIEW_CONTROLLER } from "../game/defaults";
import { createPhysicsWorld } from "../physics";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A 0.6 m box whose bottom is `gap` m above a floor whose top is at y = 10.2. */
function hovering(gap: number) {
  const pw = createPhysicsWorld(rapier);
  const floor = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(10, 10.4));
  pw.addCollider(rapier.ColliderDesc.cuboid(20, 0.2), floor);
  const body = pw.addRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(10, 10.2 - gap - 0.3),
  );
  const collider = pw.addCollider(rapier.ColliderDesc.cuboid(0.3, 0.3), body);
  pw.step();
  const controller = pw.createCharacterController(SIDE_VIEW_CONTROLLER);
  return { pw, controller, collider };
}

describe("PhysicsWorld.isGrounded", () => {
  it("is false a few centimetres above the floor, where Rapier's prediction already says grounded", () => {
    const { pw, controller, collider } = hovering(0.03);
    controller.computeColliderMovement(collider, new rapier.Vector2(0, 0.005));
    expect(controller.computedGrounded()).toBe(true);
    expect(pw.isGrounded(controller)).toBe(false);
    pw.destroy();
  });

  it("is true once the move reaches the floor", () => {
    const { pw, controller, collider } = hovering(0.03);
    controller.computeColliderMovement(collider, new rapier.Vector2(0, 0.05));
    expect(pw.isGrounded(controller)).toBe(true);
    pw.destroy();
  });

  it("is false against a wall alone", () => {
    const pw = createPhysicsWorld(rapier);
    const wall = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(11, 5));
    pw.addCollider(rapier.ColliderDesc.cuboid(0.2, 5), wall);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(10.45, 5),
    );
    const collider = pw.addCollider(rapier.ColliderDesc.cuboid(0.3, 0.3), body);
    pw.step();
    const controller = pw.createCharacterController(SIDE_VIEW_CONTROLLER);
    controller.computeColliderMovement(collider, new rapier.Vector2(0.1, 0));
    expect(controller.numComputedCollisions()).toBeGreaterThan(0);
    expect(pw.isGrounded(controller)).toBe(false);
    pw.destroy();
  });
});
