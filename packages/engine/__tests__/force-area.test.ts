import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { ForceAreaSystem } from "../game/behaviors/force-area";
import { createRegistry, defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile } from "../game/save-file";
import type { GameDefinition } from "../game/types";
import { loadListed } from "../runtime/flow";
import { snapshotDigest } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import { SENSOR_EXIT, type SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** The test game with a second dynamic group, so `affects` has one to leave out. */
const game = defineGame({
  ...testGame,
  collisionGroups: {
    dynamic: { collidesWith: ["sensor"] },
    debris: { collidesWith: ["sensor", "static"] },
  },
});
const registry = createRegistry(game);

type Physics = "rapier" | "none";

function scene(entities: EntityDef[], physics: Physics): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "force-area",
    bounds: [-20, -20, 20, 20],
    settings: { physics, gravity: [0, 0] },
    entities,
  };
}

function load(entities: EntityDef[], physics: Physics = "rapier"): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(expandScene(scene(entities, physics), registry));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle) => rt.step(rt.ctx.time.tickMs, []);
const steps = (rt: SceneRuntimeHandle, n: number) => {
  for (let i = 0; i < n; i++) step(rt);
};
const dt = (rt: SceneRuntimeHandle) => rt.ctx.time.tickMs / 1000;
const areas = (rt: SceneRuntimeHandle) => rt.ctx.behavior<ForceAreaSystem>("force-area")!;

type Area = Record<string, unknown>;
const area = (
  id: string,
  force: Area,
  shape: unknown = ["box", 0, 0, 5, 5],
  at: [number, number] = [0, 0],
): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: { collider: { shape, sensor: true }, "force-area": force },
});

/** A 0.5 m square on a dynamic body: 0.25 kg. */
const crate = (
  id: string,
  at: [number, number],
  extra: { group?: string; tags?: string[] } = {},
): EntityDef => ({
  id,
  type: "marker",
  at,
  ...(extra.tags ? { tags: extra.tags } : {}),
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.25, 0.25], group: extra.group ?? "dynamic" },
    body: { kind: "dynamic" },
  },
});

describe("force-area", () => {
  it("accelerates a crate in a directional area at its force", () => {
    const rt = load([
      area("belt", { kind: "directional", force: [3, -1.5] }),
      crate("crate", [0, 0]),
    ]);
    steps(rt, 5);
    const before = rt.ctx.bodies.velocity("crate");
    steps(rt, 60);
    const after = rt.ctx.bodies.velocity("crate");
    const t = 60 * dt(rt);
    expect((after.x - before.x) / t).toBeCloseTo(3, 3);
    expect((after.y - before.y) / t).toBeCloseTo(-1.5, 3);
    rt.destroy();
  });

  it("holds an orbit around a point area for 600 ticks, the same each run", () => {
    const strength = 4;
    const r = 2;
    const run = () => {
      const rt = load([
        area("well", { kind: "point", strength }, ["circle", 0, 0, 6]),
        crate("crate", [r, 0]),
      ]);
      rt.ctx.bodies.setVelocity("crate", { x: 0, y: Math.sqrt(strength * r) });
      const trace: number[][] = [];
      let near = Infinity;
      let far = 0;
      for (let i = 0; i < 600; i++) {
        step(rt);
        const p = rt.ctx.poses.get("crate")!;
        const v = rt.ctx.bodies.velocity("crate");
        const d = Math.sqrt(p.x * p.x + p.y * p.y);
        near = Math.min(near, d);
        far = Math.max(far, d);
        trace.push([p.x, p.y, v.x, v.y]);
      }
      rt.destroy();
      return { digest: snapshotDigest(trace), near, far };
    };
    const first = run();
    expect(first.near).toBeGreaterThan(r * 0.8);
    expect(first.far).toBeLessThan(r * 1.25);
    expect(run().digest).toBe(first.digest);
  });

  it("pushes only what affects takes: by collision group and by tag", () => {
    const rt = load([
      area("grouped", { force: [2, 0], affects: { groups: ["dynamic"] } }, ["box", 0, 0, 3, 3]),
      area("tagged", { force: [0, 2], affects: { tags: ["light"] } }, ["box", 10, 0, 3, 3]),
      crate("crate", [0, 0]),
      crate("junk", [1, 1], { group: "debris" }),
      crate("lit", [10, 0], { tags: ["light"] }),
      crate("dull", [10, 1]),
    ]);
    steps(rt, 30);
    expect(rt.ctx.bodies.velocity("crate").x).toBeGreaterThan(0.5);
    expect(rt.ctx.bodies.velocity("junk")).toEqual({ x: 0, y: 0 });
    expect(rt.ctx.bodies.velocity("lit").y).toBeGreaterThan(0.5);
    expect(rt.ctx.bodies.velocity("dull")).toEqual({ x: 0, y: 0 });
    rt.destroy();
  });

  it("takes nothing in a group the game doesn't declare, and keeps stepping", () => {
    const entities = [
      area("odd", { force: [2, 0], affects: { groups: ["ghost"] } }, ["box", 0, 0, 3, 3]),
      area("mixed", { force: [0, 2], affects: { groups: ["ghost", "dynamic"] } }, [
        "box",
        10,
        0,
        3,
        3,
      ]),
      crate("crate", [0, 0]),
      crate("other", [10, 0]),
    ];
    const issues = validateScene(scene(entities, "rapier"), registry);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warn")).toBe(true);
    const rt = load(entities);
    steps(rt, 30);
    expect(rt.ctx.bodies.velocity("crate")).toEqual({ x: 0, y: 0 });
    expect(rt.ctx.bodies.velocity("other").y).toBeGreaterThan(0.5);
    expect(areas(rt).sample({ x: 0, y: 0 }, "crate")).toEqual({ x: 0, y: 0 });
    rt.destroy();
  });

  it("lifts only the characters affects takes: by tag and by collision group", () => {
    const character = (
      id: string,
      at: [number, number],
      kind: "character-side-view" | "character-top-down",
      extra: { group?: string; tags?: string[] } = {},
    ): EntityDef => ({
      id,
      type: "marker",
      at,
      ...(extra.tags ? { tags: extra.tags } : {}),
      behaviors: {
        collider: {
          shape: ["box", 0, 0, 0.2, 0.2],
          ...(extra.group ? { group: extra.group } : {}),
        },
        [kind]: {},
      },
    });
    for (const kind of ["character-side-view", "character-top-down"] as const) {
      const rt = load([
        // Past the top-down character's decel, so it moves too.
        area("updraft", { force: [0, -60], affects: { tags: ["crate"] } }, ["box", 0, 0, 3, 3]),
        area("vent", { force: [0, -60], affects: { groups: ["debris"] } }, ["box", 10, 0, 3, 3]),
        character("hero", [0, 0], kind),
        character("boxed", [1.5, 0], kind, { tags: ["crate"] }),
        character("plain", [10, 0], kind),
        character("scrap", [11.5, 0], kind, { group: "debris" }),
      ]);
      expect(areas(rt).sample({ x: 0, y: 0 }, "hero")).toEqual({ x: 0, y: 0 });
      expect(areas(rt).sample({ x: 0, y: 0 }, "boxed")).toEqual({ x: 0, y: -60 });
      expect(areas(rt).sample({ x: 0, y: 0 })).toEqual({ x: 0, y: -60 });
      steps(rt, 5);
      const y = (id: string) => rt.ctx.poses.get(id)!.y;
      expect(y("hero"), kind).toBe(0);
      expect(y("plain"), kind).toBe(0);
      expect(y("boxed"), kind).toBeLessThan(-0.01);
      expect(y("scrap"), kind).toBeLessThan(-0.01);
      rt.destroy();
    }
  });

  it("samples the acceleration a dynamic body inside feels, summed over overlapping areas", () => {
    const rt = load([
      area("well", { kind: "point", strength: 6, falloff: "linear" }, ["circle", 0, 0, 5]),
      area("belt", { force: [0, -1] }, ["box", 2, 0, 1.5, 1.5]),
      crate("crate", [2, 1]),
    ]);
    steps(rt, 2);
    for (let i = 0; i < 3; i++) {
      const p = rt.ctx.poses.get("crate")!;
      const a = areas(rt).sample(p);
      const before = rt.ctx.bodies.velocity("crate");
      step(rt);
      const after = rt.ctx.bodies.velocity("crate");
      expect((after.x - before.x) / dt(rt)).toBeCloseTo(a.x, 3);
      expect((after.y - before.y) / dt(rt)).toBeCloseTo(a.y, 3);
    }
    const d = Math.sqrt(5);
    const linear = 6 * (1 - d / 5);
    expect(areas(rt).sample({ x: 2, y: 1 }).x).toBeCloseTo((-2 / d) * linear, 6);
    expect(areas(rt).sample({ x: 2, y: 1 }).y).toBeCloseTo((-1 / d) * linear - 1, 6);
    expect(areas(rt).sample({ x: 8, y: 8 })).toEqual({ x: 0, y: 0 });
    rt.destroy();
  });

  it("turns a directional force with the entity", () => {
    const rt = load([area("belt", { force: [2, 0] }, ["circle", 0, 0, 2]), crate("crate", [0, 0])]);
    const rot = 1;
    rt.ctx.poses.set("belt", 0, 0, rot);
    const a = areas(rt).sample({ x: 0, y: 0 });
    expect(a.x).toBeCloseTo(2 * Math.cos(rot), 6);
    expect(a.y).toBeCloseTo(2 * Math.sin(rot), 6);
    rt.destroy();
  });

  it("stops pushing a body the tick after it leaves", () => {
    const rt = load([area("belt", { force: [6, 0] }, ["box", 0, 0, 1, 1]), crate("crate", [0, 0])]);
    const v: number[] = [];
    let exit = -1;
    for (let i = 0; i < 120 && exit < 0; i++) {
      const { events } = step(rt);
      v.push(rt.ctx.bodies.velocity("crate").x);
      if (events.some((e) => e.type === SENSOR_EXIT && e.other === "crate")) exit = i;
    }
    expect(exit).toBeGreaterThan(0);
    expect(v[exit]!).toBeGreaterThan(v[exit - 1]!);
    step(rt);
    expect(rt.ctx.bodies.velocity("crate").x).toBe(v[exit]);
    rt.destroy();
  });

  it("slows a body inside by its drag", () => {
    const run = (drag: number) => {
      const rt = load([area("pool", { force: [0, 0], drag }), crate("crate", [0, 0])]);
      rt.ctx.bodies.setVelocity("crate", { x: 2, y: 0 });
      steps(rt, 60);
      const v = rt.ctx.bodies.velocity("crate").x;
      rt.destroy();
      return v;
    };
    expect(run(0)).toBeCloseTo(2, 5);
    const slowed = run(2);
    expect(slowed).toBeGreaterThan(0);
    expect(slowed).toBeLessThan(2 * Math.exp(-2) * 1.2);
  });

  it("refuses a collider that isn't a sensor", () => {
    const rt = createSceneRuntime({ rapier, view: null, game });
    const def = scene(
      [
        {
          id: "belt",
          type: "marker",
          at: [0, 0],
          behaviors: { collider: { shape: ["box", 0, 0, 1, 1] }, "force-area": { force: [1, 0] } },
        },
      ],
      "rapier",
    );
    const report = rt.load(expandScene(def, registry));
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error).toMatch(/sensor: true/);
    rt.destroy();

    const issue = validateScene(def, registry).find((i) => i.entityIds?.includes("belt"));
    expect(issue).toMatchObject({
      code: "schema",
      message: "belt's force-area needs its collider to be a sensor (sensor: true)",
      path: "/entities/0/behaviors/collider/sensor",
      expected: "true",
      got: "false",
    });
    expect(issue?.fix?.ops).toEqual([
      { op: "update", ref: "belt", set: { "behaviors.collider.sensor": true } },
    ]);
  });

  it("keeps what is inside through a world save on the geometry backend", () => {
    const def = scene(
      [
        area("belt", { force: [1, 0] }, ["box", 0, 0, 1, 1]),
        {
          id: "cart",
          type: "marker",
          at: [0, 0],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.25, 0.25], group: "dynamic" },
            body: { kind: "kinematic" },
          },
        },
      ],
      "none",
    );
    const library: SceneLibrary = {
      list: [{ scene: "force-area" }],
      scenes: new Map<string, LibraryScene>([["force-area", { def, prefabs: new Map() }]]),
    };
    const saving: GameDefinition = defineGame({
      ...game,
      createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
    });
    const runtime = () =>
      createSceneRuntime({ rapier: null, view: null, game: saving, scenes: library });
    const a = runtime();
    expect(loadListed(a, "force-area").ok).toBe(true);
    steps(a, 10);
    expect(areas(a).save!("belt")).toEqual({ inside: ["cart"] });
    expect(areas(a).sample(a.ctx.poses.get("cart")!)).toEqual({ x: 1, y: 0 });
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    expect(captured.file.world!.systems).toMatchObject({
      belt: { "force-area": { inside: ["cart"] } },
    });
    const parsed = parseSaveFile(formatSaveFile(captured.file), saving);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(areas(b).save!("belt")).toEqual({ inside: ["cart"] });
    for (const rt of [a, b]) {
      expect(step(rt).events).toEqual([]);
      rt.ctx.bodies.setVelocity("cart", { x: 3, y: 0 });
    }
    for (let i = 0; i < 40; i++) expect(step(b).events).toEqual(step(a).events);
    expect(areas(a).save!("belt")).toBeUndefined();
    expect(areas(b).save!("belt")).toBeUndefined();
  });
});

describe("force-area with no game", () => {
  it("pushes a dynamic body with the collider's default group, and its sensor reports it", () => {
    const gameless = createRegistry();
    const rt = createSceneRuntime({ rapier, view: null, game: null });
    const def: SceneDefinition = {
      ...scene([], "rapier"),
      entities: [
        area("belt", { kind: "directional", force: [3, 0] }),
        {
          id: "crate",
          type: "marker",
          at: [0, 0],
          behaviors: { collider: { shape: ["box", 0, 0, 0.25, 0.25] }, body: { kind: "dynamic" } },
        },
      ],
    };
    delete def.game;
    const report = rt.load(expandScene(def, gameless));
    if (!report.ok) throw new Error(report.error);
    const entered: string[] = [];
    rt.ctx.events.on("sensor:enter", (e) => {
      if (e.entityId === "belt" && e.other) entered.push(e.other);
    });
    steps(rt, 5);
    const before = rt.ctx.bodies.velocity("crate");
    steps(rt, 60);
    const after = rt.ctx.bodies.velocity("crate");
    expect((after.x - before.x) / (60 * dt(rt))).toBeCloseTo(3, 3);
    expect(entered).toEqual(["crate"]);
    rt.destroy();
  });

  it("filters by collision group without physics, and pushes the characters it takes", () => {
    const gameless = createRegistry();
    for (const kind of ["character-side-view", "character-top-down"] as const) {
      const rt = createSceneRuntime({ rapier: null, view: null, game: null });
      const hero = (id: string, at: [number, number]): EntityDef => ({
        id,
        type: "marker",
        at,
        behaviors: { collider: { shape: ["box", 0, 0, 0.2, 0.2] }, [kind]: {} },
      });
      const def: SceneDefinition = {
        ...scene([], "none"),
        entities: [
          area("vent", { force: [60, 0], affects: { groups: ["dynamic"] } }, ["box", 0, 0, 3, 3]),
          area("dud", { force: [60, 0], affects: { groups: ["static"] } }, ["box", 10, 0, 3, 3]),
          hero("hero", [0, 0]),
          hero("still", [10, 0]),
        ],
      };
      delete def.game;
      expect(validateScene(def, gameless)).toEqual([]);
      const report = rt.load(expandScene(def, gameless));
      if (!report.ok) throw new Error(report.error);
      expect(areas(rt).sample({ x: 0, y: 0 }, "hero")).toEqual({ x: 60, y: 0 });
      expect(areas(rt).sample({ x: 10, y: 0 }, "still")).toEqual({ x: 0, y: 0 });
      steps(rt, 5);
      expect(rt.ctx.poses.get("hero")!.x, kind).toBeGreaterThan(0.01);
      expect(rt.ctx.poses.get("still")!.x, kind).toBe(10);
      rt.destroy();
    }
  });
});
