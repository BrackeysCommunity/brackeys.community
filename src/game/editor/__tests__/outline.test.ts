import { describe, expect, it } from "vite-plus/test";

import type { SceneDefinition } from "../../scene/types";
import { buildOutline, outlineOrder } from "../outline";

const def: SceneDefinition = {
  v: 1,
  name: "o",
  bounds: [0, 0, 100, 100],
  spawn: [[1, 1]],
  solid: [
    ["box", 0, 0, 1, 1],
    ["chain", 0, 0, 5, 5],
  ],
  cloud: [["box", 9, 9, 4, 2]],
  anchor: [[3, 3]],
  entities: [
    { id: "pad", b: "construct", type: "bounce_pad", at: [1, 1] },
    {
      id: "lift",
      b: "mover",
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
    { id: "wall", b: "solid", shape: ["box", 0, 0, 1, 9] },
    { id: "tip", b: "note", at: [0, 0], text: "hi" },
    { id: "vine", b: "solid", shape: ["box", 1, 1, 1, 1], layer: "decor", name: "Vine" },
  ],
};

describe("buildOutline", () => {
  const rows = buildOutline(def);

  it("lists layers in order with item counts", () => {
    expect(rows.filter((r) => r.kind === "layer").map((r) => [r.label, r.count])).toEqual([
      ["Terrain", 4],
      ["Gameplay", 4],
      ["Decor", 1],
      ["Editor", 1],
    ]);
  });

  it("puts bulk buckets with child rows under Terrain, then solid entities", () => {
    const terrain = rows.slice(
      1,
      rows.findIndex((r) => r.key === "layer:gameplay"),
    );
    expect(terrain.map((r) => [r.key, r.depth])).toEqual([
      ["bucket:solid", 1],
      ["ref:~solid:0", 2],
      ["ref:~solid:1", 2],
      ["bucket:cloud", 1],
      ["ref:~cloud:0", 2],
      ["ref:wall", 1],
    ]);
    expect(terrain[0]).toMatchObject({
      kind: "bucket",
      label: "solid",
      count: 2,
      behavior: "solid",
    });
    expect(terrain[2]).toMatchObject({ kind: "entity", ref: "~solid:1", detail: "chain" });
  });

  it("orders Gameplay as spawns, movers, anchors, then constructs", () => {
    const start = rows.findIndex((r) => r.key === "layer:gameplay") + 1;
    const end = rows.findIndex((r) => r.key === "layer:decor");
    expect(rows.slice(start, end).map((r) => r.key)).toEqual([
      "spawn:0",
      "ref:lift",
      "bucket:anchor",
      "ref:~anchor:0",
      "ref:pad",
    ]);
    expect(rows[start]).toMatchObject({ kind: "spawn", label: "spawn" });
    expect(rows.find((r) => r.key === "ref:lift")).toMatchObject({
      detail: "mover · box",
      behavior: "mover",
    });
  });

  it("honours an entity's layer and display name, and puts notes on Editor", () => {
    expect(rows.find((r) => r.key === "ref:vine")).toMatchObject({ label: "Vine", depth: 1 });
    const decor = rows.findIndex((r) => r.key === "layer:decor");
    expect(rows[decor + 1]!.key).toBe("ref:vine");
    expect(rows.at(-1)).toMatchObject({ key: "ref:tip", behavior: "note" });
  });

  it("has unique keys, and outlineOrder lists the selectable refs", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(outlineOrder(rows)).toEqual([
      "~solid:0",
      "~solid:1",
      "~cloud:0",
      "wall",
      "lift",
      "~anchor:0",
      "pad",
      "vine",
      "tip",
    ]);
  });
});
