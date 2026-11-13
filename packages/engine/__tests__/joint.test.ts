import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { CharacterSystem } from "../game/behaviors/character-top-down";
import type { JointBlock, JointSystem } from "../game/behaviors/joint";
import { createRegistry } from "../game/define";
import { composePose } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

// the standard build can't call back into JS under vitest, which removing a jointed body does
let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const registry = createRegistry(testGame);

type Physics = "rapier" | "none";

function scene(entities: EntityDef[], physics: Physics = "rapier"): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "joint",
    bounds: [-40, -40, 40, 40],
    settings: { physics, gravity: [0, 9.8] },
    entities,
  };
}

function load(entities: EntityDef[], physics: Physics = "rapier"): SceneRuntimeHandle {
  const rt = createSceneRuntime({
    rapier: physics === "rapier" ? rapier : null,
    view: null,
    game: testGame,
  });
  const report = rt.load(expandScene(scene(entities, physics), registry));
  if (!report.ok) throw Object.assign(new Error(report.error), { report });
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1, each?: () => void) => {
  for (let i = 0; i < n; i++) {
    rt.step(rt.ctx.time.tickMs, []);
    each?.();
  }
};

const joints = (rt: SceneRuntimeHandle) => rt.ctx.behavior<JointSystem>("joint")!;
const jointCount = (rt: SceneRuntimeHandle) => rt.ctx.physics!.world.impulseJoints.len();

/** A box of half size `hw`×`hh` at `at`, with a body of `kind` and an optional joint. */
function box(
  id: string,
  at: [number, number],
  opts: {
    kind?: "dynamic" | "kinematic" | "static";
    joint?: Partial<JointBlock> & { kind: JointBlock["kind"]; to: string };
    hw?: number;
    hh?: number;
    fixedRotation?: boolean;
  } = {},
): EntityDef {
  const body: Record<string, unknown> = {};
  if (opts.kind) body.kind = opts.kind;
  if (opts.fixedRotation) body.fixedRotation = true;
  return {
    id,
    type: "marker",
    at,
    behaviors: {
      collider: { shape: ["box", 0, 0, opts.hw ?? 0.25, opts.hh ?? 0.25] },
      body,
      ...(opts.joint ? { joint: opts.joint } : {}),
    },
  };
}

const pose = (rt: SceneRuntimeHandle, id: string) => rt.ctx.poses.get(id)!;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
/** Where an anchor local to `id`'s pose sits in the world. */
const worldAnchor = (rt: SceneRuntimeHandle, id: string, anchor: [number, number]) => {
  const p = pose(rt, id);
  return composePose(p.x, p.y, p.rot, { x: anchor[0], y: anchor[1], rot: 0 });
};

describe("joint", () => {
  it("revolute: a hinge holds the two anchors together while the body swings", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], { joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] } }),
    ]);
    expect(joints(rt).joined("bob")).toBe(true);
    expect(jointCount(rt)).toBe(1);
    let lowest = 0;
    step(rt, 300, () => {
      const held = worldAnchor(rt, "bob", [-2, 0]);
      expect(distance(held, { x: 0, y: 0 })).toBeLessThan(0.02);
      lowest = Math.max(lowest, pose(rt, "bob").y);
    });
    expect(lowest).toBeGreaterThan(1.9);
    expect(distance(pose(rt, "bob"), { x: 0, y: 0 })).toBeCloseTo(2, 1);
    rt.destroy();
  });

  it("revolute: limits stop the swing at their bound", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], {
        joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0], limits: [-0.5, 0.5] },
      }),
    ]);
    let most = 0;
    step(rt, 240, () => {
      most = Math.max(most, Math.abs(pose(rt, "bob").rot));
    });
    expect(most).toBeGreaterThan(0.4);
    expect(most).toBeLessThan(0.55);
    rt.destroy();
  });

  it("revolute: a motor turns a wheel at its velocity, with no more than its maxForce", () => {
    const wheel = (maxForce: number) =>
      load([
        box("axle", [0, 0], { kind: "static" }),
        box("wheel", [0, 0], {
          joint: { kind: "revolute", to: "axle", motor: { velocity: 3, maxForce } },
        }),
      ]);
    const strong = wheel(1000);
    step(strong, 120);
    expect(strong.ctx.bodies.angularVelocity("wheel")).toBeCloseTo(3, 2);
    strong.destroy();
    // a 0.5 m square of density 1: 0.25 kg, I = m (w² + h²) / 12 ≈ 0.0104 kg·m²
    const weak = wheel(0.01);
    step(weak, 30);
    const w = weak.ctx.bodies.angularVelocity("wheel");
    expect(w).toBeGreaterThan(0);
    const inertia = (0.25 * (0.5 * 0.5 + 0.5 * 0.5)) / 12;
    expect(w).toBeLessThanOrEqual(((0.01 * 30) / 60 / inertia) * 1.01);
    expect(w).toBeLessThan(3);
    weak.destroy();
  });

  it("prismatic: the body slides only along its axis, within its limits, and a motor drives it", () => {
    const rt = load([
      box("rail", [0, 0], { kind: "static" }),
      box("slider", [0, 0], {
        joint: {
          kind: "prismatic",
          to: "rail",
          axis: [1, 0],
          limits: [-1, 1],
          motor: { velocity: 2, maxForce: 100 },
        },
      }),
    ]);
    let far = 0;
    step(rt, 180, () => {
      const p = pose(rt, "slider");
      expect(Math.abs(p.y)).toBeLessThan(0.01);
      expect(Math.abs(p.rot)).toBeLessThan(0.01);
      far = Math.max(far, p.x);
    });
    expect(far).toBeGreaterThan(0.95);
    expect(far).toBeLessThan(1.02);
    rt.destroy();
  });

  it("prismatic: a turned axis is read in the entity's own frame", () => {
    const rt = load([
      box("rail", [0, 0], { kind: "static" }),
      box("slider", [0, 0], { joint: { kind: "prismatic", to: "rail", axis: [0, 1] } }),
    ]);
    step(rt, 60);
    const p = pose(rt, "slider");
    expect(Math.abs(p.x)).toBeLessThan(0.01);
    expect(p.y).toBeGreaterThan(1);
    rt.destroy();
  });

  it("rope: the bodies fall apart up to length and no further", () => {
    const rt = load([
      box("hook", [0, 0], { kind: "static" }),
      box("load", [0.5, 0], { joint: { kind: "rope", to: "hook", anchorB: [0, 0], length: 3 } }),
    ]);
    let most = 0;
    step(rt, 300, () => {
      most = Math.max(most, distance(pose(rt, "load"), { x: 0, y: 0 }));
    });
    expect(most).toBeGreaterThan(2.9);
    expect(most).toBeLessThan(3.02);
    rt.destroy();
  });

  it("weld: the body is held rigidly where it was, turned as it was", () => {
    const rt = load([
      box("wall", [0, 0], { kind: "static" }),
      box("shelf", [1, -0.5], { joint: { kind: "weld", to: "wall" } }),
    ]);
    step(rt, 180);
    const p = pose(rt, "shelf");
    expect(p.x).toBeCloseTo(1, 1);
    expect(p.y).toBeCloseTo(-0.5, 1);
    expect(Math.abs(p.rot)).toBeLessThan(0.02);
    rt.destroy();
  });

  it("spring: the body bounces about its rest length and settles under gravity", () => {
    const rt = load([
      box("ceiling", [0, 0], { kind: "static" }),
      box("weight", [0, 1], {
        joint: {
          kind: "spring",
          to: "ceiling",
          anchorB: [0, 0],
          length: 1,
          stiffness: 50,
          damping: 2,
        },
      }),
    ]);
    let most = 0;
    step(rt, 600, () => {
      most = Math.max(most, pose(rt, "weight").y);
    });
    // m g / k = 0.25 × 9.8 / 50 ≈ 0.049 m of stretch at rest
    expect(most).toBeGreaterThan(1.05);
    expect(most).toBeLessThan(1.2);
    expect(pose(rt, "weight").y).toBeCloseTo(1.049, 2);
    rt.destroy();
  });

  it("holds to a solid's own body, and lets the two bodies collide only when collide is set", () => {
    const entities = (collide: boolean): EntityDef[] => [
      { id: "floor", type: "solid", shape: ["box", 0, 0, 2, 0.25] },
      box("lid", [0, 0], { joint: { kind: "revolute", to: "floor", anchorA: [0, 0], collide } }),
    ];
    const apart = load(entities(false));
    expect(joints(apart).joined("lid")).toBe(true);
    const joint = apart.ctx.physics!.world.impulseJoints.getAll()[0]!;
    expect(joint.contactsEnabled()).toBe(false);
    apart.destroy();
    const touching = load(entities(true));
    expect(touching.ctx.physics!.world.impulseJoints.getAll()[0]!.contactsEnabled()).toBe(true);
    touching.destroy();
  });

  it("a chain of 10 revolute links is stable over 600 ticks and replays to the same digest", () => {
    const half = 0.25;
    const chain: EntityDef[] = [box("top", [0, 0], { kind: "static", hw: 0.1, hh: 0.1 })];
    for (let i = 1; i <= 10; i++) {
      chain.push(
        box(`link-${i}`, [(2 * i - 1) * half, 0], {
          hw: half,
          hh: 0.05,
          joint: {
            kind: "revolute",
            to: i === 1 ? "top" : `link-${i - 1}`,
            anchorA: [-half, 0],
            anchorB: i === 1 ? [0, 0] : [half, 0],
          },
        }),
      );
    }
    const run = () => {
      const rt = load(structuredClone(chain));
      expect(jointCount(rt)).toBe(10);
      const trace: number[] = [];
      let lowest = 0;
      step(rt, 600, () => {
        for (let i = 1; i <= 10; i++) {
          const p = pose(rt, `link-${i}`);
          trace.push(p.x, p.y, p.rot);
        }
        lowest = Math.max(lowest, pose(rt, "link-10").y);
      });
      for (let i = 1; i <= 10; i++) {
        const p = pose(rt, `link-${i}`);
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.rot)).toBe(true);
        const held = worldAnchor(rt, `link-${i}`, [-half, 0]);
        const on = i === 1 ? { x: 0, y: 0 } : worldAnchor(rt, `link-${i - 1}`, [half, 0]);
        expect(distance(held, on)).toBeLessThan(0.05);
      }
      // it swings down from level: the far end passes well below the pivot
      expect(lowest).toBeGreaterThan(3.5);
      rt.destroy();
      return hashText(JSON.stringify(trace));
    };
    expect(run()).toBe(run());
  }, 30_000);

  it("removing the far end removes the joint, and the body falls free", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], { joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] } }),
    ]);
    step(rt, 10);
    rt.ctx.destroy("pivot");
    expect(joints(rt).joined("bob")).toBe(false);
    expect(jointCount(rt)).toBe(0);
    step(rt, 120);
    expect(jointCount(rt)).toBe(0);
    expect(pose(rt, "bob").y).toBeGreaterThan(5);
    expect(joints(rt).size()).toBe(1);
    rt.destroy();
  });

  it("removing the joint's own entity removes the joint", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], { joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] } }),
    ]);
    rt.ctx.destroy("bob");
    expect(jointCount(rt)).toBe(0);
    expect(joints(rt).size()).toBe(0);
    rt.destroy();
  });

  it("rebuilding either end remakes the joint on the new body", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], { joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] } }),
    ]);
    step(rt, 20);
    const bodyOf = (id: string) =>
      rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!.parent()!.handle;
    for (const id of ["pivot", "bob"]) {
      const before = bodyOf(id);
      const e = structuredClone(rt.ctx.get(id)!);
      (e.behaviors!.collider as { shape: unknown }).shape = {
        type: "box",
        cx: 0,
        cy: 0,
        hw: 0.3,
        hh: 0.3,
      };
      expect(rt.update([e])).toEqual({ ok: true });
      expect(bodyOf(id)).not.toBe(before);
      step(rt, 1);
      expect(joints(rt).joined("bob")).toBe(true);
      expect(jointCount(rt)).toBe(1);
      const joint = rt.ctx.physics!.world.impulseJoints.getAll()[0]!;
      expect([joint.body1().handle, joint.body2().handle]).toEqual([
        bodyOf("pivot"),
        bodyOf("bob"),
      ]);
    }
    step(rt, 120, () => {
      const held = worldAnchor(rt, "bob", [-2, 0]);
      expect(distance(held, { x: 0, y: 0 })).toBeLessThan(0.05);
    });
    rt.destroy();
  });

  it("disabling either end removes the joint, and enabling both makes it again", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], { joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] } }),
    ]);
    for (const id of ["bob", "pivot"]) {
      rt.ctx.setEnabled(id, false);
      step(rt, 1);
      expect(joints(rt).joined("bob")).toBe(false);
      expect(jointCount(rt)).toBe(0);
      rt.ctx.setEnabled(id, true);
      step(rt, 1);
      expect(joints(rt).joined("bob")).toBe(true);
      expect(jointCount(rt)).toBe(1);
    }
    rt.destroy();
  });

  it("a joint spawned at runtime joins its end at once", () => {
    const rt = load([box("pivot", [0, 0], { kind: "static" })]);
    step(rt, 1);
    const bob = rt.ctx.spawn({
      type: "marker",
      at: [2, 0],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: {},
        joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] },
      },
    });
    expect(joints(rt).joined(bob.id)).toBe(true);
    step(rt, 60, () => {
      expect(distance(worldAnchor(rt, bob.id, [-2, 0]), { x: 0, y: 0 })).toBeLessThan(0.02);
    });
    rt.destroy();
  });

  it("without anchorB, holds `to` at the point under this body's anchor, and keeps it when remade", () => {
    const rt = load([
      box("hook", [0, 0], { kind: "static" }),
      box("load", [1, 0], { joint: { kind: "rope", to: "hook", length: 2 } }),
    ]);
    step(rt, 120);
    // the rope hangs from (1, 0), where the load started
    expect(distance(pose(rt, "load"), { x: 1, y: 0 })).toBeCloseTo(2, 1);
    expect(joints(rt).save!("load")).toMatchObject({ held: [1, 0] });
    const e = structuredClone(rt.ctx.get("hook")!);
    (e.behaviors!.collider as { shape: unknown }).shape = {
      type: "box",
      cx: 0,
      cy: 0,
      hw: 0.3,
      hh: 0.3,
    };
    rt.update([e]);
    step(rt, 120);
    expect(distance(pose(rt, "load"), { x: 1, y: 0 })).toBeLessThan(2.02);
    expect(distance(pose(rt, "load"), { x: 1, y: 0 })).toBeGreaterThan(1.8);
    rt.destroy();
  });

  it("save gives the joint's handle and restore takes the same joint up again", () => {
    const rt = load([
      box("pivot", [0, 0], { kind: "static" }),
      box("bob", [2, 0], { joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] } }),
    ]);
    const system = joints(rt);
    const saved = system.save!("bob");
    const handle = rt.ctx.physics!.world.impulseJoints.getAll()[0]!.handle;
    expect(saved).toEqual({ joint: handle, held: [0, 0] });
    system.restore!("bob", saved!);
    expect(jointCount(rt)).toBe(1);
    expect(rt.ctx.physics!.world.impulseJoints.getAll()[0]!.handle).toBe(handle);
    system.restore!("bob", { joint: handle + 12345 });
    expect(jointCount(rt)).toBe(1);
    expect(system.joined("bob")).toBe(true);
    rt.destroy();
  });

  it("a rope tied to a walking character pulls its dynamic end along", () => {
    for (const kind of ["character-side-view", "character-top-down"] as const) {
      const rt = load([
        box("floor", [0, 1], { kind: "static", hw: 30, hh: 0.5 }),
        {
          id: "hero",
          type: "marker",
          at: [0, 0.2],
          behaviors: { collider: { shape: ["box", 0, 0, 0.2, 0.2] }, [kind]: {} },
        },
        box("balloon", [-0.6, 0.2], {
          kind: "dynamic",
          hw: 0.1,
          hh: 0.1,
          joint: { kind: "rope", to: "hero", length: 0.6, anchorB: [0, 0] },
        }),
      ]);
      expect(joints(rt).joined("balloon"), kind).toBe(true);
      const characters = rt.ctx.behavior<CharacterSystem>(kind)!;
      step(rt, 120, () => characters.setIntent("hero", { move: { x: 1, y: 0 } }));
      const hero = pose(rt, "hero");
      expect(hero.x, kind).toBeGreaterThan(2);
      expect(distance(hero, pose(rt, "balloon")), kind).toBeLessThan(0.6 + 0.1);
      rt.destroy();
    }
  });

  it("refuses a joint to itself with joint-self", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: testGame });
    const report = rt.load(
      expandScene(
        scene([box("bob", [0, 0], { joint: { kind: "revolute", to: "bob" } })]),
        registry,
      ),
    );
    expect(report).toMatchObject({
      ok: false,
      entityId: "bob",
      error: expect.stringContaining("links bob to itself"),
    });
    expect(
      validateScene(
        scene([box("bob", [0, 0], { joint: { kind: "revolute", to: "bob" } })]),
        registry,
      ).map((i) => i.code),
    ).toContain("joint-self");
    rt.destroy();
  });

  it("refuses a joint to an entity with no body to hold with joint-ref-type", () => {
    const rt = load([
      { id: "spot", type: "marker", at: [0, 0] },
      {
        id: "zone",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: ["box", 0, 0, 1, 1], sensor: true } },
      },
    ]);
    for (const to of ["spot", "zone"]) {
      expect(() =>
        rt.ctx.spawn({
          type: "marker",
          at: [1, 0],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.25, 0.25] },
            body: {},
            joint: { kind: "revolute", to },
          },
        }),
      ).toThrow(expect.objectContaining({ code: "joint-ref-type" }));
      expect(rt.ctx.query.byType("marker").length).toBe(2);
    }
    expect(jointCount(rt)).toBe(0);
    rt.destroy();
  });

  it("refuses a scene without physics with physics-required", () => {
    const rt = load([box("pivot", [0, 0], { kind: "static" })], "none");
    expect(() =>
      rt.ctx.spawn({
        type: "marker",
        at: [1, 0],
        behaviors: {
          collider: { shape: ["box", 0, 0, 0.25, 0.25] },
          body: { kind: "kinematic" },
          joint: { kind: "revolute", to: "pivot" },
        },
      }),
    ).toThrow(expect.objectContaining({ code: "physics-required" }));
    rt.destroy();
  });
});
