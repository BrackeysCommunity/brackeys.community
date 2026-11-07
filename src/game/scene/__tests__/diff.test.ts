import { describe, expect, it } from "vite-plus/test";

import { describeChange, diffScenes } from "../diff";
import type { SceneDefinition } from "../types";

function scene(patch: Partial<SceneDefinition> = {}): SceneDefinition {
  return {
    v: 1,
    name: "d",
    bounds: [0, 0, 100, 100],
    spawn: [[1, 1]],
    entities: [
      {
        id: "lift",
        b: "mover",
        shape: ["box", 0, 0, 40, 6],
        path: {
          pts: [
            [1300, 1000],
            [1300, 700],
          ],
          mode: "ping_pong",
          speed: 100,
        },
      },
      { id: "cheese", b: "sensor", kind: "goal", shape: ["circle", 5, 5, 12] },
    ],
    ...patch,
  };
}

describe("diffScenes: entities", () => {
  it("reports nothing for equal scenes", () => {
    expect(diffScenes(scene(), scene())).toEqual([]);
  });

  it("reports modified fields by path, path points by index", () => {
    const b = scene();
    const lift = b.entities![0]!;
    if (lift.b !== "mover") throw new Error("fixture");
    lift.path = {
      ...lift.path,
      speed: 140,
      pts: [
        [1300, 1000],
        [1300, 640],
      ],
      pauseMs: 200,
    };
    const changes = diffScenes(scene(), b);
    expect(changes).toEqual([
      { kind: "modified", ref: "lift", field: "path.pts.1", from: [1300, 700], to: [1300, 640] },
      { kind: "modified", ref: "lift", field: "path.speed", from: 100, to: 140 },
      { kind: "modified", ref: "lift", field: "path.pauseMs", from: undefined, to: 200 },
    ]);
    expect(changes.map(describeChange)).toEqual([
      "lift.path.pts.1: [1300,700] -> [1300,640]",
      "lift.path.speed: 100 -> 140",
      "lift.path.pauseMs: (unset) -> 200",
    ]);
  });

  it("treats a shape tuple as one value", () => {
    const b = scene();
    b.entities![1] = { id: "cheese", b: "sensor", kind: "goal", shape: ["circle", 5, 5, 20] };
    expect(diffScenes(scene(), b)).toEqual([
      {
        kind: "modified",
        ref: "cheese",
        field: "shape",
        from: ["circle", 5, 5, 12],
        to: ["circle", 5, 5, 20],
      },
    ]);
  });

  it("reports added, removed and renamed entities", () => {
    const b = scene({
      entities: [
        { id: "elevator", ...withoutId(scene().entities![0]!) },
        { id: "pad", b: "construct", type: "bounce_pad", at: [3, 3] },
      ] as SceneDefinition["entities"],
    });
    const changes = diffScenes(scene(), b);
    expect(changes).toEqual([
      { kind: "removed", ref: "cheese", behavior: "sensor" },
      { kind: "added", ref: "pad", behavior: "construct" },
      { kind: "renamed", from: "lift", to: "elevator" },
    ]);
    expect(changes.map(describeChange)).toEqual([
      "removed cheese (sensor)",
      "added pad (construct)",
      "renamed lift -> elevator",
    ]);
  });
});

function withoutId<T extends { id: string }>(e: T): Omit<T, "id"> {
  const { id: _id, ...rest } = e;
  return rest;
}

describe("diffScenes: bulk buckets", () => {
  const solid: SceneDefinition["solid"] = [
    ["box", 0, 0, 10, 10],
    ["box", 100, 0, 10, 10],
    ["box", 200, 0, 10, 10],
    ["box", 300, 0, 10, 10],
  ];

  it("aligns by LCS, so deleting one entry is one removal", () => {
    const b = scene({ solid: [solid[0]!, solid[2]!, solid[3]!] });
    expect(diffScenes(scene({ solid }), b)).toEqual([
      { kind: "removed", ref: "~solid:1", behavior: "solid" },
    ]);
  });

  it("reports an insertion with its ref in the new document", () => {
    const b = scene({ solid: [solid[0]!, ["box", 50, 50, 4, 4], ...solid.slice(1)] });
    expect(diffScenes(scene({ solid }), b)).toEqual([
      { kind: "added", ref: "~solid:1", behavior: "solid" },
    ]);
  });

  it("pairs a same-size entry with a new center as moved", () => {
    const b = scene({ solid: [solid[0]!, ["box", 116, 8, 10, 10], solid[2]!, solid[3]!] });
    const changes = diffScenes(scene({ solid }), b);
    expect(changes).toEqual([{ kind: "moved", ref: "~solid:1", by: [16, 8] }]);
    expect(describeChange(changes[0]!)).toBe("moved ~solid:1 by [16, 8]");
  });

  it("does not pair a resize; it is a removal and an addition", () => {
    const b = scene({ solid: [solid[0]!, ["box", 100, 0, 20, 10], solid[2]!, solid[3]!] });
    expect(diffScenes(scene({ solid }), b)).toEqual([
      { kind: "removed", ref: "~solid:1", behavior: "solid" },
      { kind: "added", ref: "~solid:1", behavior: "solid" },
    ]);
  });

  it("moves polys only when every point shifts together", () => {
    const a = scene({ solid: [["poly", 0, 0, 10, 0, 5, 8]] });
    expect(diffScenes(a, scene({ solid: [["poly", 2, 1, 12, 1, 7, 9]] }))).toEqual([
      { kind: "moved", ref: "~solid:0", by: [2, 1] },
    ]);
    expect(
      diffScenes(a, scene({ solid: [["poly", 2, 1, 12, 1, 7, 10]] })).map((c) => c.kind),
    ).toEqual(["removed", "added"]);
  });

  it("handles anchors and material buckets with their own keys", () => {
    const a = scene({ anchor: [[1, 1]], "solid:ice": [["box", 0, 0, 1, 1]] });
    const b = scene({ anchor: [[4, 5]] });
    expect(diffScenes(a, b)).toEqual([
      { kind: "removed", ref: "~solid:ice:0", behavior: "solid" },
      { kind: "moved", ref: "~anchor:0", by: [3, 4] },
    ]);
  });
});

describe("diffScenes: scene fields", () => {
  it("reports name, bounds, spawn and v", () => {
    const changes = diffScenes(
      scene(),
      scene({ v: 2, name: "e", bounds: [0, 0, 50, 50], spawn: [[2, 2]] }),
    );
    expect(changes.map((c) => c.kind === "scene" && c.field)).toEqual([
      "v",
      "name",
      "bounds",
      "spawn",
    ]);
    expect(describeChange(changes[1]!)).toBe('scene.name: "d" -> "e"');
  });
});
