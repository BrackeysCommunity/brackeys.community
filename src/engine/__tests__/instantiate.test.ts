import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import {
  EngineError,
  type EngineContext,
  type GameDefinition,
  type InstantiateOptions,
  type SceneSystem,
} from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DESTROYED, ENTITY_SPAWNED, type StepEvent } from "../runtime/types";
import door from "../scene/__tests__/fixtures/prefabs/door.json";
import gate from "../scene/__tests__/fixtures/prefabs/gate.json";
import room from "../scene/__tests__/fixtures/prefabs/room.json";
import { expandScene } from "../scene/expand";
import { prefabLibrary } from "../scene/prefab";
import {
  PREFAB_MAX_DEPTH,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type RuntimeEntity,
  type SceneDefinition,
  type SceneSettings,
} from "../scene/types";

const DT = 1000 / 60;

const prefab = (id: string, body: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [],
  ...body,
});

/** The gate with a param on its door's speed. */
const gateWithParams = (): Prefab => ({
  ...(structuredClone(gate) as unknown as Prefab),
  params: {
    speed: { description: "The door's speed.", targets: ["door.path.speed"], default: 60 },
  },
});

/** The three-level room (two gates and a door that holds a gate) with params reaching each level. */
const roomWithParams = (): Prefab => ({
  ...(structuredClone(room) as unknown as Prefab),
  params: {
    panel: {
      description: "The door's panel speed.",
      targets: ["door-1/panel.path.speed"],
      default: 45,
    },
    latch: { description: "The latch's door speed.", targets: ["door-1/latch/door.path.speed"] },
    lamp: { description: "The lamp's tags.", targets: ["lamp.tags"] },
  },
});

const library = (...more: Prefab[]): PrefabLibrary =>
  prefabLibrary([
    roomWithParams(),
    door as unknown as Prefab,
    gateWithParams(),
    prefab("panel", {
      entities: [
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 10, 4],
          path: {
            pts: [
              [0, 0],
              [0, 32],
            ],
            mode: "loop",
            speed: 5,
          },
        },
        { id: "pull", type: "lever", at: [20, 0], target: "lift" },
        { id: "deep", type: "lever", at: [40, 0], target: "g/door" },
        { id: "away", type: "lever", at: [60, 0], target: "elsewhere" },
      ],
      instances: [{ id: "g", prefab: "gate", at: [100, 0], rot: 2 }],
    }),
    prefab("crates", {
      entities: [
        { id: "a", type: "crate", at: [0, 0] },
        { id: "pin", type: "marker", at: [5, 0] },
        { id: "b", type: "crate", at: [10, 0] },
      ],
    }),
    ...more,
  ]);

/**
 * A game whose `crate` system logs spawn, despawn and ready, and throws on
 * spawn when its `boom` field is set; `lever` points at another entity.
 */
function instantiateGame() {
  const log: string[] = [];
  const during: { run: ((ctx: EngineContext) => void) | null } = { run: null };
  const crate = defineEntityType({
    type: "crate",
    description: "A point that may refuse to spawn.",
    fields: {
      at: pointField("Where it stands."),
      boom: z.boolean().optional().describe("Throw on spawn."),
    },
    system: (): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn(e) {
          if (e.boom) throw new Error(`${e.id} went boom`);
          log.push(`spawn ${e.id}`);
          live.add(e.id);
        },
        despawn: (id) => void (live.delete(id) && log.push(`despawn ${id}`)),
        clear: () => live.clear(),
        size: () => live.size,
        ready: (ids) => void log.push(`ready ${ids.join(",")}`),
      };
    },
  });
  const lever = defineEntityType({
    type: "lever",
    description: "Starts a follower.",
    base: "marker",
    fields: {
      at: pointField("Lever position."),
      target: z.string().optional().describe("The follower it works."),
    },
    refs: [{ field: "target", targets: ["follower"] }],
  });
  const game: GameDefinition = defineGame({
    id: "inst",
    types: [crate, lever],
    actions: [],
    createRuntime: (ctx) => ({
      beforeStep() {
        during.run?.(ctx);
        during.run = null;
      },
      snapshot: () => null,
    }),
  });
  return { game, log, during };
}

const SETTINGS: SceneSettings = { physics: "none" };

function sceneDef(instances: InstanceDef[], settings: SceneSettings = SETTINGS): SceneDefinition {
  return {
    v: 3,
    name: "inst",
    bounds: [-3000, -3000, 3000, 3000],
    settings,
    entities: [{ id: "own", type: "solid", shape: ["box", 0, 0, 10, 10] }],
    instances,
  };
}

function setup(lib: PrefabLibrary = library(), settings: SceneSettings = SETTINGS) {
  const { game, log, during } = instantiateGame();
  const rt = createSceneRuntime({ rapier: undefined, view: null, game, prefabs: lib });
  const expanded = expandScene(sceneDef([], settings), rt.ctx.registry, { prefabs: lib });
  expect(rt.load(expanded)).toMatchObject({ ok: true });
  log.length = 0;
  return { rt, log, during, lib };
}

/** `expandScene`'s children of the instance `from`, renamed under `to`. */
function loadedAs(
  inst: InstanceDef,
  to: string,
  lib: PrefabLibrary,
  settings: SceneSettings = SETTINGS,
): RuntimeEntity[] {
  const { game } = instantiateGame();
  const rt = createSceneRuntime({ rapier: undefined, view: null, game });
  const entities = expandScene(sceneDef([inst], settings), rt.ctx.registry, {
    prefabs: lib,
  }).entities.filter((e) => e.id.startsWith(`${inst.id}/`));
  const rename = (v: unknown): unknown =>
    typeof v === "string" && v.startsWith(`${inst.id}/`) ? `${to}${v.slice(inst.id.length)}` : v;
  return entities.map((e) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) out[k] = rename(v);
    return out as RuntimeEntity;
  });
}

/** `inst`'s placement as `instantiate` options. */
const optionsOf = (inst: InstanceDef, id: string): InstantiateOptions => ({
  id,
  ...(inst.rot ? { rot: inst.rot } : {}),
  ...(inst.flip ? { flip: true } : {}),
  ...(inst.z !== undefined ? { z: inst.z } : {}),
  ...(inst.layer !== undefined ? { layer: inst.layer } : {}),
  ...(inst.params ? { params: inst.params } : {}),
  ...(inst.overrides ? { overrides: inst.overrides } : {}),
});

describe("ctx.instantiate equals load-time expansion", () => {
  const PLACEMENTS: [string, Partial<InstanceDef>][] = [
    ["as placed", {}],
    ["turned", { rot: 1 }],
    ["flipped", { flip: true }],
    ["turned and flipped with params", { rot: 3, flip: true, params: { speed: 25 } }],
    [
      "with z, layer and an override",
      { rot: 2, z: 4, layer: "decor", overrides: { "door.path.speed": 12 } },
    ],
  ];

  it.each(PLACEMENTS)("gate %s", (_, over) => {
    const { rt, lib } = setup();
    const inst: InstanceDef = { id: "gate-1", prefab: "gate", at: [120, -40], ...over };
    const out = rt.ctx.instantiate("gate", [120, -40], optionsOf(inst, "gate#x"));
    const expected = loadedAs(inst, "gate#x", lib);
    expect(out.id).toBe("gate#x");
    expect(out.entities).toEqual(expected.map((e) => e.id));
    expect(out.entities.map((id) => rt.ctx.get(id))).toEqual(expected);
  });

  it.each([
    ["as placed", {}],
    [
      "turned, flipped, with params at each level",
      { rot: 1, flip: true, params: { panel: 70, latch: 15, lamp: ["dim"] } },
    ],
    [
      "turned three times with z and an override over a param",
      { rot: 3, z: 5, params: { panel: 70 }, overrides: { "door-1/panel.path.speed": 12 } },
    ],
  ] as [string, Partial<InstanceDef>][])("the three-level room %s", (_, over) => {
    const { rt, lib } = setup();
    const inst: InstanceDef = { id: "room-1", prefab: "room", at: [300, 200], ...over };
    const out = rt.ctx.instantiate("room", { x: 300, y: 200 }, optionsOf(inst, "room#x"));
    const expected = loadedAs(inst, "room#x", lib);
    expect(expected.some((e) => e.id === "room#x/door-1/latch/door")).toBe(true);
    expect(out.entities.map((id) => rt.ctx.get(id))).toEqual(expected);
    expect(rt.ctx.poses.get("room#x/gate-2/door")).toBeDefined();
  });

  it("turns children by grid cells when the scene's grid is square", () => {
    const settings: SceneSettings = { physics: "none", grid: { kind: "square", cell: [32, 32] } };
    const { rt, lib } = setup(library(), settings);
    const inst: InstanceDef = { id: "panel-1", prefab: "panel", at: [64, 64], rot: 1, flip: true };
    const out = rt.ctx.instantiate("panel", [64, 64], optionsOf(inst, "panel#x"));
    expect(out.entities.map((id) => rt.ctx.get(id))).toEqual(
      loadedAs(inst, "panel#x", lib, settings),
    );
  });

  it("remaps refs between children to their runtime ids and leaves others", () => {
    const { rt } = setup();
    const { id } = rt.ctx.instantiate("panel", [5, 5]);
    expect(id).toBe("panel#1");
    expect(rt.ctx.get("panel#1/pull")?.target).toBe("panel#1/lift");
    expect(rt.ctx.get("panel#1/deep")?.target).toBe("panel#1/g/door");
    expect(rt.ctx.get("panel#1/away")?.target).toBe("elsewhere");
  });
});

describe("ctx.instantiate ids, ready and events", () => {
  it("counts <prefab>#<n> per prefab, sharing the counter with spawns of that name", () => {
    const { rt } = setup();
    expect(rt.ctx.instantiate("gate", [0, 0]).id).toBe("gate#1");
    expect(rt.ctx.instantiate("gate", [100, 0]).id).toBe("gate#2");
    expect(rt.ctx.instantiate("crates", [0, 0]).id).toBe("crates#1");
    expect(rt.ctx.instantiate("gate", [0, 0], { id: "gate#extra" }).id).toBe("gate#extra");
    expect(rt.ctx.instantiate("gate", [0, 0]).id).toBe("gate#3");
  });

  it("refuses an explicit id that isn't the prefab's, is all digits or is live", () => {
    const { rt } = setup();
    rt.ctx.instantiate("gate", [0, 0], { id: "gate#a" });
    for (const id of ["room#a", "gate#7", "gate#a", "nope"]) {
      expect(() => rt.ctx.instantiate("gate", [0, 0], { id })).toThrow(
        expect.objectContaining({ code: "spawn-id-invalid" }),
      );
    }
  });

  it("spawns children in spawn-group order and runs their systems' ready once", () => {
    const { rt, log } = setup();
    const out = rt.ctx.instantiate("crates", [50, 0]);
    expect(log).toEqual(["spawn crates#1/a", "spawn crates#1/b", "ready crates#1/a,crates#1/b"]);
    expect(rt.ctx.poses.get("crates#1/b")).toMatchObject({ x: 60, y: 0 });
    expect(out.entities).toContain("crates#1/pin");
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(
      expect.arrayContaining([...out.entities]),
    );
  });

  it("raises one entity:spawned per child inside a step, none outside", () => {
    const { rt, during } = setup();
    const outside = rt.ctx.instantiate("crates", [0, 0]);
    expect(rt.step(DT, []).events.filter((e) => e.type === ENTITY_SPAWNED)).toEqual([]);
    expect(outside.entities).toHaveLength(3);

    let ids: readonly string[] = [];
    during.run = (ctx) => void (ids = ctx.instantiate("crates", [100, 0]).entities);
    const spawned = rt.step(DT, []).events.filter((e) => e.type === ENTITY_SPAWNED);
    expect(spawned.map((e: StepEvent) => e.entityId)).toEqual(ids);
    expect(spawned.find((e) => e.entityId === "crates#2/a")).toMatchObject({
      at: { x: 100, y: 0 },
      data: { type: "crate" },
    });
  });
});

describe("prefab-not-spawnable", () => {
  const causeOf = (fn: () => unknown): { code: string } => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe("prefab-not-spawnable");
      return (err as Error).cause as { code: string };
    }
    throw new Error("expected a throw");
  };

  it("names an unknown prefab, top-level or nested", () => {
    const { rt } = setup(
      library(prefab("outer", { instances: [{ id: "i", prefab: "gone", at: [0, 0] }] })),
    );
    expect(causeOf(() => rt.ctx.instantiate("nope", [0, 0]))).toMatchObject({
      code: "prefab-unknown",
    });
    expect(causeOf(() => rt.ctx.instantiate("outer", [0, 0]))).toMatchObject({
      code: "prefab-unknown",
    });
    expect(rt.stats().entities).toBe(1);
  });

  it("names a cycle and a prefab nested too deep", () => {
    const n = PREFAB_MAX_DEPTH + 1;
    const { rt } = setup(
      library(
        prefab("a", { instances: [{ id: "n", prefab: "b", at: [0, 0] }] }),
        prefab("b", { instances: [{ id: "n", prefab: "a", at: [0, 0] }] }),
        ...Array.from({ length: n }, (_, i) =>
          prefab(`p${i + 1}`, {
            entities: [{ id: "pin", type: "marker", at: [i, 0] }],
            ...(i + 1 < n ? { instances: [{ id: "n", prefab: `p${i + 2}`, at: [1, 0] }] } : {}),
          }),
        ),
      ),
    );
    expect(causeOf(() => rt.ctx.instantiate("a", [0, 0]))).toMatchObject({ code: "prefab-cycle" });
    expect(causeOf(() => rt.ctx.instantiate("p1", [0, 0]))).toMatchObject({
      code: "prefab-depth",
    });
  });

  it("names a child that needs physics, or rides another, in a scene without physics", () => {
    const { rt } = setup(
      library(
        prefab("box", {
          entities: [
            { id: "pin", type: "marker", at: [0, 0] },
            { id: "lid", type: "prop", shape: ["box", 0, 0, 10, 10], density: 1, restitution: 0 },
          ],
        }),
        prefab("raft", {
          entities: [
            {
              id: "deck",
              type: "follower",
              shape: ["box", 0, 0, 40, 4],
              path: {
                pts: [
                  [0, 0],
                  [0, 32],
                ],
                mode: "loop",
                speed: 5,
              },
            },
            { id: "rail", type: "solid", attach: "deck", shape: ["box", 0, -4, 40, 2] },
          ],
        }),
      ),
    );
    expect(causeOf(() => rt.ctx.instantiate("box", [0, 0]))).toMatchObject({
      code: "physics-required",
      entityId: "box#1/lid",
    });
    expect(causeOf(() => rt.ctx.instantiate("raft", [0, 0]))).toMatchObject({
      code: "physics-required",
      entityId: "raft#1/rail",
    });
    expect(rt.stats().entities).toBe(1);
    expect(rt.ctx.exists("box#1/pin")).toBe(false);
  });

  it("rolls back every child when one throws on spawn", () => {
    const { rt, log } = setup(
      library(
        prefab("bad", {
          entities: [
            { id: "a", type: "crate", at: [0, 0] },
            { id: "b", type: "crate", at: [1, 0], boom: true },
          ],
        }),
      ),
    );
    expect(() => rt.ctx.instantiate("bad", [0, 0])).toThrow(EngineError);
    expect(log).toEqual(["spawn bad#1/a", "despawn bad#1/a"]);
    expect(rt.ctx.exists("bad#1/a")).toBe(false);
    expect(rt.ctx.poses.get("bad#1/a")).toBeUndefined();
    expect(rt.stats().entities).toBe(1);
  });
});

describe("destroy by instance id", () => {
  it("destroys every child at once outside a step", () => {
    const { rt } = setup();
    const kept = rt.ctx.instantiate("room", [0, 0]);
    const gone = rt.ctx.instantiate("room", [500, 0]);
    rt.ctx.destroy(gone.id);
    for (const id of gone.entities) expect(rt.ctx.exists(id)).toBe(false);
    for (const id of kept.entities) expect(rt.ctx.exists(id)).toBe(true);
    expect(rt.stats().entities).toBe(1 + kept.entities.length);
  });

  it("destroys the children at the end of the tick, in reverse spawn order", () => {
    const { rt, during, log } = setup();
    const out = rt.ctx.instantiate("crates", [0, 0]);
    log.length = 0;
    during.run = (ctx) => ctx.destroy(out.id);
    const destroyed = rt.step(DT, []).events.filter((e) => e.type === ENTITY_DESTROYED);
    expect(destroyed.map((e) => e.entityId)).toEqual([...out.entities].reverse());
    expect(log).toEqual(["despawn crates#1/b", "despawn crates#1/a"]);
  });
});
