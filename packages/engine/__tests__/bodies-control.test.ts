import type { RigidBody } from "@dimforge/rapier2d";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { BehaviorSystem } from "../game/behaviors";
import { createRegistry, defineGame } from "../game/define";
import { EngineError } from "../game/types";
import { createMotionBody } from "../motion/body";
import type { RuntimeBodyControl } from "../runtime/bodies-control";
import { snapshotDigest } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type ExpandedScene,
  type RuntimeEntity,
  type SceneDefinition,
  type ShapeObj,
} from "../scene/types";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DT = 1000 / 60;

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

/** 0.2 m square, density 1: 0.04 kg. */
const crate = (id = "crate", cx = 0): RuntimeEntity => ({
  id,
  type: "prop",
  shape: box(cx, 0, 0.1, 0.1),
  density: 1,
  restitution: 0,
});

const lift: RuntimeEntity = {
  id: "lift",
  type: "follower",
  shape: box(4, 4, 0.5, 0.1),
  path: {
    pts: [
      [4, 4],
      [8, 4],
    ],
    mode: "ping_pong",
    speed: 2,
  },
};

const wall: RuntimeEntity = { id: "wall", type: "solid", shape: box(-6, 0, 0.1, 2) };

function load(
  entities: RuntimeEntity[],
  opts: { physics?: "rapier" | "none"; gravity?: [number, number] } = {},
): SceneRuntimeHandle {
  const scene: ExpandedScene = {
    name: "bodies",
    bounds: [-10, -10, 10, 10],
    settings: {
      gravity: opts.gravity ?? [0, 0],
      physics: opts.physics ?? "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
  const rt = createSceneRuntime({ rapier, view: null, game: null });
  const report = rt.load(scene);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

function bodyOf(rt: SceneRuntimeHandle, id: string): RigidBody {
  const [handle] = rt.ctx.tags.handlesOf(id);
  return rt.ctx.physics!.world.getCollider(handle!)!.parent()!;
}

const steps = (rt: SceneRuntimeHandle, n: number, each?: (tick: number) => void) => {
  for (let i = 0; i < n; i++) {
    each?.(i);
    rt.step(DT, []);
  }
};

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (err) {
    return err instanceof EngineError ? err.code : `not an EngineError: ${String(err)}`;
  }
  return null;
}

describe("ctx.bodies on a prop", () => {
  it("registers the prop as dynamic, a solid as static and a follower as kinematic", () => {
    const rt = load([crate(), wall, lift]);
    const { bodies } = rt.ctx;
    expect(bodies.has("crate")).toBe(true);
    expect(bodies.kind("crate")).toBe("dynamic");
    expect(bodies.kind("wall")).toBe("static");
    expect(bodies.kind("lift")).toBe("kinematic");
    expect(bodies.has("nobody")).toBe(false);
    expect(bodies.kind("nobody")).toBeNull();
    rt.destroy();
  });

  it("reads and writes velocity and angular velocity", () => {
    const rt = load([crate()]);
    const { bodies } = rt.ctx;
    bodies.setVelocity("crate", { x: 2, y: -1 });
    bodies.setAngularVelocity("crate", 3);
    expect(bodies.velocity("crate")).toEqual({ x: 2, y: -1 });
    expect(bodies.angularVelocity("crate")).toBe(3);
    steps(rt, 30);
    const t = bodyOf(rt, "crate").translation();
    expect(t.x).toBeCloseTo(1, 4);
    expect(t.y).toBeCloseTo(-0.5, 4);
    rt.destroy();
  });

  it("reports the body's mass", () => {
    const rt = load([crate(), wall]);
    expect(rt.ctx.bodies.mass("crate")).toBeCloseTo(0.04, 6);
    expect(rt.ctx.bodies.mass("wall")).toBe(Infinity);
    rt.destroy();
  });

  it("an impulse changes velocity at once by impulse / mass, and wakes the body", () => {
    const rt = load([crate()]);
    const body = bodyOf(rt, "crate");
    body.sleep();
    expect(body.isSleeping()).toBe(true);
    rt.ctx.bodies.applyImpulse("crate", { x: 0.08, y: 0 });
    expect(body.isSleeping()).toBe(false);
    expect(rt.ctx.bodies.velocity("crate").x).toBeCloseTo(2, 5);
    rt.destroy();
  });

  it("an impulse off the centre of mass also turns the body", () => {
    const rt = load([crate()]);
    rt.ctx.bodies.applyImpulse("crate", { x: 0.04, y: 0 }, { x: 0, y: 0.1 });
    expect(rt.ctx.bodies.velocity("crate").x).toBeCloseTo(1, 5);
    expect(rt.ctx.bodies.angularVelocity("crate")).not.toBe(0);
    rt.destroy();
  });

  it("a torque turns the body, a force at a point moves and turns it", () => {
    const rt = load([crate(), crate("other", 3)]);
    rt.ctx.bodies.applyTorque("crate", 0.01);
    rt.ctx.bodies.applyForce("other", { x: 0.04, y: 0 }, { x: 3, y: 0.1 });
    steps(rt, 1);
    expect(rt.ctx.bodies.angularVelocity("crate")).toBeGreaterThan(0);
    expect(rt.ctx.bodies.velocity("crate")).toEqual({ x: 0, y: 0 });
    expect(rt.ctx.bodies.velocity("other").x).toBeCloseTo(1 / 60, 5);
    expect(rt.ctx.bodies.angularVelocity("other")).not.toBe(0);
    rt.destroy();
  });

  it("wake wakes a sleeping body", () => {
    const rt = load([crate()]);
    const body = bodyOf(rt, "crate");
    body.sleep();
    rt.ctx.bodies.wake("crate");
    expect(body.isSleeping()).toBe(false);
    rt.destroy();
  });

  it("a despawned prop no longer has a body", () => {
    const rt = load([crate()]);
    rt.ctx.system("prop")!.despawn("crate");
    expect(rt.ctx.bodies.has("crate")).toBe(false);
    rt.destroy();
  });
});

describe("refusals", () => {
  it("an id with no body is body-missing, for every method", () => {
    const rt = load([crate()]);
    const { bodies } = rt.ctx;
    const v = { x: 1, y: 0 };
    for (const call of [
      () => bodies.velocity("ghost"),
      () => bodies.setVelocity("ghost", v),
      () => bodies.angularVelocity("ghost"),
      () => bodies.setAngularVelocity("ghost", 1),
      () => bodies.applyImpulse("ghost", v),
      () => bodies.applyForce("ghost", v),
      () => bodies.applyTorque("ghost", 1),
      () => bodies.mass("ghost"),
      () => bodies.wake("ghost"),
    ])
      expect(codeOf(call)).toBe("body-missing");
    rt.destroy();
  });

  it("a force, torque or impulse on a follower is body-not-dynamic", () => {
    const rt = load([lift, wall]);
    const { bodies } = rt.ctx;
    const v = { x: 1, y: 0 };
    for (const id of ["lift", "wall"]) {
      expect(codeOf(() => bodies.applyForce(id, v))).toBe("body-not-dynamic");
      expect(codeOf(() => bodies.applyTorque(id, 1))).toBe("body-not-dynamic");
      expect(codeOf(() => bodies.applyImpulse(id, v))).toBe("body-not-dynamic");
    }
    expect(codeOf(() => bodies.setVelocity("lift", v))).toBe("body-not-dynamic");
    expect(codeOf(() => bodies.setVelocity("wall", v))).toBe("body-not-dynamic");
    rt.destroy();
  });

  it("a follower's velocity is what its path moved it by in the last step", () => {
    const rt = load([lift]);
    steps(rt, 3);
    const v = rt.ctx.bodies.velocity("lift");
    expect(v.x).toBeCloseTo(2, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(rt.ctx.bodies.mass("lift")).toBe(Infinity);
    rt.destroy();
  });
});

describe("forces last one step", () => {
  it("a force applied every tick matches the closed form within 1e-6", () => {
    const rt = load([crate()]);
    const force = { x: 0.02, y: -0.01 };
    const m = rt.ctx.bodies.mass("crate");
    const dt = rt.ctx.physics!.world.timestep;
    const n = 60;
    steps(rt, n, () => rt.ctx.bodies.applyForce("crate", force));
    const v = rt.ctx.bodies.velocity("crate");
    expect(Math.abs(v.x - (force.x / m) * dt * n)).toBeLessThan(1e-6);
    expect(Math.abs(v.y - (force.y / m) * dt * n)).toBeLessThan(1e-6);
    rt.destroy();
  });

  it("forces applied in one tick sum", () => {
    const rt = load([crate(), crate("twin", 3)]);
    rt.ctx.bodies.applyForce("crate", { x: 0.01, y: 0 });
    rt.ctx.bodies.applyForce("crate", { x: 0.01, y: 0 });
    rt.ctx.bodies.applyForce("twin", { x: 0.02, y: 0 });
    steps(rt, 1);
    expect(rt.ctx.bodies.velocity("crate").x).toBe(rt.ctx.bodies.velocity("twin").x);
    rt.destroy();
  });

  it("a force not applied again stops acting after one step", () => {
    const rt = load([crate()]);
    const body = bodyOf(rt, "crate");
    rt.ctx.bodies.applyForce("crate", { x: 0.04, y: 0 });
    rt.ctx.bodies.applyTorque("crate", 0.01);
    steps(rt, 1);
    const after = rt.ctx.bodies.velocity("crate").x;
    const spin = rt.ctx.bodies.angularVelocity("crate");
    expect(after).toBeCloseTo(1 / 60, 5);
    expect(body.userForce()).toEqual({ x: 0, y: 0 });
    expect(body.userTorque()).toBe(0);
    steps(rt, 10);
    expect(rt.ctx.bodies.velocity("crate").x).toBe(after);
    expect(rt.ctx.bodies.angularVelocity("crate")).toBe(spin);
    rt.destroy();
  });
});

describe("forces after the step", () => {
  /** A runtime whose game applies `force` to the crate in its afterStep each tick. */
  function pushedAfter(force: { x: number; y: number } | null): SceneRuntimeHandle {
    const game = defineGame({
      id: "pusher",
      types: [],
      actions: [],
      createRuntime: (ctx) => ({
        snapshot: () => null,
        afterStep() {
          if (force) ctx.bodies.applyForce("crate", force);
          if (force) ctx.bodies.applyTorque("crate", 0.01);
        },
      }),
    });
    const rt = createSceneRuntime({ rapier, view: null, game });
    const report = rt.load({
      name: "bodies",
      game: "pusher",
      bounds: [-10, -10, 10, 10],
      settings: {
        gravity: [0, 0],
        physics: "rapier",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [crate()],
    });
    if (!report.ok) throw new Error(report.error);
    return rt;
  }

  it("a force or torque applied in afterStep is dropped at the end of the tick", () => {
    const rt = pushedAfter({ x: 0.04, y: 0 });
    steps(rt, 30);
    expect(rt.ctx.bodies.velocity("crate")).toEqual({ x: 0, y: 0 });
    expect(rt.ctx.bodies.angularVelocity("crate")).toBe(0);
    rt.destroy();
  });

  it("a tick boundary holds no force, so a run that pushes after the step digests as one that doesn't", () => {
    const digest = (rt: SceneRuntimeHandle) => {
      const poses: number[][] = [];
      steps(rt, 60, () => {
        const b = bodyOf(rt, "crate");
        poses.push([b.translation().x, b.translation().y, b.linvel().x, b.angvel()]);
      });
      rt.destroy();
      return snapshotDigest(poses);
    };
    expect(digest(pushedAfter({ x: 0.04, y: -0.02 }))).toBe(digest(pushedAfter(null)));
  });
});

describe("replays", () => {
  function trace(each: (rt: SceneRuntimeHandle, tick: number) => void): string {
    const rt = load([crate(), crate("other", 0.25), wall], { gravity: [0, 12] });
    const poses: number[][] = [];
    steps(rt, 600, (tick) => {
      each(rt, tick);
      for (const id of ["crate", "other"]) {
        const b = bodyOf(rt, id);
        const t = b.translation();
        const v = b.linvel();
        poses.push([t.x, t.y, b.rotation(), v.x, v.y, b.angvel()]);
      }
    });
    rt.destroy();
    return snapshotDigest(poses);
  }

  it("an impulse then 600 ticks gives the same digest each run", () => {
    const kick = (rt: SceneRuntimeHandle, tick: number) => {
      if (tick === 0) rt.ctx.bodies.applyImpulse("crate", { x: -0.2, y: -0.1 }, { x: 0, y: 0.05 });
    };
    const first = trace(kick);
    expect(trace(kick)).toBe(first);
    expect(trace(() => {})).not.toBe(first);
  });

  it("a force applied each tick for 600 ticks gives the same digest each run", () => {
    const push = (rt: SceneRuntimeHandle) =>
      rt.ctx.bodies.applyForce("crate", { x: -0.01, y: -0.3 });
    const first = trace(push);
    expect(trace(push)).toBe(first);
    expect(trace(() => {})).not.toBe(first);
  });
});

describe("no calls when nothing asks", () => {
  const FORCE_CALLS = [
    "addForce",
    "addForceAtPoint",
    "addTorque",
    "resetForces",
    "resetTorques",
  ] as const;

  it("a scene with bodies that asks nothing makes no force call to Rapier", () => {
    const spies = FORCE_CALLS.map((name) => vi.spyOn(rapier.RigidBody.prototype, name));
    const rt = load([crate(), wall, lift], { gravity: [0, 12] });
    steps(rt, 30);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    rt.destroy();
  });

  it("nothing registered means flush and clear call nothing", () => {
    const spies = FORCE_CALLS.map((name) => vi.spyOn(rapier.RigidBody.prototype, name));
    const rt = load([]);
    const bodies = rt.ctx.bodies as RuntimeBodyControl;
    bodies.flush();
    bodies.clear();
    steps(rt, 5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    rt.destroy();
  });

  it("forces reach Rapier once and are reset once", () => {
    const add = vi.spyOn(rapier.RigidBody.prototype, "addForce");
    const reset = vi.spyOn(rapier.RigidBody.prototype, "resetForces");
    const rt = load([crate()]);
    rt.ctx.bodies.applyForce("crate", { x: 0.01, y: 0 });
    rt.ctx.bodies.applyForce("crate", { x: 0.01, y: 0 });
    steps(rt, 3);
    expect(add).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    rt.destroy();
  });
});

describe("ctx.bodies with physics none", () => {
  it("covers kinematic bodies only: followers and motion bodies", () => {
    const rt = load([lift, wall], { physics: "none" });
    const { bodies } = rt.ctx;
    expect(bodies.kind("lift")).toBe("kinematic");
    expect(bodies.has("wall")).toBe(false);
    steps(rt, 3);
    expect(bodies.velocity("lift").x).toBeCloseTo(2, 6);

    const hero = createMotionBody(
      rt.ctx,
      { id: "hero", type: "hero" },
      { x: 0, y: 0 },
      {
        shape: box(0, 0, 0.1, 0.1),
      },
    );
    expect(bodies.kind("hero")).toBe("kinematic");
    bodies.setVelocity("hero", { x: 1, y: 2 });
    expect(hero.velocity()).toEqual({ x: 1, y: 2 });
    hero.setVelocity({ x: -3, y: 0 });
    expect(bodies.velocity("hero")).toEqual({ x: -3, y: 0 });
    expect(bodies.angularVelocity("hero")).toBe(0);
    expect(codeOf(() => bodies.applyForce("hero", { x: 1, y: 0 }))).toBe("body-not-dynamic");
    expect(codeOf(() => bodies.setAngularVelocity("hero", 1))).toBe("body-not-dynamic");
    bodies.wake("hero");
    hero.destroy();
    expect(bodies.has("hero")).toBe(false);

    rt.ctx.system("follower")!.despawn("lift");
    expect(bodies.has("lift")).toBe(false);
    rt.destroy();
  });

  it("a motion body on Rapier answers as kinematic too", () => {
    const rt = load([]);
    const hero = createMotionBody(
      rt.ctx,
      { id: "hero", type: "hero" },
      { x: 0, y: 0 },
      { shape: box(0, 0, 0.1, 0.1) },
    );
    expect(rt.ctx.bodies.kind("hero")).toBe("kinematic");
    rt.ctx.bodies.setVelocity("hero", { x: 1, y: 0 });
    expect(hero.velocity()).toEqual({ x: 1, y: 0 });
    hero.destroy();
    expect(rt.ctx.bodies.has("hero")).toBe(false);
    rt.destroy();
  });
});

describe("a kinematic body behavior's angular velocity", () => {
  /** A 2 m plank whose shape sits 1 m right of its entity's pose, on a kinematic body. */
  const plank = (body: Record<string, unknown> = {}): EntityDef => ({
    id: "plank",
    type: "marker",
    at: [2, 3],
    behaviors: {
      collider: { shape: ["box", 1, 0, 1, 0.1] },
      body: { kind: "kinematic", ...body },
    },
  });

  function loadDef(entities: EntityDef[], physics: "rapier" | "none"): SceneRuntimeHandle {
    const registry = createRegistry();
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      name: "spin",
      bounds: [-10, -10, 10, 10],
      settings: { physics, gravity: [0, 0] },
      entities,
    };
    const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null });
    const report = rt.load(expandScene(def, registry));
    if (!report.ok) throw new Error(report.error);
    return rt;
  }

  for (const physics of ["rapier", "none"] as const) {
    it(`turns about its entity's pose at the rate set through ctx.bodies (${physics})`, () => {
      const rt = loadDef([plank()], physics);
      const { bodies } = rt.ctx;
      expect(bodies.kind("plank")).toBe("kinematic");
      expect(bodies.angularVelocity("plank")).toBe(0);
      bodies.setAngularVelocity("plank", 1.5);
      expect(bodies.angularVelocity("plank")).toBe(1.5);
      steps(rt, 60);
      const pose = rt.ctx.poses.get("plank")!;
      expect(pose.rot).toBeCloseTo(1.5, 5);
      expect(pose.x).toBeCloseTo(2, 5);
      expect(pose.y).toBeCloseTo(3, 5);
      if (physics === "rapier") {
        const t = bodyOf(rt, "plank").translation();
        expect(t.x).toBeCloseTo(2 + Math.cos(1.5), 5);
        expect(t.y).toBeCloseTo(3 + Math.sin(1.5), 5);
        expect(bodyOf(rt, "plank").rotation()).toBeCloseTo(1.5, 5);
      }
      bodies.setAngularVelocity("plank", 0);
      steps(rt, 10);
      expect(rt.ctx.poses.get("plank")!.rot).toBeCloseTo(1.5, 5);
      rt.destroy();
    });
  }

  it("moves and turns alike on Rapier and without physics", () => {
    const run = (physics: "rapier" | "none") => {
      const rt = loadDef([plank()], physics);
      rt.ctx.bodies.setVelocity("plank", { x: 1, y: -0.5 });
      rt.ctx.bodies.setAngularVelocity("plank", -2);
      steps(rt, 90);
      const pose = { ...rt.ctx.poses.get("plank")! };
      rt.destroy();
      return pose;
    };
    const a = run("rapier");
    const b = run("none");
    expect(a.x).toBeCloseTo(3.5, 4);
    expect(a.y).toBeCloseTo(2.25, 4);
    expect(a.rot).toBeCloseTo(-3, 4);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
    expect(b.rot).toBeCloseTo(a.rot, 4);
  });

  it("keeps its angular velocity through the body behavior's save, and the same run digests the same", () => {
    const run = () => {
      const rt = loadDef([plank()], "rapier");
      rt.ctx.bodies.setAngularVelocity("plank", 0.75);
      steps(rt, 30);
      const saved = rt.ctx.behavior<BehaviorSystem>("body")!.save!("plank");
      const digest = snapshotDigest(rt.snapshot());
      rt.destroy();
      return { saved, digest };
    };
    const first = run();
    expect(first.saved).toEqual({ w: 0.75 });
    expect(run().digest).toBe(first.digest);

    const rt = loadDef([plank()], "none");
    rt.ctx.behavior<BehaviorSystem>("body")!.restore!("plank", first.saved!);
    expect(rt.ctx.bodies.angularVelocity("plank")).toBe(0.75);
    rt.destroy();
  });

  it("refuses a turn for a fixed-rotation kinematic body, a follower and a motion body", () => {
    const rt = loadDef([plank({ fixedRotation: true })], "rapier");
    const { bodies } = rt.ctx;
    expect(codeOf(() => bodies.setAngularVelocity("plank", 1))).toBe("body-not-dynamic");
    expect(bodies.angularVelocity("plank")).toBe(0);
    for (const call of [
      () => bodies.applyTorque("plank", 1),
      () => bodies.applyForce("plank", { x: 1, y: 0 }),
      () => bodies.applyImpulse("plank", { x: 1, y: 0 }),
    ])
      expect(codeOf(call)).toBe("body-not-dynamic");
    createMotionBody(
      rt.ctx,
      { id: "hero", type: "hero" },
      { x: 0, y: 0 },
      {
        shape: box(0, 0, 0.1, 0.1),
      },
    );
    expect(codeOf(() => bodies.setAngularVelocity("hero", 1))).toBe("body-not-dynamic");
    rt.destroy();

    const lifted = load([lift]);
    expect(codeOf(() => lifted.ctx.bodies.setAngularVelocity("lift", 1))).toBe("body-not-dynamic");
    lifted.destroy();
  });
});
