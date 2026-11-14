import { describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { expandInstance, expandScene } from "../expand";
import { prefabLibrary } from "../prefab";
import { gridTurns, sceneFrames } from "../resolve";
import {
  PREFAB_MAX_DEPTH,
  type EntityDef,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type RuntimeEntity,
  type SceneDefinition,
  type SceneSettings,
} from "../types";
import door from "./fixtures/prefabs/door.json";
import gate from "./fixtures/prefabs/gate.json";
import room from "./fixtures/prefabs/room.json";
import { engine, fake } from "./fixtures/random-ops";

const prefab = (id: string, body: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 4,
  id,
  entities: [],
  ...body,
});

/** The room fixture (two gates and a door that holds a gate) with params reaching each level. */
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

const library = (): PrefabLibrary =>
  prefabLibrary([roomWithParams(), door, gate] as unknown as Prefab[]);

/** A turned and flipped node an instance may sit under. */
const NODE: EntityDef = { id: "g", type: "node", at: [250, -150], rot: 270, flip: true };

const sceneOf = (
  inst: InstanceDef,
  settings?: SceneSettings,
  node: EntityDef = NODE,
): SceneDefinition => ({
  v: 4,
  name: "one",
  bounds: [-3000, -3000, 3000, 3000],
  ...(settings ? { settings } : {}),
  entities: [{ id: "own", type: "solid", shape: ["box", 0, 0, 10, 10] }, node],
  instances: [inst],
});

/** The nodes and children `expandScene` loads for the scene's one instance, in its order. */
const loadedChildren = (def: SceneDefinition, lib: PrefabLibrary, registry: Registry = engine) =>
  expandScene(def, registry, { prefabs: lib }).entities.filter(
    (e) => e.id !== "own" && e.id !== "g",
  );

const expandIn = (def: SceneDefinition, lib: PrefabLibrary, registry: Registry = engine) => {
  const inst = def.instances![0]!;
  const frames = sceneFrames(def, registry, lib);
  const parent = frames.parentOf(inst.id);
  return expandInstance(inst, lib, registry, {
    steps: frames.stepsFor(inst),
    cells: gridTurns(def),
    ...(parent !== undefined ? { parent } : {}),
  });
};

const entitiesOf = (out: ReturnType<typeof expandInstance>): RuntimeEntity[] => {
  if (!out.ok) throw new Error(out.issue.message);
  return out.entities;
};

describe("expandInstance on the three-level room", () => {
  const PLACEMENTS: [string, Partial<InstanceDef>][] = [
    ["as placed", {}],
    ["turned once", { rot: 90 }],
    ["turned twice", { rot: 180 }],
    ["turned three times", { rot: 270 }],
    ["turned off the quarter turns", { rot: 30 }],
    ["flipped", { flip: true }],
    ["turned and flipped", { rot: 90, flip: true }],
    ["with params", { params: { panel: 70, latch: 15, lamp: ["dim"] } }],
    ["with params at their defaults", { params: {} }],
    [
      "turned, flipped, with params, z and layer",
      { rot: 270, flip: true, z: 5, layer: "decor", params: { latch: 25 } },
    ],
    [
      "with params and an override that beats one",
      {
        params: { panel: 70 },
        overrides: { "door-1/panel.path.speed": 12 },
      },
    ],
    ["under a turned and flipped node", { parent: "g", rot: 90, params: { panel: 33 } }],
  ];

  it.each(PLACEMENTS)("equals expandScene's children %s", (_, over) => {
    const lib = library();
    const def = sceneOf({ id: "r", prefab: "room", at: [120, -40], ...over });
    const children = entitiesOf(expandIn(def, lib));
    expect(children.length).toBeGreaterThan(0);
    expect(children).toEqual(loadedChildren(def, lib));
  });

  it("names children under the instance id at every level, in spawn-group order", () => {
    const lib = library();
    const children = entitiesOf(
      expandInstance({ id: "gate-x", prefab: "room", at: [0, 0] }, lib, engine),
    ).filter((e) => e.type !== "node");
    const ids = children.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["gate-x/lamp", "gate-x/door-1/latch/door"]));
    expect(ids.every((id) => id.startsWith("gate-x/"))).toBe(true);
    const groups = children.map((e) => engine.spawnGroupOf(e.type)!);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it("feeds params through to each level and records transform and z", () => {
    const lib = library();
    const byId = new Map(
      entitiesOf(
        expandInstance(
          { id: "r", prefab: "room", at: [0, 0], rot: 90, z: 3, params: { latch: 15 } },
          lib,
          engine,
        ),
      ).map((e) => [e.id, e]),
    );
    const speed = (id: string) => (byId.get(id)?.path as { speed?: number } | undefined)?.speed;
    expect(speed("r/door-1/panel")).toBe(45);
    expect(speed("r/door-1/latch/door")).toBe(15);
    expect(speed("r/gate-2/door")).toBe(90);
    expect(byId.get("r/door-1/panel")).toMatchObject({ z: 5, transform: { rot: 90, flip: false } });
    expect(byId.get("r/gate-2/door")).toMatchObject({ transform: { rot: 270, flip: true } });
  });

  it("drops an off instance's children and returns none", () => {
    const out = entitiesOf(
      expandInstance({ id: "r", prefab: "room", at: [0, 0], off: true }, library(), engine),
    );
    expect(out).toEqual([]);
  });

  it("does not alias the library", () => {
    const lib = library();
    const inst: InstanceDef = { id: "r", prefab: "room", at: [0, 0] };
    const first = entitiesOf(expandInstance(inst, lib, engine));
    (first.find((e) => e.id === "r/lamp")!.tags as string[]).push("mutated");
    const again = entitiesOf(expandInstance(inst, lib, engine));
    expect(again.find((e) => e.id === "r/lamp")!.tags).toEqual(["light"]);
  });
});

describe("expandInstance: the instance's nodes", () => {
  const out = (over: Partial<InstanceDef> = {}, lib: PrefabLibrary = library()) =>
    entitiesOf(expandInstance({ id: "r", prefab: "room", at: [120, -40], ...over }, lib, engine));
  const byId = (entities: RuntimeEntity[]) => new Map(entities.map((e) => [e.id, e]));

  it("emits a node at the instance's id and origin, first, then one per nested instance", () => {
    const entities = out();
    expect(entities[0]).toEqual({ id: "r", type: "node", at: [120, -40] });
    const nodes = entities.filter((e) => e.type === "node").map((e) => e.id);
    expect(nodes).toEqual(["r", "r/gate-1", "r/gate-2", "r/door-1", "r/door-1/latch"]);
    // nodes before every child
    const firstChild = entities.findIndex((e) => e.type !== "node");
    expect(entities.slice(0, firstChild).map((e) => e.id)).toEqual(nodes);
  });

  it("counts its leading nodes apart from a node the prefab places itself", () => {
    const lib = prefabLibrary([
      prefab("pivoted", {
        entities: [
          { id: "pivot", type: "node", at: [5, 0] },
          { id: "pin", type: "marker", at: [0, 0] },
        ],
        instances: [{ id: "in", prefab: "pivoted-leaf", at: [10, 0] }],
      }),
      prefab("pivoted-leaf", { entities: [{ id: "pin", type: "marker", at: [0, 0] }] }),
    ]);
    const out = expandInstance({ id: "p", prefab: "pivoted", at: [0, 0] }, lib, engine);
    if (!out.ok) throw new Error(out.issue.message);
    expect(out.nodes).toBe(2);
    expect(out.entities.slice(0, out.nodes).map((e) => e.id)).toEqual(["p", "p/in"]);
    expect(out.entities.slice(out.nodes).map((e) => e.id)).toEqual(
      expect.arrayContaining(["p/pivot", "p/pin", "p/in/pin"]),
    );
    expect(out.entities.find((e) => e.id === "p/pivot")?.parent).toBe("p");
  });

  it("places each nested node at its instance's world origin and angle", () => {
    const nodes = byId(out({ rot: 90 }));
    // a quarter turn clockwise (y down) takes (x, y) to (-y, x) about the instance's at
    expect(nodes.get("r")).toMatchObject({ at: [120, -40], rot: 90 });
    expect(nodes.get("r/gate-1")).toMatchObject({ at: [120, -240], rot: 90, parent: "r" });
    expect(nodes.get("r/door-1")).toMatchObject({ at: [80, -40], rot: 90, parent: "r" });
    expect(nodes.get("r/door-1/latch")).toMatchObject({
      at: [80, 0],
      rot: 90,
      parent: "r/door-1",
    });
    // gate-2 is turned twice and flipped inside the room
    expect(nodes.get("r/gate-2")).toMatchObject({
      at: [120, 160],
      rot: 270,
      transform: { rot: 270, flip: true },
    });
  });

  it("gives each child the nearest enclosing instance's node as its parent", () => {
    const entities = byId(out());
    expect(entities.get("r")).not.toHaveProperty("parent");
    expect(entities.get("r/lamp")?.parent).toBe("r");
    expect(entities.get("r/~solid:0")?.parent).toBe("r");
    expect(entities.get("r/gate-1/door")?.parent).toBe("r/gate-1");
    expect(entities.get("r/door-1/panel")?.parent).toBe("r/door-1");
    expect(entities.get("r/door-1/latch/door")?.parent).toBe("r/door-1/latch");
    for (const e of entities.values()) {
      if (e.id === "r") continue;
      expect(entities.get(e.parent!)?.type).toBe("node");
      expect(e.id.startsWith(`${e.parent}/`)).toBe(true);
    }
  });

  it("drops a nested instance switched off by an override, with its node", () => {
    const entities = byId(out({ overrides: { "door-1.off": true } }));
    expect(entities.has("r/door-1")).toBe(false);
    expect(entities.has("r/door-1/latch")).toBe(false);
    expect(entities.has("r/door-1/panel")).toBe(false);
    expect(entities.has("r/gate-1")).toBe(true);
  });

  it("moves a nested node with an override of its instance's at", () => {
    const entities = byId(out({ overrides: { "door-1.at": [10, 10] } }));
    expect(entities.get("r/door-1")).toMatchObject({ at: [130, -30] });
    expect(entities.get("r/door-1/latch")).toMatchObject({ at: [170, -30] });
  });

  it("carries the instance's layer and z onto its node, z summed down the levels", () => {
    const entities = out({ layer: "decor", z: 4 });
    expect(entities[0]).toMatchObject({ id: "r", layer: "decor", z: 4 });
    // door-1 adds 2 inside the room
    expect(entities.find((e) => e.id === "r/door-1/latch")).toMatchObject({ z: 6 });
    expect(out()[0]).not.toHaveProperty("z");
  });

  it("gives a variant one node, though it carries its base's origin too", () => {
    const lib = prefabLibrary([
      ...([...library().values()] as Prefab[]),
      prefab("wide", { base: "room", entities: [{ id: "post", type: "marker", at: [5, 0] }] }),
    ]);
    const entities = entitiesOf(
      expandInstance({ id: "v", prefab: "wide", at: [0, 0] }, lib, engine),
    );
    expect(entities.filter((e) => e.id === "v")).toHaveLength(1);
    expect(entities.find((e) => e.id === "v/post")?.parent).toBe("v");
    expect(entities.find((e) => e.id === "v/door-1/panel")?.parent).toBe("v/door-1");
  });

  it("gives an empty prefab's instance its node alone", () => {
    const lib = prefabLibrary([prefab("empty")]);
    expect(
      entitiesOf(expandInstance({ id: "e", prefab: "empty", at: [3, 4] }, lib, engine)),
    ).toEqual([{ id: "e", type: "node", at: [3, 4] }]);
  });

  it("follows the library when a prefab changes, and keeps no prefab it drops", () => {
    const lib = new Map(library());
    expect(out({}, lib).some((e) => e.id === "r/lamp")).toBe(true);
    const room = lib.get("room")!;
    lib.set("room", { ...room, entities: [{ id: "bulb", type: "marker", at: [0, 0] }] });
    const after = out({}, lib);
    expect(after.some((e) => e.id === "r/lamp")).toBe(false);
    expect(after.find((e) => e.id === "r/bulb")?.parent).toBe("r");
    lib.delete("gate");
    expect(expandInstance({ id: "r", prefab: "room", at: [0, 0] }, lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-unknown", got: "gate" },
    });
  });
});

describe("expandInstance: refs and grids", () => {
  const panel = (): PrefabLibrary =>
    prefabLibrary([
      prefab("panel", {
        game: "fake",
        entities: [
          {
            id: "lift",
            type: "follower",
            shape: ["box", 0, 0, 10, 4],
            path: { pts: [[0, 0]], mode: "loop", speed: 5 },
          },
          { id: "pull", type: "lever", at: [20, 0], target: "lift" },
          { id: "deep", type: "lever", at: [40, 0], target: "g/door" },
          { id: "away", type: "lever", at: [60, 0], target: "elsewhere" },
        ],
        instances: [{ id: "g", prefab: "gate", at: [100, 0], rot: 180 }],
      }),
      { ...(structuredClone(gate) as unknown as Prefab), game: "fake" },
    ]);

  it("remaps refs between children to their runtime ids and leaves others", () => {
    const lib = panel();
    const byId = new Map(
      entitiesOf(expandInstance({ id: "p-1", prefab: "panel", at: [5, 5] }, lib, fake)).map((e) => [
        e.id,
        e,
      ]),
    );
    expect(byId.get("p-1/pull")?.target).toBe("p-1/lift");
    expect(byId.get("p-1/deep")?.target).toBe("p-1/g/door");
    expect(byId.get("p-1/away")?.target).toBe("elsewhere");
  });

  it("equals expandScene's children with grid turns on and off", () => {
    const lib = panel();
    for (const settings of [
      { grid: { kind: "square", cell: [32, 32] } },
      { grid: { kind: "square", cell: [32, 16] } },
      undefined,
    ] as SceneSettings[]) {
      const def: SceneDefinition = {
        ...sceneOf({ id: "p", prefab: "panel", at: [64, 64], rot: 90, flip: true }, settings),
        game: "fake",
      };
      expect(entitiesOf(expandIn(def, lib, fake))).toEqual(loadedChildren(def, lib, fake));
    }
  });
});

describe("expandInstance: failures", () => {
  it("reports an unknown prefab", () => {
    expect(
      expandInstance({ id: "x", prefab: "nope", at: [0, 0] }, library(), engine),
    ).toMatchObject({ ok: false, issue: { code: "prefab-unknown", got: "nope" } });
  });

  it("reports a nested prefab the library lacks", () => {
    const lib = prefabLibrary([
      prefab("outer", { instances: [{ id: "i", prefab: "gone", at: [0, 0] }] }),
    ]);
    expect(expandInstance({ id: "x", prefab: "outer", at: [0, 0] }, lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-unknown", got: "gone" },
    });
  });

  it("reports a cycle", () => {
    const lib = prefabLibrary([
      prefab("a", { instances: [{ id: "n", prefab: "b", at: [0, 0] }] }),
      prefab("b", { instances: [{ id: "n", prefab: "a", at: [0, 0] }] }),
    ]);
    expect(expandInstance({ id: "x", prefab: "a", at: [0, 0] }, lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-cycle" },
    });
  });

  it("reports a prefab nested too deep", () => {
    const n = PREFAB_MAX_DEPTH + 1;
    const lib = prefabLibrary(
      Array.from({ length: n }, (_, i) =>
        prefab(`p${i + 1}`, {
          entities: [{ id: "pin", type: "marker", at: [i, 0] }],
          ...(i + 1 < n ? { instances: [{ id: "n", prefab: `p${i + 2}`, at: [1, 0] }] } : {}),
        }),
      ),
    );
    expect(expandInstance({ id: "x", prefab: "p1", at: [0, 0] }, lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-depth" },
    });
  });

  it("throws for a child of an unregistered type, as a load does", () => {
    const lib = prefabLibrary([
      prefab("odd", { entities: [{ id: "c", type: "comet", at: [0, 0] }] }),
    ]);
    expect(() => expandInstance({ id: "x", prefab: "odd", at: [0, 0] }, lib, engine)).toThrow(
      /unregistered type "comet"/,
    );
  });
});
