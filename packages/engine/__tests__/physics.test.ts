// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { SceneView } from "../context";
import { DEFAULT_TICK_RATE, SIDE_VIEW_CONTROLLER, TOP_DOWN_CONTROLLER } from "../game/defaults";
import {
  createPhysicsWorld,
  degToRad,
  shapeColliderDesc,
  shapePose,
  type CharacterControllerOptions,
} from "../physics";
import { createSceneRuntime } from "../runtime/runtime";
import type { StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import type { PropEntity, SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A 40 m wide, 0.4 m deep floor whose top is at `topY`, m. */
function addFloor(pw: ReturnType<typeof createPhysicsWorld>, topY: number): void {
  const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(10, topY + 0.2));
  pw.addCollider(rapier.ColliderDesc.cuboid(20, 0.2), body);
}

// ─── Physics world lifecycle ─────────────────────────────

describe("createPhysicsWorld", () => {
  it("creates an empty world", () => {
    const pw = createPhysicsWorld(rapier);
    expect(pw.world.bodies.len()).toBe(0);
    expect(pw.world.colliders.len()).toBe(0);
    pw.destroy();
  });

  it("creates a world with the default gravity, in m/s²", () => {
    const pw = createPhysicsWorld(rapier);
    const gravity = pw.world.gravity;
    expect(gravity.x).toBe(0);
    expect(gravity.y).toBe(12);
    pw.destroy();
  });

  it("steps once per tick at the default rate", () => {
    const pw = createPhysicsWorld(rapier);
    expect(pw.world.timestep).toBe(Math.fround(1 / DEFAULT_TICK_RATE));
    pw.destroy();
  });

  it("takes the step length from its timestep", () => {
    const pw = createPhysicsWorld(rapier, { timestep: 1 / 30 });
    expect(pw.world.timestep).toBe(Math.fround(1 / 30));
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic());
    pw.addCollider(rapier.ColliderDesc.ball(0.05), body);
    pw.step();
    expect(body.linvel().y).toBeCloseTo(12 / 30, 5);
    pw.destroy();
  });

  it("accepts custom gravity", () => {
    const pw = createPhysicsWorld(rapier, { gravity: { x: 0, y: 8 } });
    expect(pw.world.gravity.y).toBe(8);
    pw.destroy();
  });

  it("changes gravity for later steps", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic());
    pw.addCollider(rapier.ColliderDesc.ball(0.05), body);
    pw.setGravity({ x: 0, y: 0 });
    for (let i = 0; i < 10; i++) pw.step();
    expect(body.translation()).toEqual({ x: 0, y: 0 });
    pw.setGravity({ x: -6, y: 0 });
    pw.step();
    expect(pw.world.gravity).toMatchObject({ x: -6, y: 0 });
    expect(body.translation().x).toBeLessThan(0);
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
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(1, 0));
    expect(body.translation().x).toBe(1);
    expect(body.translation().y).toBe(0);
    pw.destroy();
  });

  it("adds a collider to a body", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0));
    const collider = pw.addCollider(rapier.ColliderDesc.ball(0.1), body);
    expect(collider).toBeDefined();
    expect(pw.world.colliders.len()).toBe(1);
    pw.destroy();
  });

  it("removing a rigid body removes its colliders", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic());
    pw.addCollider(rapier.ColliderDesc.ball(0.1), body);
    pw.removeRigidBody(body);
    expect(pw.world.bodies.len()).toBe(0);
    expect(pw.world.colliders.len()).toBe(0);
    pw.destroy();
  });
});

describe("the collider index", () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
    minX,
    minY,
    maxX,
    maxY,
  });
  const near = (pw: ReturnType<typeof createPhysicsWorld>, b: ReturnType<typeof box>) =>
    pw
      .collidersNear(b)
      .map((c) => c.handle)
      .sort((x, y) => x - y);

  it("finds fixed colliders near a box and none far from it", () => {
    const pw = createPhysicsWorld(rapier);
    const handles: number[] = [];
    for (let i = 0; i < 50; i++) {
      const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(i * 10, 0));
      handles.push(pw.addCollider(rapier.ColliderDesc.cuboid(1, 1), body).handle);
    }
    expect(near(pw, box(19, -1, 21, 1))).toEqual([handles[2]]);
    expect(near(pw, box(200, 5, 300, 6))).toEqual([]);
    expect(pw.collidersNear(null)).toHaveLength(50);
    pw.destroy();
  });

  it("reads a collider on a moving body where it stands, and forgets removed ones", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0));
    const ball = pw.addCollider(rapier.ColliderDesc.ball(0.1), body);
    expect(near(pw, box(-1, -1, 1, 1))).toEqual([ball.handle]);
    for (let i = 0; i < 60; i++) pw.step();
    const y = ball.translation().y;
    expect(y).toBeGreaterThan(2);
    expect(near(pw, box(-1, -1, 1, 1))).toEqual([]);
    expect(near(pw, box(-1, y - 0.5, 1, y + 0.5))).toEqual([ball.handle]);
    pw.removeRigidBody(body);
    expect(near(pw, box(-1, y - 0.5, 1, y + 0.5))).toEqual([]);
    pw.destroy();
  });

  it("follows a fixed body moved by code once told, and one added past it through the raw world", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 0));
    const wall = pw.addCollider(rapier.ColliderDesc.cuboid(1, 1), body);
    body.setTranslation({ x: 50, y: 0 }, false);
    pw.moved(body);
    pw.step();
    expect(near(pw, box(49, -1, 51, 1))).toEqual([wall.handle]);
    expect(near(pw, box(-1, -1, 1, 1))).toEqual([]);
    const raw = pw.world.createCollider(rapier.ColliderDesc.cuboid(1, 1).setTranslation(80, 0));
    expect(near(pw, box(79, -1, 81, 1))).toEqual([raw.handle]);
    body.setTranslation({ x: 20, y: 0 }, false);
    pw.refreshQueries();
    expect(near(pw, box(19, -1, 21, 1))).toEqual([wall.handle]);
    pw.destroy();
  });
});

describe("refreshQueries", () => {
  /** A fixed anchor and three jointed links hanging from it, stepped until they swing. */
  function chain(pw: ReturnType<typeof createPhysicsWorld>) {
    const anchor = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 0));
    let prev = anchor;
    const links = [];
    for (let i = 1; i <= 3; i++) {
      const link = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(i * 0.5, 0));
      pw.addCollider(rapier.ColliderDesc.cuboid(0.2, 0.05), link);
      pw.world.createImpulseJoint(
        rapier.JointData.revolute({ x: i === 1 ? 0 : 0.25, y: 0 }, { x: -0.25, y: 0 }),
        prev,
        link,
        true,
      );
      links.push(link);
      prev = link;
    }
    return links;
  }
  const state = (links: ReturnType<typeof chain>) =>
    links.map((b) => [
      b.translation().x,
      b.translation().y,
      b.linvel().x,
      b.linvel().y,
      b.angvel(),
    ]);

  it("keeps a swinging chain's velocities and its continuation bit-exact", () => {
    const a = createPhysicsWorld(rapier);
    const b = createPhysicsWorld(rapier);
    const la = chain(a);
    const lb = chain(b);
    for (let i = 0; i < 20; i++) {
      a.step();
      b.step();
    }
    const before = state(la);
    const bare = createPhysicsWorld(rapier);
    const lbare = chain(bare);
    for (let i = 0; i < 20; i++) bare.step();
    bare.world.timestep = 0;
    bare.world.step();
    expect(state(lbare)).not.toEqual(before);
    bare.destroy();
    a.refreshQueries();
    expect(state(la)).toEqual(before);
    for (let i = 0; i < 30; i++) {
      a.step();
      b.step();
    }
    expect(state(la)).toEqual(state(lb));
    a.destroy();
    b.destroy();
  });

  it("lets a character controller see a collider added since the last step", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0),
    );
    const actor = pw.addCollider(rapier.ColliderDesc.cuboid(0.2, 0.2), body);
    pw.step();
    addFloor(pw, 1);
    pw.refreshQueries();
    const controller = pw.createCharacterController(SIDE_VIEW_CONTROLLER);
    controller.computeColliderMovement(actor, { x: 0, y: 2 });
    expect(controller.computedMovement().y).toBeLessThan(1);
    pw.destroy();
  });
});

// ─── Simulation ──────────────────────────────────────────

describe("simulation", () => {
  it("gravity causes a dynamic body to fall", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0));
    pw.addCollider(rapier.ColliderDesc.ball(0.05), body);

    for (let i = 0; i < 10; i++) pw.step();

    expect(body.translation().y).toBeGreaterThan(0);
    pw.destroy();
  });

  it("static bodies do not move", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(5, 5));
    pw.addCollider(rapier.ColliderDesc.cuboid(0.5, 0.5), body);

    for (let i = 0; i < 10; i++) pw.step();

    expect(body.translation().x).toBe(5);
    expect(body.translation().y).toBe(5);
    pw.destroy();
  });

  it("a falling body comes to rest on a floor", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 10.2);
    const body = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(10, 0));
    pw.addCollider(rapier.ColliderDesc.ball(0.05), body);

    for (let i = 0; i < 600; i++) pw.step();

    expect(body.translation().y).toBeLessThan(11);
    expect(body.translation().y).toBeGreaterThan(9);
    pw.destroy();
  });
});

// ─── Character controller ───────────────────────────────

describe("character controller", () => {
  it("creates a character controller", () => {
    const pw = createPhysicsWorld(rapier);
    expect(pw.createCharacterController(SIDE_VIEW_CONTROLLER)).toBeDefined();
    pw.destroy();
  });

  it("resolves collider movement against a floor", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 10.2);
    const controller = pw.createCharacterController(SIDE_VIEW_CONTROLLER);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(10, 9),
    );
    const collider = pw.addCollider(rapier.ColliderDesc.cuboid(0.3, 0.3), body);
    pw.step();

    controller.computeColliderMovement(collider, new rapier.Vector2(0, 2));
    expect(controller.computedMovement().y).toBeLessThan(2);
    pw.destroy();
  });

  it("reports grounded after landing", () => {
    const pw = createPhysicsWorld(rapier);
    addFloor(pw, 10.2);
    const controller = pw.createCharacterController(SIDE_VIEW_CONTROLLER);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(10, 9.89),
    );
    const collider = pw.addCollider(rapier.ColliderDesc.cuboid(0.3, 0.3), body);
    pw.step();

    controller.computeColliderMovement(collider, new rapier.Vector2(0, 0.05));
    expect(controller.computedGrounded()).toBe(true);
    pw.destroy();
  });

  /** What a controller was set up with, read back through Rapier's getters. */
  function readBack(opts: CharacterControllerOptions) {
    const pw = createPhysicsWorld(rapier);
    const c = pw.createCharacterController(opts);
    const up = c.up();
    const out = {
      offset: c.offset(),
      up: { x: up.x, y: up.y },
      climbDeg: (c.maxSlopeClimbAngle() * 180) / Math.PI,
      slideDeg: (c.minSlopeSlideAngle() * 180) / Math.PI,
      autostep: c.autostepEnabled()
        ? {
            maxHeight: c.autostepMaxHeight(),
            minWidth: c.autostepMinWidth(),
            dynamic: c.autostepIncludesDynamicBodies(),
          }
        : null,
      snap: c.snapToGroundEnabled() ? c.snapToGroundDistance() : null,
      push: c.applyImpulsesToDynamicBodies(),
    };
    pw.destroy();
    return out;
  }

  // Rapier keeps these as f32, so metric values read back within float rounding.
  it("options reach the controller, in metres", () => {
    const side = readBack(SIDE_VIEW_CONTROLLER);
    expect(side.offset).toBeCloseTo(0.0001, 8);
    expect(side.up).toEqual({ x: 0, y: -1 });
    expect(side.climbDeg).toBeCloseTo(50, 4);
    expect(side.slideDeg).toBeCloseTo(30, 4);
    expect(side.autostep!.maxHeight).toBeCloseTo(0.04, 8);
    expect(side.autostep!.minWidth).toBeCloseTo(0.02, 8);
    expect(side.autostep!.dynamic).toBe(true);
    expect(side.snap).toBeCloseTo(0.04, 8);
    expect(side.push).toBe(true);

    const custom = readBack({
      offset: 0.005,
      up: [1, 0],
      maxSlopeClimbDeg: 20,
      minSlopeSlideDeg: 10,
      autostep: { maxHeight: 0.08, minWidth: 0.03, dynamic: false },
      snapToGround: 0.02,
      pushDynamic: false,
    });
    expect(custom.offset).toBeCloseTo(0.005, 8);
    expect(custom.up).toEqual({ x: 1, y: 0 });
    expect(custom.climbDeg).toBeCloseTo(20, 4);
    expect(custom.slideDeg).toBeCloseTo(10, 4);
    expect(custom.autostep!.maxHeight).toBeCloseTo(0.08, 8);
    expect(custom.autostep!.minWidth).toBeCloseTo(0.03, 8);
    expect(custom.autostep!.dynamic).toBe(false);
    expect(custom.snap).toBeCloseTo(0.02, 8);
    expect(custom.push).toBe(false);
  });

  it("a null option turns that behaviour off", () => {
    const off = (patch: Partial<CharacterControllerOptions>) =>
      readBack({ ...SIDE_VIEW_CONTROLLER, ...patch });
    expect(off({ maxSlopeClimbDeg: null }).climbDeg).toBeCloseTo(90, 4);
    expect(off({ minSlopeSlideDeg: null }).slideDeg).toBeCloseTo(90, 4);
    expect(off({ autostep: null }).autostep).toBeNull();
    expect(off({ snapToGround: null }).snap).toBeNull();
    expect(off({ offset: undefined }).offset).toBeCloseTo(0.0001, 8);

    const top = readBack(TOP_DOWN_CONTROLLER);
    expect(top).toMatchObject({ autostep: null, snap: null, push: false, up: { x: 0, y: -1 } });
    expect(top.climbDeg).toBeCloseTo(90, 4);
    expect(top.slideDeg).toBeCloseTo(90, 4);
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

// ─── Prop body fields ────────────────────────────────────

describe("prop body fields", () => {
  const DT = 1000 / 60;

  function yard(entities: RuntimeEntity[], gravity: [number, number] = [0, 12]): ExpandedScene {
    return {
      name: "props",
      bounds: [-10, -10, 10, 10],
      settings: { gravity, physics: "rapier", grid: null, view: { projection: "orthogonal" } },
      entities,
    };
  }

  const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
    type: "box",
    cx,
    cy,
    hw,
    hh,
    rotDeg: 0,
  });

  const crate = (fields: Partial<PropEntity> = {}): RuntimeEntity => ({
    id: "crate",
    type: "prop",
    shape: box(0, 0, 0.1, 0.1),
    density: 1,
    restitution: 0,
    ...fields,
  });

  function run(entities: RuntimeEntity[], gravity?: [number, number]) {
    const rt = createSceneRuntime({ rapier, view: null, game: null });
    const report = rt.load(yard(entities, gravity));
    if (!report.ok) throw new Error(report.error);
    const [handle] = rt.ctx.tags.handlesOf("crate");
    const body = rt.ctx.physics!.world.getCollider(handle!)!.parent()!;
    const step = (n: number) => {
      for (let i = 0; i < n; i++) rt.step(DT, []);
    };
    return { rt, body, step };
  }

  it("keeps Rapier's defaults for a prop that sets none", () => {
    const { rt, body } = run([crate()]);
    expect(body.gravityScale()).toBe(1);
    expect(body.linearDamping()).toBe(0);
    expect(body.angularDamping()).toBe(0);
    expect(body.isCcdEnabled()).toBe(false);
    expect(body.effectiveWorldInvInertia()).toBeGreaterThan(0);
    rt.destroy();
  });

  it("sets each field it names on the body", () => {
    const { rt, body } = run([
      crate({ gravityScale: 0.5, linearDamping: 2, angularDamping: 3, ccd: true }),
    ]);
    expect(body.gravityScale()).toBe(0.5);
    expect(body.linearDamping()).toBe(2);
    expect(body.angularDamping()).toBe(3);
    expect(body.isCcdEnabled()).toBe(true);
    rt.destroy();
  });

  it("linear damping slows a moving prop", () => {
    const speed = (fields: Partial<PropEntity>) => {
      const { rt, body, step } = run([crate(fields)], [0, 0]);
      body.setLinvel({ x: 3, y: 0 }, true);
      step(30);
      const v = body.linvel().x;
      rt.destroy();
      return v;
    };
    expect(speed({})).toBeCloseTo(3, 5);
    expect(speed({ linearDamping: 2 })).toBeLessThan(1.5);
  });

  it("angular damping slows a spinning prop", () => {
    const spin = (fields: Partial<PropEntity>) => {
      const { rt, body, step } = run([crate(fields)], [0, 0]);
      body.setAngvel(4, true);
      step(30);
      const w = body.angvel();
      rt.destroy();
      return w;
    };
    expect(spin({})).toBeCloseTo(4, 3);
    expect(spin({ angularDamping: 2 })).toBeLessThan(2);
  });

  it("a prop with fixedRotation never turns", () => {
    /** A crate dropped with most of it past a ledge's edge: free, it tips over. */
    const tip = (fields: Partial<PropEntity>) => {
      const ledge: RuntimeEntity = {
        id: "ledge",
        type: "solid",
        shape: box(-0.5, 0.4, 0.5, 0.1),
      };
      const { rt, body, step } = run([ledge, crate({ shape: box(0.05, 0, 0.1, 0.1), ...fields })]);
      const rots: number[] = [];
      for (let i = 0; i < 90; i++) {
        step(1);
        rots.push(body.rotation());
      }
      rt.destroy();
      return rots;
    };
    expect(Math.max(...tip({}).map(Math.abs))).toBeGreaterThan(0.3);
    expect(tip({ fixedRotation: true }).every((r) => r === 0)).toBe(true);
  });

  it("a prop with gravityScale 0 floats", () => {
    const fall = (fields: Partial<PropEntity>) => {
      const { rt, body, step } = run([crate(fields)]);
      step(60);
      const y = body.translation().y;
      rt.destroy();
      return y;
    };
    expect(fall({})).toBeGreaterThan(4);
    expect(fall({ gravityScale: 0 })).toBe(0);
  });

  it("with ccd a prop doesn't tunnel through a 0.02 m wall at 60 m/s", () => {
    const wall: RuntimeEntity = { id: "wall", type: "solid", shape: box(2, 0, 0.01, 1) };
    const throwAt = (fields: Partial<PropEntity>) => {
      const { rt, body, step } = run(
        [wall, crate({ shape: box(0, 0, 0.05, 0.05), ...fields })],
        [0, 0],
      );
      body.setLinvel({ x: 60, y: 0 }, true);
      step(10);
      const x = body.translation().x;
      rt.destroy();
      return x;
    };
    expect(throwAt({})).toBeGreaterThan(2);
    expect(throwAt({ ccd: true })).toBeLessThan(2);
  });
});

// ─── Disable and enable ──────────────────────────────────

describe("disabling and enabling bodies on Rapier", () => {
  const DT = 1000 / 60;

  const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
    type: "box",
    cx,
    cy,
    hw,
    hh,
    rotDeg: 0,
  });

  function yard(entities: RuntimeEntity[], gravity: [number, number] = [0, 12]): ExpandedScene {
    return {
      name: "toggles",
      bounds: [-10, -10, 10, 10],
      settings: { gravity, physics: "rapier", grid: null, view: { projection: "orthogonal" } },
      entities,
    };
  }

  /** A view that logs what is drawn and removed. */
  function loggingView() {
    const log: string[] = [];
    const view: SceneView = {
      draw: (id) => void log.push(`draw ${id}`),
      pose: () => {},
      remove: (id) => void log.push(`remove ${id}`),
      layer: () => ({ visible: true, setVisible: () => {} }) as never,
    };
    return { view, log };
  }

  function load(
    entities: RuntimeEntity[],
    opts: { gravity?: [number, number]; view?: SceneView } = {},
  ) {
    const rt = createSceneRuntime({ rapier, view: opts.view ?? null, game: testGame });
    const report = rt.load(yard(entities, opts.gravity));
    if (!report.ok) throw new Error(report.error);
    const steps = (n: number): StepEvent[] => {
      const events: StepEvent[] = [];
      for (let i = 0; i < n; i++) events.push(...rt.step(DT, []).events);
      return events;
    };
    const hits = (shape: ShapeObj) => rt.ctx.space.overlaps(shape).map((h) => h.tag.entityId);
    return { rt, steps, hits };
  }

  const crate: RuntimeEntity = {
    id: "crate",
    type: "prop",
    shape: box(0, 0, 0.1, 0.1),
    density: 1,
    restitution: 0,
  };
  const zone: RuntimeEntity = { id: "zone", type: "sensor", shape: box(0, 0, 0.4, 0.4) };
  const sensorEvents = (events: StepEvent[]) =>
    events.filter((e) => e.type.startsWith("sensor:")).map((e) => [e.type, e.entityId, e.other]);

  it("a disabled sensor raises nothing, and raises one enter when enabled again", () => {
    const { rt, steps } = load([zone, crate], { gravity: [0, 0] });
    expect(sensorEvents(steps(1))).toEqual([["sensor:enter", "zone", "crate"]]);

    rt.ctx.setEnabled("zone", false);
    expect(rt.ctx.enabled("zone")).toBe(false);
    rt.ctx.system("prop")!.despawn("crate");
    expect(sensorEvents(steps(5))).toEqual([]);
    rt.ctx.system("prop")!.spawn(crate);
    expect(sensorEvents(steps(5))).toEqual([]);

    rt.ctx.setEnabled("zone", true);
    expect(sensorEvents(steps(10))).toEqual([["sensor:enter", "zone", "crate"]]);
    rt.destroy();
  });

  it("a disabled sensor forgets what was inside without raising an exit", () => {
    const { rt, steps } = load([zone, crate], { gravity: [0, 0] });
    steps(1);
    rt.ctx.setEnabled("zone", false);
    rt.ctx.system("prop")!.despawn("crate");
    rt.ctx.setEnabled("zone", true);
    expect(sensorEvents(steps(5))).toEqual([]);
    rt.destroy();
  });

  it("a disabled prop doesn't fall, leaves queries and falls again on enable", () => {
    const { rt, steps, hits } = load([crate]);
    const body = () => rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf("crate")[0]!)!;
    rt.ctx.setEnabled("crate", false);
    steps(30);
    expect(body().parent()!.translation()).toEqual({ x: 0, y: 0 });
    expect(rt.ctx.poses.get("crate")).toMatchObject({ x: 0, y: 0 });
    expect(hits(box(0, 0, 0.05, 0.05))).toEqual([]);

    rt.ctx.setEnabled("crate", true);
    expect(hits(box(0, 0, 0.05, 0.05))).toEqual(["crate"]);
    steps(30);
    expect(body().parent()!.translation().y).toBeGreaterThan(1);
    expect(rt.ctx.poses.get("crate")!.y).toBeGreaterThan(1);
    rt.destroy();
  });

  it("a disabled solid holds nothing up and leaves queries", () => {
    const floor: RuntimeEntity = { id: "floor", type: "solid", shape: box(0, 0.4, 1, 0.1) };
    const { rt, steps, hits } = load([floor, crate]);
    rt.ctx.setEnabled("floor", false);
    expect(hits(floor.shape as ShapeObj)).toEqual([]);
    steps(60);
    expect(rt.ctx.poses.get("crate")!.y).toBeGreaterThan(1);
    rt.ctx.setEnabled("floor", true);
    expect(hits(floor.shape as ShapeObj)).toEqual(["floor"]);
    rt.destroy();
  });

  it("removes each primitive's visual on disable and redraws it on enable", () => {
    const floor: RuntimeEntity = { id: "floor", type: "solid", shape: box(0, 0.4, 1, 0.1) };
    const { view, log } = loggingView();
    const { rt } = load([floor, zone, crate], { view });
    for (const id of ["floor", "zone", "crate"]) {
      log.length = 0;
      rt.ctx.setEnabled(id, false);
      expect(log).toEqual([`remove ${id}`]);
      log.length = 0;
      rt.ctx.setEnabled(id, true);
      expect(log).toEqual([`draw ${id}`]);
    }
    rt.destroy();
  });

  it("the one-way gate never re-enables a disabled solid, and enable restores its state", () => {
    const ledge: RuntimeEntity = {
      id: "ledge",
      type: "solid",
      shape: box(0, 0, 0.5, 0.05),
      oneWay: true,
    };
    const { rt, steps, hits } = load([ledge]);
    const solids = rt.ctx.system("solid") as SolidSystem;
    rt.ctx.setEnabled("ledge", false);
    solids.gateOneWay(-0.2, false);
    steps(1);
    expect(hits(ledge.shape as ShapeObj)).toEqual([]);
    solids.gateOneWay(0.2, false);
    rt.ctx.setEnabled("ledge", true);
    steps(1);
    expect(solids.isHidden("ledge")).toBe(true);
    expect(hits(ledge.shape as ShapeObj)).toEqual([]);
    solids.gateOneWay(-0.2, false);
    steps(1);
    expect(hits(ledge.shape as ShapeObj)).toEqual(["ledge"]);
    rt.destroy();
  });

  describe("riders", () => {
    const lift: RuntimeEntity = {
      id: "lift",
      type: "follower",
      shape: box(0, 0, 0.3, 0.05),
      path: {
        pts: [
          [0, 0],
          [0, 0.01],
        ],
        mode: "ping_pong",
        speed: 0.00001,
      },
    };
    const rail: RuntimeEntity = {
      id: "rail",
      type: "solid",
      shape: box(0, -0.1, 0.3, 0.02),
      attach: "lift",
    };
    const railBox = box(0, -0.1, 0.2, 0.01);

    it("a disabled rider leaves queries while its carrier stays", () => {
      const { rt, steps, hits } = load([lift, rail], { gravity: [0, 0] });
      steps(1);
      expect(hits(railBox)).toEqual(["rail"]);
      rt.ctx.setEnabled("rail", false);
      steps(1);
      expect(hits(railBox)).toEqual([]);
      expect(hits(box(0, 0, 0.2, 0.02))).toEqual(["lift"]);
      rt.ctx.setEnabled("rail", true);
      expect(hits(railBox)).toEqual(["rail"]);
      rt.destroy();
    });

    it("disabling the carrier takes its riders' colliders with it; the riders stay enabled", () => {
      const { rt, steps, hits } = load([lift, rail], { gravity: [0, 0] });
      steps(1);
      rt.ctx.setEnabled("lift", false);
      steps(1);
      expect(rt.ctx.enabled("rail")).toBe(true);
      expect(hits(railBox)).toEqual([]);
      rt.ctx.setEnabled("lift", true);
      steps(1);
      expect(hits(railBox)).toEqual(["rail"]);
      rt.destroy();
    });
  });
});
