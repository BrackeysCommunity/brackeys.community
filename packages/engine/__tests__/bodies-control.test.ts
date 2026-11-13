import type { RigidBody } from "@dimforge/rapier2d";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { EngineError } from "../game/types";
import { createMotionBody } from "../motion/body";
import type { RuntimeBodyControl } from "../runtime/bodies-control";
import { snapshotDigest } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
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
