import { describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { expandInstance, expandScene } from "../expand";
import { prefabLibrary } from "../prefab";
import { gridTurns } from "../resolve";
import {
  PREFAB_MAX_DEPTH,
  type GroupDef,
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

const GROUP: GroupDef = { at: [250, -150], rot: 3, flip: true };

const sceneOf = (
  inst: InstanceDef,
  settings?: SceneSettings,
  group: GroupDef = GROUP,
): SceneDefinition => ({
  v: 4,
  name: "one",
  bounds: [-3000, -3000, 3000, 3000],
  ...(settings ? { settings } : {}),
  groups: { g: group },
  entities: [{ id: "own", type: "solid", shape: ["box", 0, 0, 10, 10] }],
  instances: [inst],
});

/** The children `expandScene` loads for the scene's one instance, in its order. */
const loadedChildren = (def: SceneDefinition, lib: PrefabLibrary, registry: Registry = engine) =>
  expandScene(def, registry, { prefabs: lib }).entities.filter((e) => e.id.includes("/"));

const expandIn = (def: SceneDefinition, lib: PrefabLibrary, registry: Registry = engine) => {
  const inst = def.instances![0]!;
  return expandInstance(inst, lib, registry, {
    ...(inst.group !== undefined ? { group: def.groups![inst.group]! } : {}),
    cells: gridTurns(def),
  });
};

const entitiesOf = (out: ReturnType<typeof expandInstance>): RuntimeEntity[] => {
  if (!out.ok) throw new Error(out.issue.message);
  return out.entities;
};

describe("expandInstance on the three-level room", () => {
  const PLACEMENTS: [string, Partial<InstanceDef>][] = [
    ["as placed", {}],
    ["turned once", { rot: 1 }],
    ["turned twice", { rot: 2 }],
    ["turned three times", { rot: 3 }],
    ["flipped", { flip: true }],
    ["turned and flipped", { rot: 1, flip: true }],
    ["with params", { params: { panel: 70, latch: 15, lamp: ["dim"] } }],
    ["with params at their defaults", { params: {} }],
    [
      "turned, flipped, with params, z and layer",
      { rot: 3, flip: true, z: 5, layer: "decor", params: { latch: 25 } },
    ],
    [
      "with params and an override that beats one",
      {
        params: { panel: 70 },
        overrides: { "door-1/panel.path.speed": 12 },
      },
    ],
    ["in a turned and flipped group", { group: "g", rot: 1, params: { panel: 33 } }],
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
    );
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
          { id: "r", prefab: "room", at: [0, 0], rot: 1, z: 3, params: { latch: 15 } },
          lib,
          engine,
        ),
      ).map((e) => [e.id, e]),
    );
    const speed = (id: string) => (byId.get(id)?.path as { speed?: number } | undefined)?.speed;
    expect(speed("r/door-1/panel")).toBe(45);
    expect(speed("r/door-1/latch/door")).toBe(15);
    expect(speed("r/gate-2/door")).toBe(90);
    expect(byId.get("r/door-1/panel")).toMatchObject({ z: 5, transform: { turn: 1, flip: false } });
    expect(byId.get("r/gate-2/door")).toMatchObject({ transform: { turn: 3, flip: true } });
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
        instances: [{ id: "g", prefab: "gate", at: [100, 0], rot: 2 }],
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
        ...sceneOf({ id: "p", prefab: "panel", at: [64, 64], rot: 1, flip: true }, settings),
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
