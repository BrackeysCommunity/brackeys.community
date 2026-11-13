import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import { SENSOR_ENTER, SENSOR_EXIT, type SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const game = defineGame({
  ...testGame,
  materials: {
    ice: { friction: 0.05, restitution: 0.4, description: "Slippery and a little bouncy." },
  },
});
const registry = createRegistry(game);

type Physics = "rapier" | "none";

function scene(entities: EntityDef[], physics: Physics = "rapier"): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "collider",
    bounds: [-20, -20, 20, 20],
    settings: { physics, gravity: [0, 9.8] },
    entities,
  };
}

function load(entities: EntityDef[], physics: Physics = "rapier"): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(expandScene(scene(entities, physics), registry));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const steps = (rt: SceneRuntimeHandle, n: number) => {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...rt.step(rt.ctx.time.tickMs, []).events);
  return events;
};

const ledge: EntityDef = {
  id: "ledge",
  type: "marker",
  at: [0, 2],
  behaviors: { collider: { shape: ["box", 0, 0, 2, 0.1] } },
};
const crate: EntityDef = {
  id: "crate",
  type: "prop",
  shape: ["box", 0, 0, 0.25, 0.25],
  density: 1,
  restitution: 0,
};

/** A marker riding a kinematic body that `ctx.bodies` sets moving, its collider in the dynamic group so sensors see it. */
const cart = (id: string, at: [number, number]): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.2, 0.2], group: "dynamic" },
    body: { kind: "kinematic" },
  },
});

describe("collider", () => {
  it("is a fixed body without a body block: a prop lands on it and stays", () => {
    const rt = load([ledge, crate]);
    expect(rt.ctx.bodies.kind("ledge")).toBe("static");
    const [handle] = rt.ctx.tags.handlesOf("ledge");
    expect(rt.ctx.tags.get(handle!)).toEqual({ entityId: "ledge", type: "marker" });
    steps(rt, 120);
    const at = rt.ctx.poses.get("crate")!;
    expect(at.y).toBeCloseTo(2 - 0.1 - 0.25, 2);
    expect(rt.ctx.poses.get("ledge")).toMatchObject({ x: 0, y: 2 });
    expect(rt.ctx.behavior("collider")!.size()).toBe(1);
  });

  it("is local to the entity's pose", () => {
    const rt = load([{ ...ledge, behaviors: { collider: { shape: ["box", 1, -0.5, 0.5, 0.5] } } }]);
    const [handle] = rt.ctx.tags.handlesOf("ledge");
    const body = rt.ctx.physics!.world.getCollider(handle!)!.parent()!;
    expect(body.translation()).toEqual({ x: 1, y: 1.5 });
  });

  it("goes to the geometry world without physics, where queries find it", () => {
    const rt = load([ledge], "none");
    expect(rt.ctx.bodies.has("ledge")).toBe(false);
    const hits = rt.ctx.space.overlaps({ type: "circle", cx: 1.5, cy: 2, r: 0.05 });
    expect(hits.map((h) => h.tag.entityId)).toEqual(["ledge"]);
    expect(rt.ctx.space.overlaps({ type: "circle", cx: 2.5, cy: 2, r: 0.05 })).toEqual([]);
  });

  it("takes friction and restitution from its material, its own fields winning", () => {
    const rt = load([
      { ...ledge, behaviors: { collider: { shape: ["box", 0, 0, 2, 0.1], material: "ice" } } },
      {
        id: "rink",
        type: "marker",
        at: [0, 5],
        behaviors: {
          collider: { shape: ["box", 0, 0, 2, 0.1], material: "ice", friction: 0.7, density: 3 },
        },
      },
    ]);
    const collider = (id: string) =>
      rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!;
    expect(collider("ledge").friction()).toBeCloseTo(0.05);
    expect(collider("ledge").restitution()).toBeCloseTo(0.4);
    expect(collider("rink").friction()).toBeCloseTo(0.7);
    expect(collider("rink").density()).toBe(3);
    expect(rt.ctx.tags.get(rt.ctx.tags.handlesOf("rink")[0]!)?.material).toBe("ice");
  });

  it("joins the collision group it names", () => {
    const rt = load([
      { ...ledge, behaviors: { collider: { shape: ["box", 0, 0, 2, 0.1], group: "dynamic" } } },
    ]);
    const collider = rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf("ledge")[0]!)!;
    expect(collider.collisionGroups()).toBe(registry.collisionGroups("dynamic"));
  });

  it.each(["rapier", "none"] as const)(
    "as a sensor raises the sensor type's events for the same shape (%s)",
    (physics) => {
      const rt = load(
        [
          { id: "zone", type: "sensor", shape: ["box", 2, 0, 0.5, 0.5] },
          {
            id: "trigger",
            type: "marker",
            at: [2, 4],
            behaviors: { collider: { shape: ["box", 0, 0, 0.5, 0.5], sensor: true } },
          },
          cart("a", [0, 0]),
          cart("b", [0, 4]),
        ],
        physics,
      );
      rt.ctx.bodies.setVelocity("a", { x: 3, y: 0 });
      rt.ctx.bodies.setVelocity("b", { x: 3, y: 0 });
      const events = steps(rt, 120).filter(
        (e) => e.type === SENSOR_ENTER || e.type === SENSOR_EXIT,
      );
      const of = (sensor: string) =>
        events
          .filter((e) => e.entityId === sensor)
          .map((e) => [e.tick, e.type, e.other === "a" || e.other === "b" ? "cart" : e.other]);
      const zone = of("zone");
      expect(zone.map(([, type]) => type)).toEqual([SENSOR_ENTER, SENSOR_EXIT]);
      expect(of("trigger")).toEqual(zone);
      const enter = events.find((e) => e.entityId === "trigger" && e.type === SENSOR_ENTER)!;
      expect(enter.other).toBe("b");
      expect(enter.at.y).toBeCloseTo(4);
    },
  );

  it("as a sensor sees a falling prop on the tick the sensor type does", () => {
    const rt = load([
      { id: "zone", type: "sensor", shape: ["box", 0, 3, 1, 0.2] },
      {
        id: "trigger",
        type: "marker",
        at: [5, 3],
        behaviors: { collider: { shape: ["box", 0, 0, 1, 0.2], sensor: true } },
      },
      { ...crate, id: "p", shape: ["box", 0, 0, 0.25, 0.25] },
      { ...crate, id: "q", shape: ["box", 5, 0, 0.25, 0.25] },
    ]);
    const events = steps(rt, 90);
    const of = (sensor: string) =>
      events.filter((e) => e.entityId === sensor).map((e) => [e.tick, e.type]);
    expect(of("zone").length).toBe(2);
    expect(of("trigger")).toEqual(of("zone"));
  });

  it("as a sensor forgets what is inside while disabled and keeps it through a save", () => {
    const rt = load([
      {
        id: "trigger",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: ["box", 0, 0, 1, 1], sensor: true } },
      },
      cart("a", [0, 0]),
    ]);
    const entered = steps(rt, 2).filter((e) => e.type === SENSOR_ENTER);
    expect(entered.map((e) => e.other)).toEqual(["a"]);
    const colliders = rt.ctx.behavior("collider")!;
    expect(colliders.save!("trigger")).toEqual({ inside: [["a", 0]] });
    rt.ctx.setEnabled("trigger", false);
    expect(steps(rt, 2).filter((e) => e.entityId === "trigger")).toEqual([]);
    rt.ctx.setEnabled("trigger", true);
    expect(
      steps(rt, 2)
        .filter((e) => e.entityId === "trigger")
        .map((e) => e.type),
    ).toEqual([SENSOR_ENTER]);
  });

  it("is refused on a type whose system owns a body", () => {
    const issues = validateScene(
      scene([
        {
          ...crate,
          behaviors: { collider: { shape: ["box", 0, 0, 0.25, 0.25] } },
        },
      ]),
      registry,
    );
    expect(issues.map((i) => i.code)).toContain("behavior-forbidden");
  });

  it("rebuilds once when its block changes, and not at all when nothing did", () => {
    const rt = load([
      {
        ...ledge,
        behaviors: { collider: { shape: ["box", 0, 0, 2, 0.1] }, body: { kind: "kinematic" } },
      },
    ]);
    const add = vi.spyOn(rt.ctx.physics!, "addRigidBody");
    const loaded = rt.get("ledge")!;
    rt.update([loaded]);
    expect(add).toHaveBeenCalledTimes(0);
    rt.update([
      {
        ...loaded,
        behaviors: {
          collider: { ...loaded.behaviors!.collider, friction: 0.3 },
          body: { kind: "kinematic", gravityScale: 0 },
        },
      },
    ]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(rt.ctx.tags.handlesOf("ledge")).toHaveLength(1);
    expect(rt.ctx.physics!.world.bodies.len()).toBe(1);
  });

  it("leaves nothing behind when it detaches", () => {
    const rt = load([ledge, cart("a", [0, 0])]);
    rt.remove(["ledge", "a"]);
    expect(rt.ctx.physics!.world.bodies.len()).toBe(0);
    expect(rt.ctx.bodies.has("a")).toBe(false);
    expect(rt.ctx.tags.handlesOf("ledge")).toEqual([]);
    expect(rt.ctx.behavior("collider")!.size()).toBe(0);
  });

  it("keeps a sensor's overlaps through a world restore that rebuilds what is inside it", () => {
    const def = scene(
      [
        {
          id: "trigger",
          type: "marker",
          at: [0, 0],
          behaviors: { collider: { shape: ["box", 0, 0, 1, 1], sensor: true } },
        },
        cart("cart", [-3, 0]),
      ],
      "none",
    );
    const library: SceneLibrary = {
      list: [{ scene: "sensor-restore" }],
      scenes: new Map<string, LibraryScene>([["sensor-restore", { def, prefabs: new Map() }]]),
    };
    const saving = defineGame({
      ...testGame,
      createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
    });
    const runtime = () =>
      createSceneRuntime({ rapier: null, view: null, game: saving, scenes: library });
    const sensorEvents = (rt: SceneRuntimeHandle) =>
      rt
        .step(rt.ctx.time.tickMs, [])
        .events.filter((e) => e.type === SENSOR_ENTER || e.type === SENSOR_EXIT)
        .map((e) => [e.type, e.other]);

    const a = runtime();
    expect(loadListed(a, "sensor-restore").ok).toBe(true);
    a.ctx.bodies.setVelocity("cart", { x: 3, y: 0 });
    for (let i = 0; i < 50; i++) a.step(a.ctx.time.tickMs, []);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);

    const b = runtime();
    const restored = restoreSave(b, captured.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(sensorEvents(b)).toEqual(sensorEvents(a));
  });
});
