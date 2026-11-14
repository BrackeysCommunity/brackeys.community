import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../game/define";
import { shapeField } from "../game/fields";
import type { GameDefinition } from "../game/types";
import type { TickInput } from "../input/stream";
import { runtimeView, type ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, ProjectView } from "../project/types";
import { createSceneRuntime, saveHostOf } from "../runtime/runtime";
import { SENSOR_ENTER, SENSOR_EXIT, type RuntimeStats } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import { createSolidSystem, type SolidSystem } from "../systems/bodies";
import type { MarkerSystem } from "../systems/marker";
import type { FollowerSystem } from "../systems/path-follower";
import type { InputAction, RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { recordingView } from "./fixtures/recording-view";
import { AVATAR_SPEED, CARD_TABLE, testGame, type TestGameSnapshot } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

function runtime(game: GameDefinition | null = testGame) {
  return createSceneRuntime({ rapier, view: null, game });
}

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

function scene(entities: RuntimeEntity[], gravity: [number, number] = [0, 1200]): ExpandedScene {
  return {
    name: "t",
    bounds: [-1000, -1000, 1000, 1000],
    settings: { gravity, physics: "rapier", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

const floor: RuntimeEntity = { id: "floor", type: "solid", shape: box(0, 20, 500, 20) };

const EMPTY: RuntimeStats = {
  backend: "rapier",
  bodies: 0,
  colliders: 0,
  tags: 0,
  entities: 0,
  perType: {},
  behaviors: {},
};

const press = (action: string): InputAction => ({ action, pressed: true, tick: 0, timestamp: 0 });

function steps(rt: ReturnType<typeof runtime>, n: number, first: InputAction[] = []) {
  return Array.from({ length: n }, (_, i) => rt.step(DT, i === 0 ? first : []));
}

function handleOf(rt: ReturnType<typeof runtime>, id: string): number {
  const handle = rt.ctx.tags.handlesOf(id)[0];
  if (handle === undefined) throw new Error(`no collider for ${id}`);
  return handle;
}

function bodyOf(rt: ReturnType<typeof runtime>, id: string) {
  return rt.ctx.physics!.world.getCollider(handleOf(rt, id))!.parent()!;
}

const ENGINE_YARD_COUNTS = { solid: 4, sensor: 1, marker: 1, prop: 2, follower: 1 };

describe("SceneRuntime load and unload", () => {
  it("loads engine-yard with one system per primitive", () => {
    const rt = runtime();
    expect(rt.load(engineYard())).toEqual({ ok: true, counts: ENGINE_YARD_COUNTS, ms: 0 });
    expect(rt.stats()).toEqual({
      backend: "rapier",
      bodies: 8,
      colliders: 8,
      tags: 8,
      entities: 9,
      perType: ENGINE_YARD_COUNTS,
      behaviors: {},
    });
    expect(rt.get("lift")?.type).toBe("follower");
    expect(
      rt.ctx
        .system<MarkerSystem>("marker")
        ?.list()
        .map((m) => m.id),
    ).toEqual(["start"]);
    expect(rt.scene()?.name).toBe("engine-yard");
    rt.destroy();
  });

  it("keys the scene on the asset id a load gives, until a load without one", () => {
    const rt = runtime();
    const host = () => saveHostOf(rt.ctx)!;
    rt.load(engineYard(), {}, { sceneId: "yard-asset" });
    expect(host().sceneId()).toBe("yard-asset");
    expect(rt.scene()?.name).toBe("engine-yard");
    rt.load(engineYard());
    expect(host().sceneId()).toBe("engine-yard");
    rt.unload();
    expect(host().sceneId()).toBeNull();
    rt.destroy();
  });

  it("unload empties every table, and the scene loads again", () => {
    const rt = runtime();
    rt.load(engineYard());
    const loaded = rt.stats();
    steps(rt, 30, [press("right")]);

    const world = rt.ctx.physics!;
    rt.unload();
    expect(rt.stats()).toEqual(EMPTY);
    expect(rt.ctx.physics).toBeNull();
    expect(world.world.bodies.len()).toBe(0);
    expect(rt.get("lift")).toBeUndefined();
    expect(rt.scene()).toBeNull();
    expect(rt.snapshot()).toBeNull();
    expect(rt.step(DT, []).events).toEqual([]);

    expect(rt.load(engineYard()).ok).toBe(true);
    expect(rt.stats()).toEqual(loaded);
    expect(rt.step(DT, []).tick).toBe(0);
    rt.destroy();
  });

  it("rejects duplicate ids and unknown types before touching the current scene", () => {
    const rt = runtime();
    rt.load(engineYard());
    const before = rt.stats();
    expect(rt.load(scene([floor, { ...floor }]))).toEqual({
      ok: false,
      error: 'duplicate entity id "floor"',
      entityId: "floor",
    });
    expect(rt.load(scene([{ id: "c", type: "cloud", shape: box(0, 0, 1, 1) }]))).toEqual({
      ok: false,
      error: 'unknown type "cloud"',
      entityId: "c",
    });
    expect(rt.stats()).toEqual(before);
    rt.destroy();
  });

  it("reports the entity that failed to spawn and leaves the runtime empty", () => {
    const rt = runtime();
    const report = rt.load(
      scene([
        floor,
        {
          id: "stuck",
          type: "follower",
          shape: box(0, 0, 10, 5),
          path: { pts: [[0, 0]], mode: "loop", speed: 10 },
        },
      ]),
    );
    expect(report).toMatchObject({ ok: false, entityId: "stuck" });
    expect(rt.stats()).toEqual(EMPTY);
    rt.destroy();
  });

  it("two runtimes alive at once share no state", () => {
    const a = runtime();
    const b = runtime(null);
    a.load(engineYard());
    b.load(scene([floor]));
    expect(a.stats().tags).toBe(8);
    expect(b.stats().tags).toBe(1);

    a.unload();
    expect(a.stats()).toEqual(EMPTY);
    expect(b.stats()).toMatchObject({ bodies: 1, tags: 1, entities: 1 });
    expect(b.step(DT, []).game).toBeNull();
    a.destroy();
    b.destroy();
  });

  it("re-sorts a hand-built scene by spawn group, keeping file order inside one", () => {
    const rt = runtime();
    const yard = engineYard();
    yard.entities.reverse();
    expect(rt.load(yard).ok).toBe(true);
    const handle = (id: string) => handleOf(rt, id);
    expect(handle("~solid:2")).toBeLessThan(handle("~solid:0"));
    expect(handle("~solid:0")).toBeLessThan(handle("zone"));
    expect(handle("zone")).toBeLessThan(handle("lift"));
    rt.destroy();
  });

  it("refuses a registry built from another game", () => {
    const registry = createRegistry();
    expect(() => createSceneRuntime({ rapier, view: null, registry, game: testGame })).toThrow(
      /not built from game "test-game"/,
    );
  });
});

describe("primitive systems", () => {
  it("tags colliders with type, material, tags and the one-way flag, never the material's impulse", () => {
    const game = defineGame({
      id: "mat",
      types: [],
      actions: [],
      materials: {
        ice: { friction: 0.02, restitution: 0, impulse: { x: 0, y: -5 }, description: "" },
      },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const rt = runtime(game);
    rt.load(
      scene([
        { id: "~solid:ice:0", type: "solid", shape: box(0, 0, 10, 10), material: "ice" },
        ...engineYard().entities.filter((e) => e.id === "ledge" || e.id === "zone"),
      ]),
    );
    const tagOf = (id: string) => rt.ctx.tags.get(handleOf(rt, id));
    expect(tagOf("~solid:ice:0")).toEqual({
      entityId: "~solid:ice:0",
      type: "solid",
      material: "ice",
    });
    expect(tagOf("ledge")).toEqual({
      entityId: "ledge",
      type: "solid",
      oneWay: true,
      oneWaySide: "up",
    });
    expect(tagOf("zone")).toEqual({ entityId: "zone", type: "sensor", tags: ["goal"] });
    const ice = rt.ctx.physics!.world.getCollider(handleOf(rt, "~solid:ice:0"))!;
    expect(ice.friction()).toBeCloseTo(0.02, 6);
    rt.destroy();
  });

  it("loads decor headless with a pose, no body and nothing in the physics world", () => {
    const lamp: RuntimeEntity = {
      id: "lamp",
      type: "decor",
      at: [40, -30],
      behaviors: { sprite: {} },
    };
    const bare = runtime(null);
    bare.load(scene([floor]));
    const rt = runtime(null);
    expect(rt.load(scene([floor, lamp]))).toMatchObject({
      ok: true,
      counts: { solid: 1, decor: 1 },
    });
    const { bodies, colliders, tags } = bare.stats();
    expect(rt.stats()).toMatchObject({ bodies, colliders, tags, entities: 2 });
    expect(rt.stats().perType).toEqual({ solid: 1, decor: 1 });
    expect(rt.ctx.physics!.world.bodies.len()).toBe(bare.ctx.physics!.world.bodies.len());
    expect(rt.ctx.poses.get("lamp")).toEqual({ x: 40, y: -30, rot: 0 });
    expect(rt.get("lamp")?.type).toBe("decor");

    expect(rt.update([{ ...lamp, at: [50, -20] }]).ok).toBe(true);
    expect(rt.ctx.poses.get("lamp")).toEqual({ x: 50, y: -20, rot: 0 });
    rt.remove(["lamp"]);
    expect(rt.stats()).toEqual(bare.stats());
    bare.destroy();
    rt.destroy();
  });

  it("draws an engine visual on the layer its entity names, ordered by its z", () => {
    const recording = recordingView({ sprites: true });
    const rt = createSceneRuntime({ rapier, view: recording.view, game: null });
    rt.load(
      scene([
        floor,
        { id: "zone", type: "sensor", shape: box(0, 0, 5, 5), layer: "decor", z: 4 },
        { id: "lamp", type: "decor", at: [0, 0], z: -2, behaviors: { sprite: {} } },
      ]),
    );
    const layers = rt.ctx.registry.layers;
    const draw = (name: string) => layers.find((l) => l.name === name)!.draw;
    expect(recording.live.get("floor")).toMatchObject({ layer: "terrain" });
    expect(recording.live.get("floor")?.depth).toBeUndefined();
    expect(recording.live.get("zone")).toMatchObject({ layer: draw("decor"), depth: 4 });
    expect(recording.live.get("lamp")).toBeUndefined();
    expect(recording.live.get("lamp#sprite")).toMatchObject({ layer: draw("gameplay"), depth: -2 });
    rt.destroy();
  });

  it("a game type on a base primitive gets its own system instance", () => {
    const game = defineGame({
      id: "based",
      types: [
        {
          type: "goal",
          description: "A goal.",
          base: "sensor",
          fields: { shape: shapeField("Trigger.") },
        },
      ],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    });
    const rt = runtime(game);
    rt.load(scene([{ id: "g", type: "goal", shape: box(0, 0, 5, 5) }]));
    expect(rt.ctx.system("goal")).toBeDefined();
    expect(rt.ctx.system("goal")).not.toBe(rt.ctx.system("sensor"));
    expect(rt.stats().perType).toEqual({ goal: 1 });
    expect(rt.ctx.tags.get(handleOf(rt, "g"))?.type).toBe("goal");
    rt.destroy();
  });

  it("gates one-way solids for an actor and applies the type's surface defaults", () => {
    const game = defineGame({
      id: "clouds",
      types: [
        {
          type: "cloud",
          description: "A one-way platform.",
          fields: { shape: shapeField("Box.") },
          system: (ctx, t) =>
            createSolidSystem(ctx, t, { friction: 0.7, restitution: 0, oneWay: true }),
        },
      ],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    });
    const rt = runtime(game);
    rt.load(scene([{ id: "c", type: "cloud", shape: box(0, 1, 0.5, 0.06) }, floor]));
    const clouds = rt.ctx.system<SolidSystem>("cloud")!;
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    expect(rt.ctx.tags.get(handleOf(rt, "c"))).toMatchObject({ oneWay: true });
    expect(bodyOf(rt, "c").collider(0).friction()).toBeCloseTo(0.7, 6);

    // The cloud's top is at 0.94 m; it holds an actor whose feet are within 0.04 m below it.
    clouds.gateOneWay(0.97, false);
    expect(clouds.isHidden("c")).toBe(false);
    clouds.gateOneWay(0.99, false);
    expect(clouds.isHidden("c")).toBe(true);
    expect(clouds.position("c")?.x).toBe(0);
    expect(clouds.position("c")?.y).toBeCloseTo(-999.99, 3);
    clouds.gateOneWay(0.5, true);
    expect(clouds.isHidden("c")).toBe(true);
    clouds.gateOneWay(0.5, false);
    expect(clouds.position("c")?.x).toBe(0);
    expect(clouds.position("c")?.y).toBeCloseTo(1, 6);

    solids.gateOneWay(1000, false);
    expect(solids.isHidden("floor")).toBe(false);
    rt.destroy();
  });

  it("world gravity comes from the scene's settings", () => {
    const rt = runtime();
    rt.load(
      scene(
        [{ id: "avatar", type: "prop", shape: box(0, 0, 5, 5), density: 1, restitution: 0 }],
        [0, 0],
      ),
    );
    expect(rt.ctx.gravity).toEqual({ x: 0, y: 0 });
    expect(rt.ctx.settings.gravity).toEqual([0, 0]);
    steps(rt, 30);
    expect(bodyOf(rt, "avatar").translation()).toEqual({ x: 0, y: 0 });

    rt.load(
      scene([{ id: "avatar", type: "prop", shape: box(0, 0, 5, 5), density: 1, restitution: 0 }]),
    );
    expect(rt.ctx.physics!.world.gravity).toMatchObject({ x: 0, y: 1200 });
    steps(rt, 30);
    expect(bodyOf(rt, "avatar").translation().y).toBeGreaterThan(0);
    rt.destroy();
  });

  it("leaves props at their authored pose after load", () => {
    const rt = runtime();
    rt.load(engineYard());
    const crate = bodyOf(rt, "crate").translation();
    expect(crate.x).toBeCloseTo(12, 5);
    expect(crate.y).toBeCloseTo(9.4, 5);
    rt.destroy();
  });

  it("moves followers along their path and reports the frame delta", () => {
    const rt = runtime();
    rt.load(engineYard());
    const lift = rt.ctx.system<FollowerSystem>("follower")!;
    steps(rt, 60);
    expect(bodyOf(rt, "lift").translation().y).toBeCloseTo(8.2, 5);
    expect(lift.position("lift")?.x).toBe(17);
    expect(lift.frameDelta("lift")?.y).toBeCloseTo(-0.8 / 60, 6);
    expect(lift.frameDelta("nope")).toBeNull();
    rt.destroy();
  });
});

describe("the runtime's clock", () => {
  const atRate = (rate: number) =>
    createSceneRuntime({
      rapier,
      view: null,
      game: defineGame({
        id: `clock-${rate}`,
        types: [],
        actions: [],
        time: { kind: "fixed", rate },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    });

  it("steps a 30 Hz game's world 1/30 s per tick", () => {
    const rt = atRate(30);
    expect(rt.ctx.time.tickMs).toBeCloseTo(1000 / 30, 9);
    rt.load(scene([]));
    expect(rt.ctx.physics!.world.timestep).toBe(Math.fround(1 / 30));
    rt.destroy();
  });

  it("keeps the 60 Hz step a game without a time model always had", () => {
    const rt = runtime(null);
    rt.load(scene([]));
    expect(rt.ctx.physics!.world.timestep).toBe(Math.fround(1 / 60));
    rt.destroy();
  });

  it("a follower covers the same distance per wall second at 30 and 60 Hz", () => {
    const seekY = (rate: number) => {
      const rt = atRate(rate);
      rt.load(engineYard());
      rt.ctx.system<FollowerSystem>("follower")!.seek?.(1000);
      const y = rt.ctx.system<FollowerSystem>("follower")!.position("lift")!.y;
      rt.destroy();
      return y;
    };
    const stepY = (rate: number) => {
      const rt = atRate(rate);
      rt.load(engineYard());
      for (let i = 0; i < rate; i++) rt.step(rt.ctx.time.tickMs, []);
      const y = rt.ctx.system<FollowerSystem>("follower")!.position("lift")!.y;
      rt.destroy();
      return y;
    };
    expect(seekY(30)).toBeCloseTo(seekY(60), 6);
    expect(stepY(30)).toBeCloseTo(stepY(60), 6);
    expect(seekY(60)).toBeCloseTo(stepY(60), 6);
    expect(seekY(60)).toBeLessThan(9);
  });
});

describe("SceneRuntime step", () => {
  it("emits sensor:enter and sensor:exit naming the sensor and what crossed it", () => {
    const rt = runtime();
    rt.load(engineYard());
    const events = steps(rt, 240, [press("right")]).flatMap((r) => r.events);
    const crossings = events.filter((e) => e.entityId === "zone" && e.type.startsWith("sensor:"));
    expect(crossings.map((e) => [e.type, e.other])).toEqual([
      [SENSOR_ENTER, "avatar"],
      [SENSOR_EXIT, "avatar"],
    ]);
    expect(crossings[0]!.at.x).toBeGreaterThan(8.4);
    expect(crossings[0]!.tick).toBeLessThan(crossings[1]!.tick);
    rt.destroy();
  });

  it("raises no sensor events for groups the registry doesn't link", () => {
    const rt = runtime(null);
    rt.load(engineYard());
    const avatar = bodyOf(rt, "avatar");
    avatar.setTranslation({ x: 9, y: 9.4 }, true);
    expect(steps(rt, 10).flatMap((r) => r.events)).toEqual([]);
    rt.destroy();
  });

  it("returns the game's snapshot each tick", () => {
    const rt = runtime();
    rt.load(engineYard());
    const results = steps(rt, 30, [press("right")]);
    const last = results.at(-1)!.game as TestGameSnapshot;
    expect(last?.position.x).toBeGreaterThan(3);
    expect(rt.snapshot()).toEqual(last);
    expect(results.map((r) => r.tick)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    rt.destroy();
  });

  it("runs hooks in order and lists engine events before the game's", () => {
    const log: string[] = [];
    const game = defineGame({
      id: "order",
      types: [
        {
          type: "probe",
          description: "Logs its hooks.",
          fields: { label: z.string().optional().describe("Unused.") },
          system: (ctx) => ({
            spawn: () => log.push("spawn"),
            despawn: () => {},
            clear: () => log.push(`clear tags=${ctx.tags.size}`),
            size: () => 0,
            beforeStep: () => log.push("system.beforeStep"),
            afterStep: () => {
              log.push("system.afterStep");
              ctx.emit({ type: "from-system", at: { x: 0, y: 0 } });
            },
          }),
        },
      ],
      actions: [],
      createRuntime: (ctx) => ({
        onLoad: () => log.push(`onLoad tags=${ctx.tags.size}`),
        onUnload: () => log.push(`onUnload tags=${ctx.tags.size}`),
        beforeStep: () => {
          log.push(`game.beforeStep tick=${ctx.tick}`);
          ctx.emit({ type: "from-game", at: { x: 0, y: 0 } });
        },
        afterStep: (_dt, events) =>
          log.push(`game.afterStep ${events.map((e) => e.type).join(",")}`),
        snapshot: () => log.length,
      }),
    });
    const rt = runtime(game);
    rt.load(scene([floor, { id: "p", type: "probe" }]));
    const result = rt.step(DT, []);
    rt.unload();

    expect(log).toEqual([
      "clear tags=0",
      "spawn",
      "onLoad tags=1",
      "system.beforeStep",
      "game.beforeStep tick=0",
      "system.afterStep",
      "game.afterStep from-system,from-game",
      "onUnload tags=1",
      "clear tags=1",
    ]);
    expect(result.events).toEqual([
      { type: "from-system", at: { x: 0, y: 0 }, tick: 0 },
      { type: "from-game", at: { x: 0, y: 0 }, tick: 0 },
    ]);
    rt.destroy();
  });
});

const entry = (id: string, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 0, by: "test" },
});

/** A test-game project: one game-settings asset and two decks of the card table. */
function testProject(
  game: Record<string, unknown>,
  engine: Record<string, unknown> = {},
): ProjectRuntimeView {
  const entries = [
    entry("settings", "game-settings", "settings.json"),
    entry("deck-b", "data-table", "data/b.json"),
    entry("deck-a", "data-table", "data/a.json"),
  ];
  const view: ProjectView = {
    state: {
      meta: { projectId: "test", layout: 1, name: "Test" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    byId: new Map(entries.map((e) => [e.id, e])),
    byPath: new Map(entries.map((e) => [e.path, e])),
    byKey: new Map(entries.map((e) => [e.key, e])),
    deleted: [],
    issues: [],
    repairs: new Map(),
    tree: () => [],
  };
  const deck = (...rows: Record<string, unknown>[]) => ({
    kind: "data-table",
    v: 1,
    table: CARD_TABLE,
    rows,
  });
  const values = new Map<string, unknown>([
    ["settings", { kind: "game-settings", v: 1, engine, game }],
    ["deck-a", deck({ id: "fireball", cost: 3, damage: 5 }, { id: "heal", cost: 2 })],
    ["deck-b", deck({ id: "bolt", cost: 1 }, { id: "heal", cost: 9 }, { id: "bad" })],
  ]);
  return runtimeView(view, values, createRegistry(testGame));
}

describe("EngineContext.project", () => {
  it("is null for a run with no project", () => {
    const rt = runtime();
    expect(rt.ctx.project).toBeNull();
    rt.destroy();
  });

  it("a test-game run reads a table and a setting", () => {
    const project = testProject({ avatarSpeed: 120, title: "Deck" });
    const seen: unknown[] = [];
    const reading = defineGame({
      ...testGame,
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          onLoad(loaded) {
            inner.onLoad?.(loaded);
            seen.push(ctx.project?.settings.title, ctx.project?.table(CARD_TABLE));
          },
        };
      },
    });
    const rt = createSceneRuntime({ rapier, view: null, game: reading, project });
    rt.load(engineYard());
    expect(seen).toEqual([
      "Deck",
      [
        { id: "fireball", cost: 3, damage: 5 },
        { id: "heal", cost: 2, damage: 0 },
        { id: "bolt", cost: 1, damage: 0 },
      ],
    ]);
    const last = steps(rt, 30, [press("right")]).at(-1)!.game as TestGameSnapshot;
    expect(last!.velocity.x).toBeGreaterThan(60);
    expect(last!.velocity.x).toBeLessThanOrEqual(120);
    rt.destroy();
  });

  it("applies the game's settings defaults and freezes what it hands out", () => {
    const project = testProject({});
    expect(project.settings).toEqual({ avatarSpeed: AVATAR_SPEED });
    expect(Object.isFrozen(project.settings)).toBe(true);
    const rows = project.table(CARD_TABLE);
    expect(Object.isFrozen(rows) && Object.isFrozen(rows[0])).toBe(true);
    expect(project.table("unknown")).toEqual([]);
    const fallback = testProject({ avatarSpeed: -1, title: "Kept" });
    expect(fallback.settings).toEqual({ avatarSpeed: AVATAR_SPEED, title: "Kept" });
    const walk = (rt: ReturnType<typeof runtime>) => {
      rt.load(engineYard());
      const out = steps(rt, 30, [press("right")]).map((r) => r.game);
      rt.destroy();
      return out;
    };
    expect(walk(createSceneRuntime({ rapier, view: null, game: testGame, project }))).toEqual(
      walk(runtime()),
    );
  });

  it("copies and freezes the settings doc's engine block", () => {
    const engine = { resolution: { height: 360, sampling: "nearest" } };
    const project = testProject({}, engine);
    expect(project.engine).toEqual(engine);
    expect(project.engine).not.toBe(engine);
    expect(Object.isFrozen(project.engine)).toBe(true);
    expect(Object.isFrozen(project.engine.resolution)).toBe(true);
    engine.resolution.height = 720;
    expect(project.engine).toEqual({ resolution: { height: 360, sampling: "nearest" } });
    expect(testProject({}).engine).toEqual({});
  });
});

describe("SceneRuntime poses", () => {
  const crate: RuntimeEntity = {
    id: "crate",
    type: "prop",
    shape: box(100, -50, 10, 10),
    density: 1,
    restitution: 0,
  };

  it("poses entities on load, add and update, snapped to their spawn pose", () => {
    const rt = runtime(null);
    rt.load(scene([floor, { id: "start", type: "marker", at: [5, 6] }]));
    expect(rt.ctx.poses.get("floor")).toEqual({ x: 0, y: 20, rot: 0 });
    expect(rt.ctx.poses.get("start")).toEqual({ x: 5, y: 6, rot: 0 });

    steps(rt, 3);
    expect(rt.add([crate]).ok).toBe(true);
    expect(rt.ctx.poses.get("crate")).toEqual({ x: 100, y: -50, rot: 0 });
    steps(rt, 5);
    expect(rt.ctx.poses.get("crate")!.y).toBeGreaterThan(-50);

    expect(rt.update([{ ...crate, shape: box(300, -80, 10, 10) }]).ok).toBe(true);
    expect(rt.ctx.poses.get("crate")).toEqual({ x: 300, y: -80, rot: 0 });
    expect(rt.ctx.poses.prev("crate")).toEqual({ x: 300, y: -80, rot: 0 });
    expect(rt.update([{ id: "start", type: "marker", at: [7, 8] }]).ok).toBe(true);
    expect(rt.ctx.poses.get("start")).toEqual({ x: 7, y: 8, rot: 0 });
    expect(rt.ctx.poses.size).toBe(3);
    rt.destroy();
  });

  it("removes a pose on despawn and every pose on unload", () => {
    const rt = runtime(null);
    rt.load(scene([floor, crate]));
    rt.remove(["crate"]);
    expect(rt.ctx.poses.has("crate")).toBe(false);
    expect([...rt.ctx.poses.ids()]).toEqual(["floor"]);
    rt.unload();
    expect(rt.ctx.poses.size).toBe(0);
    rt.load(scene([floor]));
    expect(rt.ctx.poses.size).toBe(1);
    rt.destroy();
    expect(rt.ctx.poses.size).toBe(0);
  });

  it("leaves no pose behind for a load or an add that fails", () => {
    const rt = runtime(null);
    const bad: RuntimeEntity = {
      id: "bad",
      type: "follower",
      shape: box(0, 0, 4, 4),
      path: { pts: [[0, 0]], mode: "loop", speed: 1 },
    };
    expect(rt.load(scene([floor, bad])).ok).toBe(false);
    expect(rt.ctx.poses.size).toBe(0);
    rt.load(scene([floor]));
    expect(rt.add([crate, bad]).ok).toBe(false);
    expect([...rt.ctx.poses.ids()]).toEqual(["floor"]);
    rt.load(scene([floor, crate]));
    expect(
      rt.update([
        { ...crate, shape: box(0, 0, 1, 1) },
        { ...bad, id: "floor" },
      ]).ok,
    ).toBe(false);
    expect(rt.ctx.poses.get("floor")).toEqual({ x: 0, y: 20, rot: 0 });
    expect(rt.ctx.poses.get("crate")).toEqual({ x: 100, y: -50, rot: 0 });
    rt.destroy();
  });
});

describe("physics per load", () => {
  /** `rapier` with a count of the worlds made from it. */
  function counted() {
    const made = { worlds: 0 };
    class World extends rapier.World {
      constructor(...args: ConstructorParameters<typeof rapier.World>) {
        super(...args);
        made.worlds++;
      }
    }
    return { module: { ...rapier, World } as RapierModule, made };
  }

  const free = (entities: RuntimeEntity[]): ExpandedScene => ({
    ...scene(entities),
    settings: { ...scene(entities).settings, physics: "none" },
  });

  const zone: RuntimeEntity = { id: "zone", type: "sensor", shape: box(50, 0, 10, 10) };
  const start: RuntimeEntity = { id: "start", type: "marker", at: [5, 6] };
  const lift: RuntimeEntity = {
    id: "lift",
    type: "follower",
    shape: box(0, 0, 20, 4),
    path: {
      pts: [
        [0, 100],
        [0, 0],
      ],
      mode: "loop",
      speed: 60,
    },
  };

  it("makes no world for a scene without physics", () => {
    const { module, made } = counted();
    const rt = createSceneRuntime({ rapier: module, view: null, game: null });
    expect(rt.load(free([floor, zone, start])).ok).toBe(true);
    expect(rt.ctx.physics).toBeNull();
    expect(rt.ctx.rapier).toBeNull();
    expect(made.worlds).toBe(0);
    expect(rt.stats()).toMatchObject({ backend: "geometry", bodies: 2, colliders: 2, entities: 3 });
    rt.destroy();
  });

  it("keeps one world across two Rapier loads, emptied between them", () => {
    const { module, made } = counted();
    const rt = createSceneRuntime({ rapier: module, view: null, game: null });
    expect(made.worlds).toBe(0);
    rt.load(scene([floor]));
    const world = rt.ctx.physics;
    expect(world).not.toBeNull();
    expect(rt.ctx.rapier).toBe(module);
    rt.load(scene([floor, zone], [0, 300]));
    expect(rt.ctx.physics).toBe(world);
    expect(world!.world.bodies.len()).toBe(2);
    expect(world!.world.gravity).toMatchObject({ x: 0, y: 300 });
    expect(made.worlds).toBe(1);
    rt.destroy();
  });

  it("runs Rapier, then none, then Rapier on the same world", () => {
    const { module, made } = counted();
    const rt = createSceneRuntime({ rapier: module, view: null, game: null });
    rt.load(scene([floor, zone]));
    const world = rt.ctx.physics!;
    const handles = rt.stats();

    expect(rt.load(free([floor, zone, start])).ok).toBe(true);
    expect(rt.ctx.physics).toBeNull();
    expect(world.world.bodies.len()).toBe(0);
    expect(rt.stats().backend).toBe("geometry");
    steps(rt, 3);

    expect(rt.load(scene([floor, zone])).ok).toBe(true);
    expect(rt.ctx.physics).toBe(world);
    expect(rt.stats()).toEqual(handles);
    expect(made.worlds).toBe(1);
    rt.destroy();
  });

  it("loads and steps a scene of markers, sensors, solids and followers with no Rapier", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    expect(rt.load(free([floor, zone, start, lift]))).toEqual({
      ok: true,
      counts: { solid: 1, sensor: 1, marker: 1, follower: 1 },
      ms: 0,
    });
    expect(rt.ctx.poses.get("zone")).toEqual({ x: 50, y: 0, rot: 0 });
    expect(rt.ctx.poses.get("lift")).toEqual({ x: 0, y: 100, rot: 0 });
    const results = steps(rt, 30);
    expect(results.at(-1)?.tick).toBe(29);
    expect(rt.ctx.poses.get("lift")!.y).toBeCloseTo(100 - 60 * (30 / 60), 6);
    expect(rt.ctx.system<FollowerSystem>("follower")!.frameDelta("lift")!.y).toBeCloseTo(-1, 6);
    expect(rt.stats()).toMatchObject({ backend: "geometry", entities: 4, tags: 3 });
    rt.remove(["zone"]);
    expect(rt.stats().perType).toEqual({ solid: 1, marker: 1, follower: 1 });
    rt.destroy();
  });

  it("fails a load with physics-required on a prop in a scene without physics", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: null });
    const crate: RuntimeEntity = {
      id: "crate",
      type: "prop",
      shape: box(0, 0, 5, 5),
      density: 1,
      restitution: 0,
    };
    expect(rt.load(free([floor, crate]))).toMatchObject({
      ok: false,
      reason: "physics-required",
      entityId: "crate",
    });
    expect(rt.scene()).toBeNull();
    expect(rt.stats()).toMatchObject({ entities: 0, bodies: 0 });
    expect(rt.ctx.poses.size).toBe(0);
    rt.destroy();
  });

  it("fails a load with physics-required on an attach in a scene without physics", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    const rider: RuntimeEntity = { ...zone, attach: "lift" };
    expect(rt.load(free([lift, rider]))).toMatchObject({
      ok: false,
      reason: "physics-required",
      entityId: "zone",
    });
    expect(rt.ctx.poses.size).toBe(0);
    rt.destroy();
  });

  it("puts solids, sensors and followers in a geometry world, emptied between loads", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: null });
    expect(rt.ctx.geometry).toBeNull();
    rt.load(free([floor, zone, start, lift]));
    const geometry = rt.ctx.geometry!;
    expect(geometry).not.toBeNull();
    expect(rt.ctx.space.backend).toBe("geometry");
    expect(geometry.size).toBe(3);
    expect(rt.stats()).toMatchObject({ backend: "geometry", bodies: 3, colliders: 3, tags: 3 });
    expect(rt.ctx.tags.get(handleOf(rt, "zone"))).toEqual({ entityId: "zone", type: "sensor" });

    rt.load(free([floor, zone]));
    expect(rt.ctx.geometry).toBe(geometry);
    expect(geometry.size).toBe(2);

    rt.load(scene([floor, zone]));
    expect(rt.ctx.geometry).toBeNull();
    expect(rt.ctx.space.backend).toBe("rapier");
    expect(geometry.size).toBe(0);
    expect(rt.stats()).toMatchObject({ backend: "rapier", bodies: 2, colliders: 2 });

    rt.load(free([zone]));
    expect(rt.ctx.geometry).toBe(geometry);
    rt.unload();
    expect(rt.ctx.geometry).toBeNull();
    expect(geometry.size).toBe(0);
    rt.destroy();
  });

  it("moves a follower's geometry collider along its path each tick", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    rt.load(free([lift]));
    const handle = handleOf(rt, "lift");
    const at = () => rt.ctx.geometry!.shape(handle) as Extract<ShapeObj, { type: "box" }>;
    expect(at()).toMatchObject({ cx: 0, cy: 100, hw: 20, hh: 4 });
    steps(rt, 30);
    expect(at().cy).toBeCloseTo(rt.ctx.poses.get("lift")!.y, 6);
    expect(at().cy).toBeCloseTo(70, 6);
    rt.remove(["lift"]);
    expect(rt.ctx.geometry!.size).toBe(0);
    expect(rt.ctx.tags.size).toBe(0);
    rt.destroy();
  });

  it("gates a one-way solid in the geometry world by disabling its collider", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    const ledge: RuntimeEntity = {
      id: "ledge",
      type: "solid",
      shape: box(0, 0, 50, 5),
      oneWay: true,
    };
    rt.load(free([ledge]));
    expect(rt.ctx.tags.get(handleOf(rt, "ledge"))).toMatchObject({ oneWay: true });
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    const probe = box(0, 0, 2, 2);
    expect(rt.ctx.space.overlaps(probe).map((h) => h.tag.entityId)).toEqual(["ledge"]);

    solids.gateOneWay(20, false);
    expect(solids.isHidden("ledge")).toBe(true);
    expect(rt.ctx.space.overlaps(probe)).toEqual([]);

    solids.gateOneWay(-10, false);
    expect(solids.isHidden("ledge")).toBe(false);
    expect(rt.ctx.space.overlaps(probe)).toHaveLength(1);

    solids.gateOneWay(-10, true);
    expect(solids.isHidden("ledge")).toBe(true);
    rt.ctx.system<SolidSystem>("solid")!.reset!();
    expect(solids.isHidden("ledge")).toBe(false);
    rt.destroy();
  });

  it("raises sensor events from geometry overlaps in a scene without physics", () => {
    const linked = defineGame({
      id: "linked",
      types: [],
      actions: [],
      collisionGroups: { static: { collidesWith: ["sensor"] } },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const rt = createSceneRuntime({ rapier: null, view: null, game: linked });
    const gate: RuntimeEntity = { id: "gate", type: "sensor", shape: box(0, 50, 30, 5) };
    rt.load(free([lift, gate]));
    const events = steps(rt, 120).flatMap((r) => r.events);
    expect(events.map((e) => [e.type, e.entityId, e.other])).toEqual([
      [SENSOR_ENTER, "gate", "lift"],
      [SENSOR_EXIT, "gate", "lift"],
    ]);
    expect(events[0]!.at.x).toBe(0);
    rt.destroy();
  });

  it("raises no geometry sensor events for groups the registry doesn't link", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    const gate: RuntimeEntity = { id: "gate", type: "sensor", shape: box(0, 50, 30, 5) };
    rt.load(free([lift, gate]));
    expect(steps(rt, 120).flatMap((r) => r.events)).toEqual([]);
    rt.destroy();
  });

  it("refuses a Rapier scene without the module, keeping what was loaded", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    rt.load(free([start]));
    expect(rt.load(scene([floor]))).toMatchObject({ ok: false, reason: "physics-not-loaded" });
    expect(rt.get("start")).toBeDefined();
    rt.destroy();
  });
});

describe("a disabled follower", () => {
  const path = (x: number): RuntimeEntity["path"] => ({
    pts: [
      [x, 100],
      [x, 0],
    ],
    mode: "ping_pong",
    speed: 60,
    pauseMs: 100,
  });
  const lift: RuntimeEntity = {
    id: "lift",
    type: "follower",
    shape: box(0, 0, 20, 4),
    path: path(0),
  };
  const twin: RuntimeEntity = { ...lift, id: "twin", path: path(200) };
  const rider: RuntimeEntity = {
    id: "rider",
    type: "sensor",
    shape: box(0, 90, 10, 4),
    attach: "lift",
  };
  const withPhysics = (physics: "rapier" | "none", entities: RuntimeEntity[]): ExpandedScene => ({
    ...scene(entities),
    settings: { ...scene(entities).settings, physics },
  });
  const hits = (rt: ReturnType<typeof runtime>, at: { x: number; y: number }) =>
    rt.ctx.space.overlaps(box(at.x, at.y, 2, 2), { sensors: true }).map((h) => h.tag.entityId);

  for (const physics of ["rapier", "none"] as const) {
    it(`leaves no collider while disabled and comes back in phase with its twin (${physics})`, () => {
      const rt = runtime(null);
      expect(rt.load(withPhysics(physics, [lift, twin])).ok).toBe(true);
      const followers = rt.ctx.system<FollowerSystem>("follower")!;
      steps(rt, 20);
      const before = rt.ctx.poses.get("lift")!;
      expect(hits(rt, before)).toEqual(["lift"]);

      rt.ctx.setEnabled("lift", false);
      expect(rt.ctx.enabled("lift")).toBe(false);
      expect(hits(rt, before)).toEqual([]);
      steps(rt, 97);
      expect(rt.ctx.poses.get("lift")).toEqual(before);
      expect(followers.frameDelta("lift")).toEqual({ x: 0, y: 0 });
      expect(hits(rt, { x: 0, y: rt.ctx.poses.get("twin")!.y })).toEqual([]);

      rt.ctx.setEnabled("lift", true);
      const now = rt.ctx.poses.get("twin")!;
      expect(rt.ctx.poses.get("lift")).toEqual({ ...now, x: now.x - 200 });
      expect(hits(rt, { x: 0, y: now.y })).toEqual(["lift"]);
      expect(followers.frameDelta("lift")).toEqual({ x: 0, y: 0 });

      steps(rt, 41);
      const later = rt.ctx.poses.get("twin")!;
      expect(rt.ctx.poses.get("lift")).toEqual({ ...later, x: later.x - 200 });
      expect(followers.frameDelta("lift")).toEqual(followers.frameDelta("twin"));
      expect(hits(rt, { x: 0, y: later.y })).toEqual(["lift"]);
      if (physics === "rapier") expect(bodyOf(rt, "lift").translation().y).toBe(later.y);
      rt.destroy();
    });
  }

  it("switches its riders' colliders off with its body and back on with it", () => {
    const rt = runtime(null);
    expect(rt.load(withPhysics("rapier", [lift, rider])).ok).toBe(true);
    const zone = () => hits(rt, rt.ctx.poses.get("rider")!).filter((id) => id === "rider");
    expect(zone()).toEqual(["rider"]);
    rt.ctx.setEnabled("lift", false);
    expect(rt.ctx.enabled("rider")).toBe(true);
    expect(zone()).toEqual([]);
    steps(rt, 30);
    rt.ctx.setEnabled("lift", true);
    expect(zone()).toEqual(["rider"]);
    expect(rt.ctx.poses.get("rider")!.y).toBeCloseTo(rt.ctx.poses.get("lift")!.y - 10, 6);
    rt.destroy();
  });
});

describe("game-code spawns of primitives", () => {
  const withGrid = (entities: RuntimeEntity[]): ExpandedScene => ({
    ...scene(entities, [0, 0]),
    settings: {
      gravity: [0, 0],
      physics: "none",
      grid: { kind: "square", cell: [10, 10] },
      view: { projection: "orthogonal" },
    },
  });

  it("take a scene file's shape tuples, and join queries at the next step without a refresh", () => {
    const rt = runtime(null);
    expect(rt.load(scene([floor])).ok).toBe(true);
    const refresh = vi.spyOn(rt.ctx.physics!, "refreshQueries");
    const ledge = rt.ctx.spawn({ type: "solid", shape: ["box", 300, -200, 40, 10] });
    expect(ledge).toMatchObject({ id: "solid#1", shape: box(300, -200, 40, 10) });
    expect(refresh).not.toHaveBeenCalled();
    expect(rt.ctx.tags.handlesOf("solid#1")).toHaveLength(1);
    rt.step(DT, []);
    expect(rt.ctx.space.overlaps(box(300, -200, 2, 2)).map((h) => h.tag.entityId)).toEqual([
      "solid#1",
    ]);
    expect(rt.stats().perType).toEqual({ solid: 2 });
    rt.destroy();
  });

  it("refuse a prop in a physics-free scene with physics-required, leaving nothing behind", () => {
    const rt = runtime(null);
    expect(rt.load({ ...scene([]), settings: { ...scene([]).settings, physics: "none" } }).ok).toBe(
      true,
    );
    const before = rt.stats();
    let code: string | undefined;
    try {
      rt.ctx.spawn({ type: "prop", shape: ["circle", 0, 0, 5], density: 1, restitution: 0 });
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe("physics-required");
    expect(rt.ctx.exists("prop#1")).toBe(false);
    expect(rt.stats()).toEqual(before);
    rt.destroy();
  });

  it("re-sync the grid's walls after an outside-step spawn and after the flush", () => {
    const rt = runtime(null);
    expect(rt.load(withGrid([])).ok).toBe(true);
    const occupancy = rt.ctx.grid!.occupancy;
    rt.ctx.spawn({ type: "solid", shape: ["box", 15, 15, 5, 5] });
    expect(occupancy.wall([1, 1])).toBe(true);
    rt.ctx.spawn({ type: "marker", at: [35, 35] });
    expect(occupancy.wall([3, 3])).toBe(false);

    const game = defineGame({
      id: "walls",
      types: [],
      actions: [],
      createRuntime: (ctx) => ({
        beforeStep() {
          if (ctx.tick === 0) {
            ctx.destroy("solid#1");
            ctx.spawn({ type: "solid", shape: ["box", 55, 15, 5, 5] });
          }
        },
        afterStep() {
          seen.push(occupancy2().wall([1, 1]), occupancy2().wall([5, 1]));
        },
        snapshot: () => null,
      }),
    });
    const seen: boolean[] = [];
    const rt2 = runtime(game);
    const occupancy2 = () => rt2.ctx.grid!.occupancy;
    expect(rt2.load(withGrid([{ id: "w", type: "solid", shape: box(15, 15, 5, 5) }])).ok).toBe(
      true,
    );
    rt2.ctx.destroy("w");
    expect(occupancy2().wall([1, 1])).toBe(false);
    rt2.ctx.spawn({ type: "solid", shape: ["box", 15, 15, 5, 5] });
    rt2.step(DT, []);
    expect(seen).toEqual([true, false]);
    expect(occupancy2().wall([1, 1])).toBe(false);
    expect(occupancy2().wall([5, 1])).toBe(true);
    rt.destroy();
    rt2.destroy();
  });
});

describe("EngineContext.input", () => {
  const inputGame = (log: unknown[]) =>
    defineGame({
      id: "input",
      types: [
        {
          type: "reader",
          description: "Reads the input state before the game does.",
          fields: {},
          system: (ctx) => ({
            spawn: () => {},
            despawn: () => {},
            clear: () => {},
            size: () => 0,
            beforeStep: () => log.push(["system", ctx.tick, ctx.input.held("jump")]),
          }),
        },
      ],
      actions: [
        { action: "jump", bindings: [{ device: "key", code: "Space" }], description: "Jump." },
        {
          action: "steer",
          kind: "axis",
          bindings: [{ device: "pad", axis: "left-x" }],
          description: "Steer.",
        },
        {
          action: "move",
          kind: "vector",
          bindings: [{ device: "pad", stick: "left" }],
          description: "Move.",
        },
      ],
      createRuntime: (ctx) => ({
        beforeStep: (_dt, actions) => {
          const i = ctx.input;
          log.push([
            "game",
            ctx.tick,
            actions.length,
            [0, 1].map((p) => [
              i.held("jump", p),
              i.pressed("jump", p),
              i.released("jump", p),
              i.value("steer", p),
              i.vector("move", p),
              i.pointer(p),
            ]),
          ]);
        },
        snapshot: () => null,
      }),
    });

  const act = (action: string, tick: number, fields: Partial<InputAction> = {}): InputAction => ({
    action,
    pressed: true,
    tick,
    timestamp: tick * DT,
    ...fields,
  });

  const ticks: TickInput[] = [
    {
      tick: 0,
      actions: [act("jump", 0), act("steer", 0, { value: -0.25 })],
      commands: [],
      pointers: [{ x: 1.5, y: -0.25, buttons: 1, over: true }],
      joins: [],
    },
    {
      tick: 1,
      actions: [act("move", 1, { x: 0.6, y: 0.8, player: 1 })],
      commands: [],
      pointers: [],
      joins: [],
    },
    { tick: 2, actions: [], commands: [], pointers: [], joins: [] },
    {
      tick: 3,
      actions: [act("jump", 3, { pressed: false }), act("jump", 3, { player: 1 })],
      commands: [],
      pointers: [undefined, { x: 0.0001, y: 2, buttons: 0, over: false }],
      joins: [],
    },
    {
      tick: 4,
      actions: [act("move", 4, { x: 0, y: 0, pressed: false, player: 1 })],
      commands: [],
      pointers: [],
      joins: [],
    },
  ];

  const play = (sequence: readonly TickInput[]) => {
    const log: unknown[] = [];
    const rt = runtime(inputGame(log));
    rt.load(scene([{ id: "r", type: "reader" }]));
    for (const t of sequence) rt.step(DT, t);
    rt.destroy();
    return log;
  };

  it("is updated from the tick's input before the systems' beforeStep", () => {
    const log = play(ticks);
    expect(log.filter((l) => (l as unknown[])[0] === "system")).toEqual([
      ["system", 0, true],
      ["system", 1, true],
      ["system", 2, true],
      ["system", 3, false],
      ["system", 4, false],
    ]);
    expect(log[1]).toEqual([
      "game",
      0,
      2,
      [
        [true, true, false, -0.25, { x: 0, y: 0 }, { x: 1.5, y: -0.25, buttons: 1, over: true }],
        [false, false, false, 0, { x: 0, y: 0 }, null],
      ],
    ]);
    expect(log[7]).toEqual([
      "game",
      3,
      2,
      [
        [false, false, true, -0.25, { x: 0, y: 0 }, { x: 1.5, y: -0.25, buttons: 1, over: true }],
        [true, true, false, 0, { x: 0.6, y: 0.8 }, { x: 0.0001, y: 2, buttons: 0, over: false }],
      ],
    ]);
  });

  it("is rebuilt identically from a recorded TickInput sequence", () => {
    const live = play(ticks);
    const recorded = JSON.parse(JSON.stringify(ticks)) as TickInput[];
    const replayed = play(
      recorded.map((t) => ({ ...t, pointers: t.pointers.map((p) => p ?? undefined) })),
    );
    expect(replayed).toEqual(live);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
  });

  it("reads 0.x action arrays as seat 0", () => {
    const log: unknown[] = [];
    const rt = runtime(inputGame(log));
    rt.load(scene([{ id: "r", type: "reader" }]));
    rt.step(DT, [act("jump", 0)]);
    expect(rt.ctx.input.pressed("jump")).toBe(true);
    rt.step(DT, []);
    expect([rt.ctx.input.pressed("jump"), rt.ctx.input.held("jump")]).toEqual([false, true]);
    rt.destroy();
  });
});

describe("tweens and anim plays code starts while a scene loads", () => {
  const atlasEntry = (id: string, kind: string, extra: Partial<AssetEntry>): AssetEntry => ({
    ...entry(id, kind, `${id}.${kind}`),
    ...extra,
  });
  const assets = [
    atlasEntry("tex", "texture", {
      sha256: "a".repeat(64),
      meta: { format: "png", width: 64, height: 16 },
    }),
    atlasEntry("sheet", "atlas", {
      sha256: "b".repeat(64),
      meta: {
        tool: "aseprite",
        frames: Object.fromEntries(
          [0, 1, 2, 3].map((i) => [`f${i}`, { x: i * 16, y: 0, w: 16, h: 16, durationMs: 100 }]),
        ),
        tags: [
          { name: "idle", from: 0, to: 1, direction: "forward" },
          { name: "run", from: 2, to: 3, direction: "forward" },
        ],
        slices: [],
        order: ["f0", "f1", "f2", "f3"],
      },
      import: { texture: "tex" },
    }),
  ];
  const view: ProjectView = {
    state: {
      meta: { projectId: "anim", layout: 1, name: "Anim" },
      assets: Object.fromEntries(assets.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    byId: new Map(assets.map((e) => [e.id, e])),
    byPath: new Map(assets.map((e) => [e.path, e])),
    byKey: new Map(assets.map((e) => [e.key, e])),
    deleted: [],
    issues: [],
    repairs: new Map(),
    tree: () => [],
  };

  /** A game whose `director` starts a tween and a clip on `hero` from its system's `ready`. */
  const directed = defineGame({
    id: "directed",
    types: [
      {
        type: "director",
        description: "Starts a tween and a clip on the hero when the scene is ready.",
        fields: {},
        system: (ctx) => ({
          spawn: () => {},
          despawn: () => {},
          clear: () => {},
          size: () => 0,
          ready: () => {
            ctx.tweens.to("hero", { to: { x: 4 }, duration: 4 });
            ctx.anim.play("hero", "run");
          },
        }),
      },
    ],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  });

  it("keeps them through the load's reset, as for an entity spawned later", () => {
    const project = runtimeView(view, new Map(), createRegistry(directed));
    const rt = createSceneRuntime({ rapier: null, view: null, game: directed, project });
    const report = rt.load({
      name: "directed",
      bounds: [-10, -10, 10, 10],
      settings: {
        gravity: [0, 0],
        physics: "none",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [
        {
          id: "hero",
          type: "marker",
          at: [0, 0],
          behaviors: {
            sprite: { asset: "sheet", frame: "f0" },
            anim: { source: "sheet", clip: "idle" },
          },
        },
        { id: "boss", type: "director" },
      ],
    });
    expect(report).toMatchObject({ ok: true });
    expect(rt.ctx.tweens.size).toBe(1);
    expect(rt.ctx.anim.state("hero")).toMatchObject({ clip: "run", frame: "f2" });
    rt.step(DT, []);
    expect(rt.ctx.poses.get("hero")!.x).toBe(1);
    expect(rt.ctx.anim.state("hero")).toMatchObject({ clip: "run", frame: "f2", playing: true });
    rt.destroy();
  });
});
