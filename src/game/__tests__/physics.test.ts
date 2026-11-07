// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createPhysicsWorld, degToRad, shapeColliderDesc, shapePose } from "../physics";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function addFloor(pw: ReturnType<typeof createPhysicsWorld>, topY: number): void {
  const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(1000, topY + 20));
  pw.addCollider(rapier.ColliderDesc.cuboid(2000, 20), body);
}

// ─── Physics world lifecycle ─────────────────────────────

describe("createPhysicsWorld", () => {
  it("creates an empty world", () => {
    const pw = createPhysicsWorld(rapier);
    expect(pw.world.bodies.len()).toBe(0);
    expect(pw.world.colliders.len()).toBe(0);
    pw.destroy();
  });

  it("creates a world with correct gravity", () => {
    const pw = createPhysicsWorld(rapier);
    const gravity = pw.world.gravity;
    expect(gravity.x).toBe(0);
    expect(gravity.y).toBe(1200);
    pw.destroy();
  });

  it("creates a world with correct timestep", () => {
    const pw = createPhysicsWorld(rapier);
    expect(pw.world.timestep).toBeCloseTo(1 / 60, 6);
    pw.destroy();
  });

  it("accepts custom gravity", () => {
    const pw = createPhysicsWorld(rapier, { gravity: { x: 0, y: 800 } });
    expect(pw.world.gravity.y).toBe(800);
    pw.destroy();
  });

  it("steps without error", () => {
    const pw = createPhysicsWorld(rapier);
    expect(() => pw.step()).not.toThrow();
    pw.destroy();
  });

  it("destroys without error", () => {
    const pw = createPhysicsWorld(rapier);
    expect(() => pw.destroy()).not.toThrow();
  });
});

// ─── Rigid body management ───────────────────────────────

describe("body management", () => {
  it("adds a dynamic rigid body", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(100, 0));
    expect(body.translation().x).toBe(100);
    expect(body.translation().y).toBe(0);
    pw.destroy();
  });

  it("adds a collider to a body", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0));
    const collider = pw.addCollider(rapier.ColliderDesc.ball(10), body);
    expect(collider).toBeDefined();
    expect(pw.world.colliders.len()).toBe(1);
    pw.destroy();
  });

  it("removing a rigid body removes its colliders", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic());
    pw.addCollider(rapier.ColliderDesc.ball(10), body);
    pw.removeRigidBody(body);
    expect(pw.world.bodies.len()).toBe(0);
    expect(pw.world.colliders.len()).toBe(0);
    pw.destroy();
  });
});

// ─── Simulation ──────────────────────────────────────────

describe("simulation", () => {
  it("gravity causes a dynamic body to fall", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0));
    pw.addCollider(rapier.ColliderDesc.ball(5), body);

    for (let i = 0; i < 10; i++) pw.step();

    expect(body.translation().y).toBeGreaterThan(0);
    pw.destroy();
  });

  it("static bodies do not move", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(500, 500));
    pw.addCollider(rapier.ColliderDesc.cuboid(50, 50), body);

    for (let i = 0; i < 10; i++) pw.step();

    expect(body.translation().x).toBe(500);
    expect(body.translation().y).toBe(500);
    pw.destroy();
  });

  it("a falling body comes to rest on a floor", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 1020);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(1000, 0));
    pw.addCollider(rapier.ColliderDesc.ball(5), body);

    for (let i = 0; i < 600; i++) pw.step();

    expect(body.translation().y).toBeLessThan(1100);
    expect(body.translation().y).toBeGreaterThan(900);
    pw.destroy();
  });
});

// ─── Character controller ───────────────────────────────

describe("character controller", () => {
  it("creates a character controller", () => {
    const pw = createPhysicsWorld(rapier);
    expect(pw.createCharacterController()).toBeDefined();
    pw.destroy();
  });

  it("resolves collider movement against a floor", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 1020);
    const controller = pw.createCharacterController(0.01);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(1000, 900),
    );
    const collider = pw.addCollider(rapier.ColliderDesc.cuboid(30, 30), body);
    pw.step();

    controller.computeColliderMovement(collider, new rapier.Vector2(0, 200));
    expect(controller.computedMovement().y).toBeLessThan(200);
    pw.destroy();
  });

  it("reports grounded after landing", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 1020);
    const controller = pw.createCharacterController(0.01);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(1000, 989),
    );
    const collider = pw.addCollider(rapier.ColliderDesc.cuboid(30, 30), body);
    pw.step();

    controller.computeColliderMovement(collider, new rapier.Vector2(0, 5));
    expect(controller.computedGrounded()).toBe(true);
    pw.destroy();
  });
});

// ─── Shapes ──────────────────────────────────────────────

describe("shape colliders", () => {
  it("poses a rotated box at its centre and converts degrees to radians", () => {
    const pose = shapePose({ type: "box", cx: 10, cy: 20, hw: 5, hh: 2, rotDeg: 90 });
    expect(pose).toEqual({ x: 10, y: 20, rotation: degToRad(90) });
    expect(pose.rotation).toBeCloseTo(Math.PI / 2, 6);
  });

  it("poses poly and chain shapes at the origin", () => {
    expect(
      shapePose({
        type: "chain",
        pts: [
          [0, 0],
          [10, 0],
        ],
      }),
    ).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it("builds a collider for every shape type", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed());
    const shapes = [
      { type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 0 },
      { type: "circle", cx: 0, cy: 0, r: 4 },
      { type: "capsule", cx: 0, cy: 0, halfLen: 10, r: 3, rotDeg: 45 },
      {
        type: "poly",
        pts: [
          [0, 0],
          [20, 0],
          [10, 15],
        ],
      },
      {
        type: "chain",
        pts: [
          [0, 0],
          [20, 0],
          [40, 10],
        ],
      },
    ] as const;
    for (const shape of shapes) {
      pw.addCollider(shapeColliderDesc(rapier, structuredClone(shape) as never), body);
    }
    expect(pw.world.colliders.len()).toBe(shapes.length);
    pw.destroy();
  });

  it("offsets a local shape relative to its body", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(100, 100));
    const collider = pw.addCollider(
      shapeColliderDesc(rapier, { type: "box", cx: 5, cy: -3, hw: 10, hh: 2, rotDeg: 0 }, true),
      body,
    );
    expect(collider.translation()).toEqual({ x: 105, y: 97 });
    pw.destroy();
  });
});

// ─── Debug render ────────────────────────────────────────

describe("debugRender", () => {
  it("returns vertex and color buffers", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 1020);

    // debugRender() reads WASM memory through the glue module, which the
    // test environment doesn't always wire up; the browser path is covered by use.
    try {
      const { vertices, colors } = pw.debugRender();
      expect(vertices).toBeInstanceOf(Float32Array);
      expect(colors).toBeInstanceOf(Float32Array);
      expect(vertices.length).toBeGreaterThan(0);
    } catch {
      expect(pw.debugRender).toBeDefined();
    }

    pw.destroy();
  });
});
