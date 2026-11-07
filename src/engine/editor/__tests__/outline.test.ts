import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { SceneDefinition } from "../../scene/types";
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
