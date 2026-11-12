import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { GLOW, SPIN, testGame } from "../../__tests__/fixtures/test-game";
import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { mirrorField, pointField, shapeField, vectorField } from "../../game/fields";
import type { GameWorldDef, Registry } from "../../game/types";
import {
  behaviorBlocks,
  bulkId,
  bulkKeyType,
  defaultPhysics,
  expandScene,
  parseBulkId,
  resolveSettings,
  runtimeEntity,
  scenePhysics,
  settingsSources,
} from "../expand";
import { parseSceneOrThrow } from "../parse";
import { prefabLibrary } from "../prefab";
import { resolveSceneDetailed } from "../resolve";
import { parseShape } from "../shapes";
import { applyPt, applyVec, dihedral, type Dihedral } from "../transform";
import type {
  ExpandedScene,
  GridSettings,
  PathDef,
  Prefab,
  PrefabLibrary,
  Pt,
  RuntimeEntity,
  SceneDefinition,
  SceneSettings,
  ShapeObj,
} from "../types";
import { engine, engineYardText, fake, fakeGame } from "./fixtures/fake-game";
import door from "./fixtures/prefabs/door.json";
import gate from "./fixtures/prefabs/gate.json";
import room from "./fixtures/prefabs/room.json";
import {
  engineYard,
  fake as fakeOps,
  fakeYard,
  testGameRegistry,
  testGameYard,
  yardPrefabs,
} from "./fixtures/random-ops";

const yard = parseSceneOrThrow(engineYardText, engine);
const DEFAULTS = {
  gravity: [0, 12],
  physics: "rapier",
  grid: null,
  view: { projection: "orthogonal" },
};

describe("expandScene", () => {
  it("expands engine-yard in spawn-group order with bulk ids", () => {
    const scene = expandScene(yard, engine);
    expect(scene.name).toBe("engine-yard");
    expect(scene).not.toHaveProperty("game");
    expect(scene.bounds).toEqual([0, 0, 20, 10]);
    expect(scene.settings).toEqual(DEFAULTS);
    expect(scene.entities.map((e) => e.id)).toEqual([
      "~solid:0",
      "~solid:1",
      "~solid:2",
      "ledge",
      "zone",
      "start",
      "avatar",
      "crate",
      "lift",
    ]);
    const byId = Object.fromEntries(scene.entities.map((e) => [e.id, e]));
    expect(byId["~solid:0"]).toEqual({
      id: "~solid:0",
      type: "solid",
      shape: { type: "box", cx: 10, cy: 9.8, hw: 10, hh: 0.2, rotDeg: 0 },
    });
    expect(byId.ledge).toEqual({
      id: "ledge",
      type: "solid",
      shape: { type: "box", cx: 14, cy: 8, hw: 1.2, hh: 0.1, rotDeg: 0 },
      oneWay: true,
    });
    expect(byId.crate).toEqual({
      id: "crate",
      type: "prop",
      shape: { type: "circle", cx: 12, cy: 9.4, r: 0.2 },
      density: 2,
      restitution: 0.3,
    });
    expect(byId.lift).toEqual({
      id: "lift",
      type: "follower",
      shape: { type: "box", cx: 0, cy: 0, hw: 0.6, hh: 0.08, rotDeg: 0 },
      path: {
        pts: [
          [17, 9],
          [17, 6],
        ],
        mode: "ping_pong",
        speed: 0.8,
        pauseMs: 400,
      },
    });
    expect(byId.start).toEqual({ id: "start", type: "marker", at: [3, 9.6], tags: ["spawn"] });
    expect(byId.zone).toMatchObject({ tags: ["goal"] });
  });

  it("defaults the engine's settings and keeps a game's", () => {
    const bare: SceneDefinition = { v: 1, name: "x", bounds: [0, 0, 10, 10] };
    expect(expandScene(bare, engine).settings).toEqual(DEFAULTS);
    const def: SceneDefinition = { ...bare, game: "fake", settings: { lives: 3 } };
    expect(expandScene(def, fake)).toMatchObject({
      game: "fake",
      settings: { ...DEFAULTS, lives: 3 },
    });
  });

  it("does not alias the definition", () => {
    const before = structuredClone(yard);
    const byId = Object.fromEntries(expandScene(yard, engine).entities.map((e) => [e.id, e]));
    (byId.lift!.path as PathDef).pts[0]![0] = 0;
    (byId.start!.at as Pt)[0] = 0;
    expect(yard).toEqual(before);
  });

  it("puts bulk before entities within a group and drops off, notes and editor fields but layer", () => {
    const def: SceneDefinition = {
      v: 1,
      game: "fake",
      name: "x",
      bounds: [0, 0, 100, 100],
      "pad:mud": [["box", 9, 9, 1, 1]],
      pad: [["box", 8, 8, 1, 1]],
      solid: [["box", 0, 0, 1, 1]],
      flag: [[5, 5]],
      entities: [
        { id: "door", type: "door", shape: ["box", 3, 3, 1, 1], speed: 4 },
        {
          id: "late",
          type: "solid",
          name: "Late",
          layer: "terrain",
          group: "g",
          shape: ["box", 1, 1, 1, 1],
        },
        { id: "gone", type: "solid", off: true, shape: ["box", 2, 2, 1, 1] },
        { id: "memo", type: "note", at: [0, 0], text: "hi" },
        { id: "f", type: "flag", at: [6, 6] },
      ],
    };
    const scene = expandScene(def, fake);
    expect(scene.entities.map((e) => e.id)).toEqual([
      "~solid:0",
      "late",
      "~pad:0",
      "~pad:mud:0",
      "~flag:0",
      "f",
      "door",
    ]);
    expect(scene.entities[1]).toEqual({
      id: "late",
      type: "solid",
      layer: "terrain",
      shape: { type: "box", cx: 1, cy: 1, hw: 1, hh: 1, rotDeg: 0 },
    });
    expect(scene.entities[3]).toMatchObject({ type: "pad", material: "mud" });
    expect(scene.entities[4]).toEqual({ id: "~flag:0", type: "flag", at: [5, 5] });
  });

  it("refuses another game's scene and unregistered types", () => {
    expect(() => expandScene({ ...yard, game: "fake" }, engine)).toThrow(/for game "fake"/);
    const def: SceneDefinition = {
      ...yard,
      entities: [{ id: "x", type: "cloud", shape: ["box", 0, 0, 1, 1] }],
    };
    expect(() => expandScene(def, engine)).toThrow(/unregistered type "cloud"/);
  });
});

describe("settings resolution", () => {
  const bare: SceneDefinition = { v: 1, name: "x", bounds: [0, 0, 10, 10], game: "fake" };
  const square: GridSettings = { kind: "square", cell: [16, 16] };
  const hex: GridSettings = { kind: "hex", cell: [32, 28], side: 16, stagger: "x", index: "odd" };
  const withWorld = (world: GameWorldDef) => createRegistry(defineGame({ ...fakeGame, world }));
  const expandWith = (
    settings: SceneSettings | undefined,
    world: GameWorldDef | undefined,
    engineBlock?: Record<string, unknown>,
  ) =>
    expandScene(
      settings ? { ...bare, settings } : bare,
      world ? withWorld(world) : fake,
      engineBlock ? { engine: engineBlock } : {},
    ).settings;

  /** One value per source for each key; `undefined` where the key never reads that source. */
  const LADDER: Record<
    "gravity" | "physics" | "grid",
    { scene: unknown; project: unknown; game: unknown; engine: unknown }
  > = {
    gravity: { scene: [1, 2], project: [3, 4], game: [5, 6], engine: [0, 12] },
    physics: { scene: "none", project: "rapier", game: "none", engine: "rapier" },
    grid: { scene: square, project: undefined, game: hex, engine: null },
  };

  for (const [key, values] of Object.entries(LADDER)) {
    it(`resolves ${key} scene → project → game → engine, each position present or not`, () => {
      const order = ["scene", "project", "game"] as const;
      for (let mask = 0; mask < 8; mask++) {
        const has = (i: number) => (mask & (1 << i)) !== 0;
        const scene = has(0) ? { [key]: values.scene } : undefined;
        const project = has(1) ? { [key]: values.project ?? square } : undefined;
        const world = has(2) ? ({ [key]: values.game } as GameWorldDef) : undefined;
        const winner =
          order.find((from, i) => has(i) && values[from] !== undefined) ?? ("engine" as const);
        expect(expandWith(scene, world, project)[key], `${key} mask ${mask}`).toEqual(
          values[winner],
        );
      }
    });
  }

  it("never reads view from the project or the game", () => {
    const registry = createRegistry(
      defineGame({ ...fakeGame, world: { view: { projection: "other" } } as never }),
    );
    expect(
      expandScene(bare, registry, { engine: { view: { projection: "other" } } }).settings.view,
    ).toEqual({ projection: "orthogonal" });
  });

  it("resolves a gravity-less scene to the game's [0, 0]", () => {
    expect(expandWith(undefined, { gravity: [0, 0] }).gravity).toEqual([0, 0]);
    expect(expandWith({ lives: 3 }, { gravity: [0, 0] })).toEqual({
      ...DEFAULTS,
      gravity: [0, 0],
      lives: 3,
    });
  });

  it("lets the project block beat the game, and the scene beat both", () => {
    const world: GameWorldDef = { gravity: [0, 0], physics: "none" };
    const project = { gravity: [0, 300], physics: "rapier" };
    expect(expandWith(undefined, world, project)).toMatchObject({
      gravity: [0, 300],
      physics: "rapier",
    });
    expect(expandWith({ gravity: [10, 0], physics: "none" }, world, project)).toMatchObject({
      gravity: [10, 0],
      physics: "none",
    });
  });

  it("passes over a project value the setting's schema refuses", () => {
    const world: GameWorldDef = { gravity: [0, 0] };
    expect(expandWith(undefined, world, { gravity: "down", physics: "box2d" })).toMatchObject({
      gravity: [0, 0],
      physics: "rapier",
    });
  });

  it("clones what it takes from a source", () => {
    const gravity: Pt = [0, 0];
    const out = resolveSettings(undefined, { game: { gravity } });
    out.gravity[1] = 5;
    expect(gravity).toEqual([0, 0]);
  });

  it("builds its sources from the registry's world and the project's block", () => {
    expect(settingsSources(fake)).toEqual({ game: {} });
    const registry = withWorld({ gravity: [0, 0], physics: "none", grid: square, lengthUnit: 50 });
    expect(settingsSources(registry, { tickRate: 30 })).toEqual({
      project: { tickRate: 30 },
      game: { gravity: [0, 0], physics: "none", grid: square },
    });
  });

  it("scenePhysics and defaultPhysics follow the same order", () => {
    const none = withWorld({ physics: "none" });
    expect(defaultPhysics(fake)).toBe("rapier");
    expect(defaultPhysics(engine)).toBe("rapier");
    expect(defaultPhysics(none)).toBe("none");
    expect(defaultPhysics(none, { physics: "rapier" })).toBe("rapier");
    expect(defaultPhysics(fake, { physics: "none" })).toBe("none");
    expect(defaultPhysics(none, { physics: 3 })).toBe("none");
    expect(scenePhysics(bare, none)).toBe("none");
    expect(scenePhysics(bare, none, { physics: "rapier" })).toBe("rapier");
    expect(scenePhysics({ ...bare, settings: { physics: "rapier" } }, none)).toBe("rapier");
    expect(
      scenePhysics({ ...bare, settings: { physics: "none" } }, fake, { physics: "rapier" }),
    ).toBe("none");
  });
});

describe("bulk ids", () => {
  it("round-trips every registered bulk key", () => {
    for (const { key } of fake.bulkKeys)
      expect(parseBulkId(bulkId(key, 3))).toEqual({ key, index: 3 });
    expect(bulkId("solid:ice", 3)).toBe("~solid:ice:3");
    expect(parseBulkId("~solid:ice:3")).toEqual({ key: "solid:ice", index: 3 });
    expect(parseBulkId("~mud:0")).toEqual({ key: "mud", index: 0 });
  });

  it("rejects ids and malformed refs", () => {
    for (const ref of [
      "solid:0",
      "~solid",
      "~solid:",
      "~solid:01",
      "~solid:-1",
      "~solid:x",
      "~Solid:0",
      "~a:b:c:0",
      "~:0",
      "pit-shuttle",
    ]) {
      expect(parseBulkId(ref), ref).toBeNull();
    }
  });

  it("reads a bulk key's type without a registry", () => {
    expect(bulkKeyType("solid")).toBe("solid");
    expect(bulkKeyType("solid:ice")).toBe("solid");
    for (const b of fake.bulkKeys) expect(bulkKeyType(b.key)).toBe(b.type);
  });
});

const tests = createRegistry(testGame);
const NO_PLAY = { actions: [], createRuntime: () => ({ snapshot: () => null }) };

const scene = (entities: SceneDefinition["entities"], extra: Partial<SceneDefinition> = {}) =>
  ({
    v: 4,
    game: "test-game",
    name: "x",
    bounds: [0, 0, 1000, 1000],
    entities,
    ...extra,
  }) as SceneDefinition;

const byId = (entities: readonly RuntimeEntity[]) =>
  Object.fromEntries(entities.map((e) => [e.id, e]));

describe("expandScene: behaviors", () => {
  it("adds a required block at the type's defaults over the behavior's", () => {
    const [lamp] = expandScene(scene([{ id: "l", type: "lamp", at: [1, 2] }]), tests).entities;
    expect(lamp).toEqual({
      id: "l",
      type: "lamp",
      at: [1, 2],
      behaviors: { [GLOW.name]: { color: "#ffcc00", intensity: 2 } },
    });
  });

  it("merges behavior defaults, then the type's, then the entity's, in registration order", () => {
    const def = scene([
      {
        id: "l",
        type: "lamp",
        at: [0, 0],
        behaviors: { [SPIN.name]: {}, [GLOW.name]: { color: "#00ff00" } },
      },
      { id: "m", type: "marker", at: [0, 0], behaviors: { [SPIN.name]: { speed: 5 } } },
      { id: "g", type: "marker", at: [0, 0], behaviors: { [GLOW.name]: {} } },
    ]);
    const out = byId(expandScene(def, tests).entities);
    expect(Object.keys(out.l!.behaviors!)).toEqual([GLOW.name, SPIN.name]);
    expect(out.l!.behaviors).toEqual({
      [GLOW.name]: { color: "#00ff00", intensity: 2 },
      [SPIN.name]: { speed: 30 },
    });
    expect(out.m!.behaviors).toEqual({ [SPIN.name]: { speed: 5 } });
    expect(out.g!.behaviors).toEqual({ [GLOW.name]: { color: "#ffcc00", intensity: 1 } });
  });

  it("leaves behaviors off when none apply, dropping unknown and forbidden blocks", () => {
    const def = scene([
      { id: "m", type: "marker", at: [0, 0] },
      { id: "p", type: "plain", at: [0, 0], behaviors: { [GLOW.name]: {} } },
      { id: "u", type: "marker", at: [0, 0], behaviors: { "test-game/nope": {} } },
    ]);
    for (const e of expandScene(def, tests).entities) expect(e).not.toHaveProperty("behaviors");
  });

  it("does not alias the type's defaults or the entity's block", () => {
    const def = scene([{ id: "l", type: "lamp", at: [0, 0], behaviors: { [GLOW.name]: {} } }]);
    const first = expandScene(def, tests).entities[0]!;
    (first.behaviors![GLOW.name] as Record<string, unknown>).intensity = 99;
    expect(behaviorBlocks(tests, "lamp")[GLOW.name]).toEqual({ color: "#ffcc00", intensity: 2 });
    expect(def.entities![0]!.behaviors).toEqual({ [GLOW.name]: {} });
  });

  it("gives bulk entries their type's required blocks only", () => {
    const tint = defineBehavior({
      name: "bx/tint",
      description: "A tint.",
      fields: { color: z.string().default("red").describe("The tint.") },
    });
    const wobble = defineBehavior({
      name: "bx/wobble",
      description: "A wobble.",
      fields: { amount: z.number().default(1).describe("How much.") },
    });
    const tile = defineEntityType({
      type: "tile",
      description: "A tile.",
      base: "solid",
      fields: { shape: shapeField("The tile.") },
      bulk: { form: "shape", description: "Tiles." },
      behaviors: { required: { [tint.name]: { color: "blue" } } },
    });
    const reg = createRegistry(
      defineGame({ id: "bx", types: [tile], behaviors: [tint, wobble], ...NO_PLAY }),
    );
    const def: SceneDefinition = {
      v: 4,
      game: "bx",
      name: "x",
      bounds: [0, 0, 100, 100],
      tile: [
        ["box", 1, 1, 1, 1],
        ["box", 5, 5, 1, 1],
      ],
      entities: [
        {
          id: "t",
          type: "tile",
          shape: ["box", 9, 9, 1, 1],
          behaviors: { [wobble.name]: { amount: 3 } },
        },
      ],
    };
    const out = byId(expandScene(def, reg).entities);
    expect(out["~tile:0"]!.behaviors).toEqual({ [tint.name]: { color: "blue" } });
    expect(out["~tile:1"]!.behaviors).toEqual({ [tint.name]: { color: "blue" } });
    expect(out["~tile:0"]!.behaviors).not.toBe(out["~tile:1"]!.behaviors);
    expect(out.t!.behaviors).toEqual({
      [tint.name]: { color: "blue" },
      [wobble.name]: { amount: 3 },
    });
  });
});

describe("expandScene: z and layer", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: 4,
      id: "pair",
      entities: [
        { id: "low", type: "solid", shape: ["box", 0, 0, 5, 5] },
        { id: "high", type: "solid", z: 4, layer: "decor", shape: ["box", 20, 0, 5, 5] },
      ],
    },
  ]);

  it("keeps a non-zero z and a set layer, after an instance's", () => {
    const def: SceneDefinition = {
      v: 4,
      name: "x",
      bounds: [0, 0, 1000, 1000],
      instances: [{ id: "p", prefab: "pair", at: [100, 100], z: 2, layer: "gameplay" }],
      entities: [
        { id: "a", type: "solid", z: 0, shape: ["box", 0, 0, 1, 1] },
        { id: "b", type: "solid", z: -3, layer: "terrain", shape: ["box", 0, 0, 1, 1] },
      ],
    };
    const out = byId(expandScene(def, engine, { prefabs }).entities);
    expect(out.a).not.toHaveProperty("z");
    expect(out.a).not.toHaveProperty("layer");
    expect(out.b).toMatchObject({ z: -3, layer: "terrain" });
    expect(out["p/low"]).toMatchObject({ z: 2, layer: "gameplay" });
    expect(out["p/high"]).toMatchObject({ z: 6, layer: "decor" });
  });

  it("drops a z an instance's offset brings to 0", () => {
    const def: SceneDefinition = {
      v: 4,
      name: "x",
      bounds: [0, 0, 1000, 1000],
      instances: [{ id: "p", prefab: "pair", at: [100, 100], z: -4 }],
    };
    const out = byId(expandScene(def, engine, { prefabs }).entities);
    expect(out["p/high"]).not.toHaveProperty("z");
    expect(out["p/low"]).toMatchObject({ z: -4 });
  });
});

describe("expandScene: nested prefabs", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: 4,
      id: "cell",
      entities: [{ id: "post", type: "solid", z: 1, shape: ["box", 10, 0, 2, 4] }],
      bulk: { solid: [["box", 0, 8, 6, 1]] },
    },
    {
      kind: "prefab",
      v: 4,
      id: "row",
      instances: [
        { id: "c1", prefab: "cell", at: [0, 0], layer: "decor" },
        { id: "c2", prefab: "cell", at: [100, 0], rot: 1, z: 2 },
      ],
      entities: [],
    },
    {
      kind: "prefab",
      v: 4,
      id: "block",
      instances: [{ id: "r", prefab: "row", at: [0, 50], flip: true }],
      entities: [{ id: "base", type: "solid", shape: ["box", 0, 0, 50, 5] }],
    },
  ]);
  const def: SceneDefinition = {
    v: 4,
    name: "x",
    bounds: [-1000, -1000, 1000, 1000],
    instances: [{ id: "b", prefab: "block", at: [300, 300], z: 10 }],
  };

  it("loads three levels under a/b/c ids with each level's z, layer and transform", () => {
    const out = byId(expandScene(def, engine, { prefabs }).entities);
    expect(Object.keys(out).sort()).toEqual([
      "b/base",
      "b/r/c1/post",
      "b/r/c1/~solid:0",
      "b/r/c2/post",
      "b/r/c2/~solid:0",
    ]);
    expect(out["b/r/c1/post"]).toMatchObject({
      z: 11,
      layer: "decor",
      transform: { turn: 0, flip: true },
    });
    expect(out["b/r/c1/post"]!.shape).toMatchObject({ type: "box", cx: 290, cy: 350 });
    expect(out["b/r/c2/post"]).toMatchObject({ z: 13, transform: { turn: 3, flip: true } });
    expect(out["b/r/c2/~solid:0"]).toMatchObject({ type: "solid", z: 12 });
    expect(out["b/base"]).toMatchObject({ z: 10 });
    expect(out["b/base"]).not.toHaveProperty("transform");
  });

  it("applies an outer override to a nested child and a nested instance", () => {
    const over: SceneDefinition = {
      ...def,
      instances: [
        {
          ...def.instances![0]!,
          overrides: { "r/c1/post.z": 0, "r/c2.off": true },
        },
      ],
    };
    const out = byId(expandScene(over, engine, { prefabs }).entities);
    expect(out["b/r/c1/post"]).toMatchObject({ z: 10 });
    expect(out["b/r/c2/post"]).toBeUndefined();
    expect(out["b/r/c1/~solid:0"]).toBeDefined();
  });
});

describe("expandScene: child refs", () => {
  const lift = (id: string) => ({
    id,
    type: "follower",
    shape: ["box", 0, 0, 20, 4],
    path: {
      pts: [
        [0, 0],
        [200, 0],
      ],
      mode: "ping_pong",
      speed: 60,
    },
  });
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: 4,
      id: "gate",
      entities: [
        lift("door"),
        { id: "plank", type: "solid", attach: "door", shape: ["box", 0, -10, 20, 2] },
      ],
    },
    {
      kind: "prefab",
      v: 4,
      id: "room",
      instances: [{ id: "gate-1", prefab: "gate", at: [0, 0] }],
      entities: [
        { id: "beam", type: "solid", attach: "gate-1/door", shape: ["box", 0, 20, 20, 2] },
      ],
    },
  ]);
  const def: SceneDefinition = {
    v: 4,
    name: "x",
    bounds: [-1000, -1000, 1000, 1000],
    instances: [
      { id: "gate-2", prefab: "gate", at: [100, 100] },
      { id: "room-1", prefab: "room", at: [400, 100] },
    ],
    entities: [
      { id: "shelf", type: "solid", attach: "gate-2/door", shape: ["box", 100, 80, 10, 2] },
      { id: "ledge", type: "solid", attach: "room-1/gate-1/door", shape: ["box", 400, 80, 10, 2] },
    ],
  };

  it("loads a scene ref to an instance's child as that child's runtime id, at any depth", () => {
    const parsed = parseSceneOrThrow(def, engine);
    const out = byId(expandScene(parsed, engine, { prefabs }).entities);
    expect(out["gate-2/door"]).toMatchObject({ type: "follower" });
    expect(out["room-1/gate-1/door"]).toMatchObject({ type: "follower" });
    expect(out.shelf!.attach).toBe("gate-2/door");
    expect(out.ledge!.attach).toBe("room-1/gate-1/door");
  });

  it("rewrites a prefab's own refs to its children's runtime ids", () => {
    const out = byId(expandScene(def, engine, { prefabs }).entities);
    expect(out["gate-2/plank"]!.attach).toBe("gate-2/door");
    expect(out["room-1/beam"]!.attach).toBe("room-1/gate-1/door");
    expect(out["room-1/gate-1/plank"]!.attach).toBe("room-1/gate-1/door");
  });
});

describe("expandScene: transforms", () => {
  const launcher = defineEntityType({
    type: "launcher",
    description: "Throws things.",
    base: "marker",
    fields: {
      at: pointField("Where it stands."),
      dir: vectorField("Which way it throws."),
      facing: mirrorField("x", "Whether it faces left.").optional(),
    },
  });
  const reg = createRegistry(defineGame({ id: "mg", types: [launcher], ...NO_PLAY }));
  const WING: Pt[] = [
    [0, 0],
    [40, 0],
    [10, 30],
  ];
  const ROUTE: Pt[] = [
    [0, 0],
    [60, -20],
    [70, 15],
  ];
  const GUN: Pt = [20, -10];
  const DIR: Pt = [3, -1];
  const AT: Pt = [500, 400];
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: 4,
      game: "mg",
      id: "kite",
      entities: [
        { id: "wing", type: "solid", shape: ["poly", ...WING.flat()] },
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 10, 4],
          path: { pts: ROUTE, mode: "loop", speed: 50 },
        },
        { id: "gun", type: "launcher", at: GUN, dir: DIR, facing: false },
      ],
    },
  ]);
  const ELEMENTS: Dihedral[] = [false, true].flatMap((flip) =>
    ([0, 1, 2, 3] as const).map((rot) => ({ rot, flip })),
  );

  const placed = (d: Dihedral) => {
    const def: SceneDefinition = {
      v: 4,
      game: "mg",
      name: "x",
      bounds: [0, 0, 1000, 1000],
      instances: [
        {
          id: "k",
          prefab: "kite",
          at: AT,
          ...(d.rot !== 0 ? { rot: d.rot } : {}),
          ...(d.flip ? { flip: true as const } : {}),
        },
      ],
    };
    return byId(expandScene(def, reg, { prefabs }).entities);
  };

  const ints = (v: unknown): boolean =>
    typeof v === "number" ? Number.isInteger(v) : Array.isArray(v) ? v.every(ints) : true;

  it("places every dihedral element's children exactly, on integers", () => {
    for (const d of ELEMENTS) {
      const t = dihedral(d, AT);
      const out = placed(d);
      const pts = WING.map((p) => applyPt(t, p));
      if (d.flip) pts.reverse();
      const wing = out["k/wing"]!.shape as ShapeObj & { pts: Pt[] };
      expect(wing, JSON.stringify(d)).toEqual({ type: "poly", pts });
      const lift = out["k/lift"]!;
      expect((lift.path as PathDef).pts).toEqual(ROUTE.map((p) => applyPt(t, p)));
      expect(lift.shape).toMatchObject({ type: "box", hw: 10, hh: 4, rotDeg: 90 * d.rot });
      const gun = out["k/gun"]!;
      expect(gun.at).toEqual(applyPt(t, GUN));
      expect(gun.dir).toEqual(applyVec(t, DIR));
      expect(gun.facing).toBe(d.flip);
      expect([wing.pts, gun.at, gun.dir, (lift.path as PathDef).pts].every(ints)).toBe(true);
      for (const e of Object.values(out)) {
        if (d.rot === 0 && !d.flip) expect(e).not.toHaveProperty("transform");
        else expect(e.transform).toEqual({ turn: d.rot, flip: d.flip });
      }
    }
  });

  it("mirrors a flipped instance exactly: flip and k turns is the unflipped -k turns, mirrored", () => {
    const mirrorPt = ([x, y]: Pt): Pt => [2 * AT[0] - x, y];
    for (const rot of [0, 1, 2, 3] as const) {
      const flipped = placed({ rot, flip: true });
      const plain = placed({ rot: ((4 - rot) % 4) as Dihedral["rot"], flip: false });
      const wing = (e: RuntimeEntity) => (e.shape as { pts: Pt[] }).pts;
      expect(wing(flipped["k/wing"]!)).toEqual(wing(plain["k/wing"]!).map(mirrorPt).reverse());
      expect((flipped["k/lift"]!.path as PathDef).pts).toEqual(
        (plain["k/lift"]!.path as PathDef).pts.map(mirrorPt),
      );
      const rotDeg = (e: RuntimeEntity) => (e.shape as { rotDeg: number }).rotDeg;
      expect(rotDeg(flipped["k/lift"]!)).toBe((360 - rotDeg(plain["k/lift"]!)) % 360);
      expect(flipped["k/gun"]!.at).toEqual(mirrorPt(plain["k/gun"]!.at as Pt));
      const [dx, dy] = plain["k/gun"]!.dir as Pt;
      expect(flipped["k/gun"]!.dir).toEqual([0 - dx, dy]);
      expect(flipped["k/gun"]!.facing).toBe(!plain["k/gun"]!.facing);
    }
  });

  it("records a turned group's transform on its members", () => {
    const def: SceneDefinition = {
      v: 4,
      game: "mg",
      name: "x",
      bounds: [0, 0, 1000, 1000],
      groups: { wing: { at: [100, 100], rot: 2 } },
      entities: [
        { id: "in", type: "launcher", group: "wing", at: [10, 0], dir: [1, 0] },
        { id: "out", type: "launcher", at: [10, 0], dir: [1, 0] },
      ],
    };
    const out = byId(expandScene(def, reg).entities);
    expect(out.in).toMatchObject({
      at: [90, 100],
      dir: [-1, 0],
      transform: { turn: 2, flip: false },
    });
    expect(out.out).not.toHaveProperty("transform");
  });
});

/**
 * The load as the resolved view gives it: every instance inlined by
 * `resolveSceneDetailed`, then each entity in spawn-group order. Expanding
 * instance by instance must give exactly this.
 */
const shapeOf = (tuple: unknown): ShapeObj => {
  const out = parseShape(tuple);
  if (!out.ok) throw new Error(out.issue.message);
  return out.shape;
};

function throughResolvedView(
  source: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ExpandedScene["entities"] {
  const { def, origins } = resolveSceneDetailed(source, registry, prefabs);
  const groups: RuntimeEntity[][] = registry.spawnGroups.map(() => []);
  for (const b of registry.bulkKeys) {
    const group = registry.spawnGroupOf(b.type);
    if (group === undefined || !Array.isArray(def[b.key])) continue;
    const blocks = behaviorBlocks(registry, b.type);
    (def[b.key] as unknown[]).forEach((value, index) => {
      groups[group]!.push({
        id: bulkId(b.key, index),
        type: b.type,
        [b.field]: b.form === "shape" ? shapeOf(value) : [...(value as Pt)],
        ...(b.material ? { material: b.material } : {}),
        ...(Object.keys(blocks).length > 0 ? { behaviors: blocks } : {}),
      });
    });
  }
  (def.entities ?? []).forEach((e, i) => {
    const group = registry.spawnGroupOf(e.type);
    if (e.off || group === undefined) return;
    const transform = origins[i]?.transform ?? { rot: 0, flip: false };
    groups[group]!.push(runtimeEntity(registry, e, registry.types.get(e.type)!, transform));
  });
  return groups.flat();
}

describe("expandScene: instance by instance", () => {
  const scenesDir = new URL("../../scenes/", import.meta.url);
  const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8")) as unknown;
  const projectPrefabs = prefabLibrary(
    readdirSync(new URL("prefabs/", scenesDir))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".asset.json"))
      .map((f) => readJson(new URL(`prefabs/${f}`, scenesDir)) as Prefab),
  );
  const roomLib = prefabLibrary([room, door, gate] as unknown as Prefab[]);
  const rooms = (game?: string): SceneDefinition => ({
    v: 4,
    ...(game !== undefined ? { game } : {}),
    name: "rooms",
    bounds: [-2000, -2000, 2000, 2000],
    groups: { wing: { at: [300, -100], rot: 1, flip: true } },
    entities: [{ id: "own", type: "solid", shape: ["box", 0, 0, 10, 10], group: "wing" }],
    instances: [
      { id: "r", prefab: "room", at: [0, 0] },
      { id: "t", prefab: "room", at: [500, 200], rot: 3, flip: true, z: 4, layer: "decor" },
      { id: "w", prefab: "room", at: [-400, 300], rot: 2, group: "wing" },
      { id: "o", prefab: "room", at: [0, 900], off: true },
      { id: "m", prefab: "missing", at: [0, 0] },
    ],
  });
  const mappedLib = () => {
    const lib = yardPrefabs(undefined, { params: true });
    const gate = lib.get("gate")!;
    gate.params = {
      ...gate.params,
      mode: {
        description: "How the door runs.",
        targets: ["door.path.mode", "trigger.tags"],
        map: {
          "door.path.mode": { round: "loop" },
          "trigger.tags": { round: ["gate", "round"] },
        },
      },
    };
    return lib;
  };
  const mappedYard = (): SceneDefinition => {
    const def = engineYard();
    def.instances = def.instances!.map((inst) =>
      inst.id === "gate-1" ? { ...inst, params: { mode: "round" } } : inst,
    );
    return def;
  };

  it("loads each mapped target with its value for the param's", () => {
    const out = expandScene(mappedYard(), engine, { prefabs: mappedLib() });
    const door = out.entities.find((e) => e.id === "gate-1/door");
    const trigger = out.entities.find((e) => e.id === "gate-1/trigger");
    expect(door?.path).toMatchObject({ mode: "loop" });
    expect(trigger?.tags).toEqual(["gate", "round"]);
  });

  const FIXTURES: [string, SceneDefinition, Registry, PrefabLibrary | undefined][] = [
    ["engine yard with a mapped param", mappedYard(), engine, mappedLib()],
    ["engine-yard text", yard, engine, yardPrefabs()],
    ["engine-yard text, no library", yard, engine, undefined],
    ["engine yard", engineYard(), engine, yardPrefabs()],
    ["engine yard with params", engineYard(), engine, yardPrefabs(undefined, { params: true })],
    ["fake yard", fakeYard(), fakeOps, yardPrefabs("fake")],
    ["test-game yard on a grid", testGameYard(), testGameRegistry, yardPrefabs("test-game")],
    ["three-level rooms", rooms(), engine, roomLib],
    ...(["engine-yard", "grid-yard", "kitchen-sink"] as const).map(
      (name): [string, SceneDefinition, Registry, PrefabLibrary] => [
        `project ${name}`,
        readJson(new URL(`${name}.json`, scenesDir)) as SceneDefinition,
        engine,
        projectPrefabs,
      ],
    ),
  ];

  it.each(FIXTURES)("loads %s exactly as the resolved view does", (_, def, registry, prefabs) => {
    const out = expandScene(def, registry, prefabs ? { prefabs } : {});
    expect(out.entities).toEqual(throughResolvedView(def, registry, prefabs));
    if ((def.instances ?? []).length > 0 && prefabs)
      expect(out.entities.some((e) => e.id.includes("/"))).toBe(true);
  });
});
