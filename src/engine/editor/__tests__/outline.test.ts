import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField, shapeField } from "../../game/fields";
import {
  SCENE_FORMAT_VERSION,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "../../scene/types";
import { buildOutline, outlineOrder } from "../outline";

const registry = createRegistry(
  defineGame({
    id: "pegs",
    types: [
      defineEntityType({
        type: "peg",
        description: "A point to hang from.",
        base: "marker",
        fields: { at: pointField("Peg position.") },
        bulk: { form: "point", description: "Pegs." },
        inspector: { label: "Peg" },
      }),
    ],
    materials: { ice: { friction: 0.05, restitution: 0, description: "Slippery." } },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const def: SceneDefinition = {
  v: 1,
  game: "pegs",
  name: "o",
  bounds: [0, 0, 100, 100],
  solid: [
    ["box", 0, 0, 1, 1],
    ["chain", 0, 0, 5, 5],
  ],
  "solid:ice": [["box", 9, 9, 4, 2]],
  peg: [[3, 3]],
  entities: [
    { id: "hook", type: "peg", at: [1, 1] },
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 4, 1],
      path: {
        pts: [
          [0, 0],
          [9, 0],
        ],
        mode: "loop",
        speed: 10,
      },
    },
    { id: "wall", type: "solid", shape: ["box", 0, 0, 1, 9], material: "ice" },
    { id: "tip", type: "note", at: [0, 0], text: "hi" },
    { id: "vine", type: "solid", shape: ["box", 1, 1, 1, 1], name: "Vine", off: true },
  ],
};

describe("buildOutline", () => {
  const rows = buildOutline(def, registry);

  it("has one group per registered type in use, in registration order, with counts", () => {
    expect(rows.filter((r) => r.kind === "type").map((r) => [r.label, r.count])).toEqual([
      ["solid", 5],
      ["follower", 1],
      ["note", 1],
      ["Peg", 2],
    ]);
  });

  it("puts a type's bulk keys with child rows first, then its entities", () => {
    const solid = rows.slice(
      1,
      rows.findIndex((r) => r.key === "type:follower"),
    );
    expect(solid.map((r) => [r.key, r.depth])).toEqual([
      ["bucket:solid", 1],
      ["ref:~solid:0", 2],
      ["ref:~solid:1", 2],
      ["bucket:solid:ice", 1],
      ["ref:~solid:ice:0", 2],
      ["ref:wall", 1],
      ["ref:vine", 1],
    ]);
    expect(solid[0]).toMatchObject({ kind: "bucket", label: "solid", count: 2, type: "solid" });
    expect(solid[2]).toMatchObject({ kind: "entity", ref: "~solid:1", detail: "chain" });
    expect(rows.find((r) => r.key === "ref:~peg:0")).toMatchObject({ detail: "3, 3", type: "peg" });
  });

  it("labels entities by name and details them by geometry, material and off", () => {
    expect(rows.find((r) => r.key === "ref:wall")).toMatchObject({ detail: "box · ice" });
    expect(rows.find((r) => r.key === "ref:vine")).toMatchObject({
      label: "Vine",
      detail: "box · off",
    });
    expect(rows.find((r) => r.key === "ref:hook")).toMatchObject({ detail: "1, 1", type: "peg" });
  });

  it("lists types the registry doesn't know last", () => {
    const odd = buildOutline(
      { ...def, entities: [{ id: "x", type: "mystery", at: [0, 0] }] },
      registry,
    );
    expect(odd.at(-2)).toMatchObject({ kind: "type", label: "mystery", count: 1 });
  });

  it("has no group for a spawn-only type, and lists a stray entity of one last", () => {
    const spawned = createRegistry(
      defineGame({
        id: "pegs",
        types: [
          defineEntityType({
            type: "player",
            base: "solid",
            description: "The body the input drives, spawned at Play.",
            spawnOnly: true,
            fields: { shape: shapeField("Body.") },
          }),
          defineEntityType({
            type: "peg",
            description: "A point to hang from.",
            base: "marker",
            fields: { at: pointField("Peg position.") },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const stray = buildOutline(
      {
        ...def,
        entities: [
          { id: "hero", type: "player", shape: ["box", 0, 0, 1, 1] },
          { id: "hook", type: "peg", at: [1, 1] },
        ],
      },
      spawned,
    );
    expect(stray.filter((r) => r.kind === "type").map((r) => r.type)).toEqual([
      "solid",
      "peg",
      "player",
    ]);
  });

  it("has unique keys, and outlineOrder lists the selectable refs", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(outlineOrder(rows)).toEqual([
      "~solid:0",
      "~solid:1",
      "~solid:ice:0",
      "wall",
      "vine",
      "lift",
      "tip",
      "~peg:0",
      "hook",
    ]);
  });
});

describe("buildOutline over nested prefabs", () => {
  const prefab = (id: string, body: Partial<Prefab>): Prefab => ({
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id,
    entities: [],
    ...body,
  });
  const library: PrefabLibrary = new Map([
    ["lock", prefab("lock", { entities: [{ id: "bolt", type: "marker", at: [0, 0] }] })],
    [
      "door",
      prefab("door", {
        entities: [{ id: "panel", type: "marker", at: [0, 0], name: "Panel" }],
        instances: [{ id: "lock-1", prefab: "lock", at: [4, 0] }],
      }),
    ],
    [
      "room",
      prefab("room", {
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 0, 40, 4] }],
        instances: [{ id: "door-1", prefab: "door", at: [10, 0] }],
      }),
    ],
  ]);
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "rooms",
    bounds: [0, 0, 100, 100],
    instances: [
      {
        id: "room-1",
        prefab: "room",
        at: [50, 50],
        overrides: { "door-1.at": [12, 0], "door-1/panel.at": [1, 1] },
      },
    ],
  };
  const rows = buildOutline(scene, createRegistry(), library);
  const tree = rows
    .filter((r) => r.ref?.startsWith("room-1"))
    .map((r) => [r.ref, r.depth, r.prefab ?? null, r.overrides]);

  it("nests each instance's children and its nested instances under it, with a/b/c refs", () => {
    expect(tree).toEqual([
      ["room-1", 1, "room", 2],
      ["room-1/floor", 2, null, 0],
      ["room-1/door-1", 2, "door", 2],
      ["room-1/door-1/panel", 3, null, 1],
      ["room-1/door-1/lock-1", 3, "lock", 0],
      ["room-1/door-1/lock-1/bolt", 4, null, 0],
    ]);
  });

  it("labels nested children by their own id or name, with unique keys", () => {
    expect(rows.find((r) => r.ref === "room-1/door-1/panel")!.label).toBe("Panel");
    expect(rows.find((r) => r.ref === "room-1/door-1/lock-1/bolt")!.label).toBe("bolt");
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("marks a missing nested prefab, and lists no children for a prefab that doesn't resolve", () => {
    const room = library.get("room")!;
    const broken: PrefabLibrary = new Map([
      ...library,
      [
        "room",
        { ...room, instances: [...room.instances!, { id: "vent-1", prefab: "vent", at: [0, 0] }] },
      ],
    ]);
    const out = buildOutline(scene, createRegistry(), broken);
    expect(out.find((r) => r.ref === "room-1/vent-1")!.detail).toBe("vent (missing)");
    expect(out.filter((r) => r.ref).map((r) => r.ref)).toEqual([
      "room-1",
      "room-1/door-1",
      "room-1/door-1/lock-1",
      "room-1/vent-1",
    ]);
  });

  it("stops at a cycle instead of recursing", () => {
    const loop: PrefabLibrary = new Map([
      ["a", prefab("a", { instances: [{ id: "b-1", prefab: "b", at: [0, 0] }] })],
      ["b", prefab("b", { instances: [{ id: "a-1", prefab: "a", at: [0, 0] }] })],
    ]);
    const out = buildOutline(
      { ...scene, instances: [{ id: "a-9", prefab: "a", at: [0, 0] }] },
      createRegistry(),
      loop,
    );
    expect(out.filter((r) => r.ref).map((r) => r.ref)).toEqual(["a-9", "a-9/b-1", "a-9/b-1/a-1"]);
  });
});
