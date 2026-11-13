import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile } from "../game/save-file";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const registry = createRegistry(testGame);

type Physics = "rapier" | "none";

function scene(entities: EntityDef[], physics: Physics = "rapier"): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "body",
    bounds: [-20, -20, 20, 20],
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
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

const box = (kind?: "dynamic" | "kinematic" | "static", at: [number, number] = [0, 0]) => ({
  id: kind ?? "dynamic",
  type: "marker",
  at,
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.25, 0.25] },
    body: kind ? { kind } : {},
  },
});

const ramp: EntityDef = {
  id: "ramp",
  type: "solid",
  shape: ["poly", -4, 2, 4, 4, -4, 4],
};

describe("body", () => {
  it("is dynamic by default: gravity moves it and it writes its pose after each step", () => {
    const rt = load([box()]);
    expect(rt.ctx.bodies.kind("dynamic")).toBe("dynamic");
    step(rt, 30);
    const at = rt.ctx.poses.get("dynamic")!;
    expect(at.x).toBe(0);
    expect(at.y).toBeGreaterThan(1);
    const [handle] = rt.ctx.tags.handlesOf("dynamic");
    const body = rt.ctx.physics!.world.getCollider(handle!)!.parent()!;
    expect(body.translation().y).toBe(at.y);
  });

  it("is kinematic: only the velocity code gives it moves it, on either backend", () => {
    for (const physics of ["rapier", "none"] as const) {
      const rt = load([box("kinematic")], physics);
      expect(rt.ctx.bodies.kind("kinematic")).toBe("kinematic");
      step(rt, 30);
      expect(rt.ctx.poses.get("kinematic")).toMatchObject({ x: 0, y: 0 });
      rt.ctx.bodies.setVelocity("kinematic", { x: 2, y: -1 });
      step(rt, 60);
      const at = rt.ctx.poses.get("kinematic")!;
      expect(at.x).toBeCloseTo(2, 5);
      expect(at.y).toBeCloseTo(-1, 5);
      expect(rt.ctx.bodies.velocity("kinematic")).toEqual({ x: 2, y: -1 });
      expect(() => rt.ctx.bodies.applyImpulse("kinematic", { x: 1, y: 0 })).toThrow(
        expect.objectContaining({ code: "body-not-dynamic" }),
      );
      if (physics === "none") {
        const hits = rt.ctx.space.overlaps({ type: "circle", cx: 2, cy: -1, r: 0.05 });
        expect(hits.map((h) => h.tag.entityId)).toEqual(["kinematic"]);
      }
    }
  });

  it("is static: nothing moves it", () => {
    const rt = load([box("static")]);
    expect(rt.ctx.bodies.kind("static")).toBe("static");
    step(rt, 30);
    expect(rt.ctx.poses.get("static")).toMatchObject({ x: 0, y: 0 });
    expect(() => rt.ctx.bodies.setVelocity("static", { x: 1, y: 0 })).toThrow(
      expect.objectContaining({ code: "body-not-dynamic" }),
    );
  });

  it("moves as a prop of the same shape and fields does, pose for pose, over 300 ticks", () => {
    const fields = {
      gravityScale: 0.8,
      linearDamping: 0.1,
      angularDamping: 0.2,
      ccd: true,
    };
    const surface = { density: 2, restitution: 0.3, friction: 0.4 };
    const prop = load([
      ramp,
      { id: "it", type: "prop", shape: ["box", 1, 0, 0.3, 0.2], ...surface, ...fields },
    ]);
    const carried = load([
      ramp,
      {
        id: "it",
        type: "marker",
        at: [1, 0],
        behaviors: {
          collider: { shape: ["box", 0, 0, 0.3, 0.2], ...surface },
          body: fields,
        },
      },
    ]);
    const poses: [number, number, number][][] = [[], []];
    [prop, carried].forEach((rt, i) => {
      for (let t = 0; t < 300; t++) {
        step(rt);
        const p = rt.ctx.poses.get("it")!;
        poses[i]!.push([p.x, p.y, p.rot]);
      }
    });
    expect(poses[1]).toEqual(poses[0]);
    expect(poses[0]![299]![0]).toBeGreaterThan(2);
    expect(poses[0]!.some(([, , rot]) => rot !== 0)).toBe(true);
  });

  it("locks rotations with fixedRotation", () => {
    const rt = load([
      ramp,
      {
        id: "it",
        type: "marker",
        at: [1, 0],
        behaviors: {
          collider: { shape: ["box", 0, 0, 0.3, 0.2] },
          body: { fixedRotation: true },
        },
      },
    ]);
    step(rt, 120);
    expect(rt.ctx.poses.get("it")!.rot).toBe(0);
  });

  it("is physics-required when dynamic in a world without physics", () => {
    const issues = validateScene(scene([box()], "none"), registry);
    expect(issues.map((i) => i.code)).toContain("physics-required");
    const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
    const report = rt.load(expandScene(scene([box()], "none"), registry));
    expect(report).toMatchObject({ ok: false, reason: "physics-required", entityId: "dynamic" });
    expect(rt.load(expandScene(scene([box("kinematic")], "none"), registry)).ok).toBe(true);
  });

  it("rebuilds once when only its block changes, and returns to a fixed body when it goes", () => {
    const rt = load([box()]);
    const add = vi.spyOn(rt.ctx.physics!, "addRigidBody");
    const loaded = rt.get("dynamic")!;
    rt.update([
      { ...loaded, behaviors: { ...loaded.behaviors, body: { kind: "dynamic", gravityScale: 0 } } },
    ]);
    expect(add).toHaveBeenCalledTimes(1);
    const { body: _gone, ...rest } = rt.get("dynamic")!.behaviors!;
    rt.update([{ ...loaded, behaviors: rest }]);
    expect(add).toHaveBeenCalledTimes(2);
    expect(rt.ctx.bodies.kind("dynamic")).toBe("static");
    expect(rt.ctx.physics!.world.bodies.len()).toBe(1);
    expect(rt.ctx.behavior("body")!.size()).toBe(0);
  });

  it("keeps its velocity through a disable and an enable", () => {
    for (const physics of ["rapier", "none"] as const) {
      const kind = physics === "rapier" ? "dynamic" : "kinematic";
      const rt = load(
        [
          {
            ...box(kind),
            behaviors: {
              collider: { shape: ["box", 0, 0, 0.25, 0.25] },
              body: { kind, gravityScale: 0 },
            },
          },
        ],
        physics,
      );
      rt.ctx.bodies.setVelocity(kind, { x: 2, y: 0 });
      if (kind === "dynamic") rt.ctx.bodies.setAngularVelocity(kind, 1);
      step(rt, 10);
      const before = rt.ctx.poses.get(kind)!;
      rt.ctx.setEnabled(kind, false);
      step(rt, 10);
      expect(rt.ctx.poses.get(kind)).toEqual(before);
      rt.ctx.setEnabled(kind, true);
      expect(rt.ctx.bodies.velocity(kind).x).toBeCloseTo(2, 5);
      if (kind === "dynamic") expect(rt.ctx.bodies.angularVelocity(kind)).toBeCloseTo(1, 5);
      step(rt, 10);
      expect(rt.ctx.poses.get(kind)!.x).toBeGreaterThan(before.x);
    }
  });

  it("saves and restores a kinematic body's velocity on the geometry backend, to the same digest 300 ticks on", () => {
    const def = scene(
      [
        box("kinematic", [-3, 0]),
        {
          id: "trigger",
          type: "marker",
          at: [0, 0],
          behaviors: { collider: { shape: ["box", 0, 0, 0.5, 2], sensor: true } },
        },
        { ...box("kinematic", [3, 1]), id: "still" },
      ].map((e) => ({
        ...e,
        behaviors:
          e.id === "kinematic"
            ? { ...e.behaviors, collider: { shape: ["box", 0, 0, 0.25, 0.25], group: "dynamic" } }
            : e.behaviors,
      })) as EntityDef[],
      "none",
    );
    const library: SceneLibrary = {
      list: [{ scene: "body" }],
      scenes: new Map<string, LibraryScene>([["body", { def, prefabs: new Map() }]]),
    };
    /** The test game with nothing of its own to save, so the world save is the behaviors'. */
    const game = defineGame({
      ...testGame,
      createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
    });
    const runtime = () => createSceneRuntime({ rapier: null, view: null, game, scenes: library });
    /** Each tick's events and every entity's pose, hashed. */
    const run = (rt: SceneRuntimeHandle, from: number, ticks: number) => {
      const frames: unknown[] = [];
      for (let t = from; t < from + ticks; t++) {
        if (t === 5) rt.ctx.bodies.setVelocity("kinematic", { x: 1.5, y: 0 });
        if (t === 20) rt.ctx.bodies.setVelocity("still", { x: 0, y: -1 });
        if (t === 40) rt.ctx.bodies.setVelocity("still", { x: 0, y: 0 });
        if (t === 200) rt.ctx.bodies.setVelocity("kinematic", { x: -2, y: 0.5 });
        const result = rt.step(rt.ctx.time.tickMs, []);
        const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
          const p = rt.ctx.poses.get(id)!;
          return [id, p.x, p.y, p.rot];
        });
        frames.push([result.tick, result.events, poses]);
      }
      return hashText(JSON.stringify(frames));
    };

    const a = runtime();
    expect(loadListed(a, "body").ok).toBe(true);
    run(a, 0, 60);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const digest = run(a, 60, 300);
    expect(captured.file.world!.systems).toMatchObject({
      kinematic: { body: { v: [1.5, 0] } },
      still: { body: {} },
    });

    const parsed = parseSaveFile(formatSaveFile(captured.file), game);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    const hits = b.ctx.space.overlaps({ type: "circle", cx: 3, cy: 0.66667, r: 0.05 });
    expect(hits.map((h) => h.tag.entityId)).toEqual(["still"]);
    expect(run(b, 60, 300)).toBe(digest);
  });
});
