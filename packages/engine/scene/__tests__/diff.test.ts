import { describe, expect, it } from "vite-plus/test";

import { describeChange, diffScenes } from "../diff";
import { bulkKeysOf } from "../expand";
import type { EntityDef, SceneDefinition, ShapeTuple } from "../types";

function scene(patch: Partial<SceneDefinition> = {}): SceneDefinition {
  return {
    v: 1,
    name: "d",
    bounds: [0, 0, 100, 100],
    entities: [
      {
        id: "lift",
        type: "follower",
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
      { id: "zone", type: "sensor", tags: ["goal"], shape: ["circle", 5, 5, 12] },
    ],
    ...patch,
  };
}

const lift = (def: SceneDefinition) => def.entities![0]! as EntityDef & { path: object };

describe("diffScenes: entities", () => {
  it("reports nothing for equal scenes", () => {
    expect(diffScenes(scene(), scene())).toEqual([]);
  });

  it("reports modified fields by path, path points by index", () => {
    const b = scene();
    lift(b).path = {
      ...lift(b).path,
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
    b.entities![1] = { id: "zone", type: "sensor", tags: ["goal"], shape: ["circle", 5, 5, 20] };
    expect(diffScenes(scene(), b)).toEqual([
      {
        kind: "modified",
        ref: "zone",
        field: "shape",
        from: ["circle", 5, 5, 12],
        to: ["circle", 5, 5, 20],
      },
    ]);
  });

  it("reports added, removed and renamed entities with their types, any type at all", () => {
    const { id: _id, ...rest } = scene().entities![0]!;
    const b = scene({
      entities: [
        { id: "elevator", ...rest, type: "follower" },
        { id: "pad", type: "bounce-pad", at: [3, 3] },
      ],
    });
    const changes = diffScenes(scene(), b);
    expect(changes).toEqual([
      { kind: "removed", ref: "zone", type: "sensor" },
      { kind: "added", ref: "pad", type: "bounce-pad" },
      { kind: "renamed", from: "lift", to: "elevator" },
    ]);
    expect(changes.map(describeChange)).toEqual([
      "removed zone (sensor)",
      "added pad (bounce-pad)",
      "renamed lift -> elevator",
    ]);
  });
});

describe("diffScenes: bulk arrays", () => {
  const solid: ShapeTuple[] = [
    ["box", 0, 0, 10, 10],
    ["box", 100, 0, 10, 10],
    ["box", 200, 0, 10, 10],
    ["box", 300, 0, 10, 10],
  ];

  it("aligns by LCS, so deleting one entry is one removal", () => {
    const b = scene({ solid: [solid[0]!, solid[2]!, solid[3]!] });
    expect(diffScenes(scene({ solid }), b)).toEqual([
      { kind: "removed", ref: "~solid:1", type: "solid" },
    ]);
  });

  it("reports an insertion with its ref in the new document", () => {
    const b = scene({ solid: [solid[0]!, ["box", 50, 50, 4, 4], ...solid.slice(1)] });
    expect(diffScenes(scene({ solid }), b)).toEqual([
      { kind: "added", ref: "~solid:1", type: "solid" },
    ]);
  });

  it("pairs a same-size entry with a new center as moved", () => {
    const b = scene({ solid: [solid[0]!, ["box", 116, 8, 10, 10], solid[2]!, solid[3]!] });
    const changes = diffScenes(scene({ solid }), b);
    expect(changes).toEqual([{ kind: "moved", ref: "~solid:1", by: [16, 8] }]);
    expect(describeChange(changes[0]!)).toBe("moved ~solid:1 by [16, 8]");
  });

  it("pairs a same-center entry with a new size as resized", () => {
    const b = scene({ solid: [solid[0]!, ["box", 100, 0, 20, 10], solid[2]!, solid[3]!] });
    const changes = diffScenes(scene({ solid }), b);
    expect(changes).toEqual([
      {
        kind: "resized",
        ref: "~solid:1",
        from: ["box", 100, 0, 10, 10],
        to: ["box", 100, 0, 20, 10],
      },
    ]);
    expect(describeChange(changes[0]!)).toBe(
      "resized ~solid:1 [box 100 0 10 10] -> [box 100 0 20 10]",
    );
  });

  it("pairs neither a new tag, a rotation, nor a new center and size", () => {
    const kinds = (entry: ShapeTuple) =>
      diffScenes(scene({ solid }), scene({ solid: [solid[0]!, entry, solid[2]!, solid[3]!] })).map(
        (c) => c.kind,
      );
    expect(kinds(["circle", 100, 0, 10])).toEqual(["removed", "added"]);
    expect(kinds(["box", 100, 0, 10, 10, 45])).toEqual(["removed", "added"]);
    expect(kinds(["box", 104, 0, 20, 10])).toEqual(["removed", "added"]);
  });

  it("finds one moved or resized box in a 200-entry bucket", () => {
    const big: ShapeTuple[] = Array.from({ length: 200 }, (_, i) => ["box", i * 30, 500, 10, 10]);
    const moved = big.map((t, i): ShapeTuple => (i === 117 ? ["box", t[1] + 4, 480, 10, 10] : t));
    expect(diffScenes(scene({ solid: big }), scene({ solid: moved }))).toEqual([
      { kind: "moved", ref: "~solid:117", by: [4, -20] },
    ]);
    const resized = big.map((t, i): ShapeTuple => (i === 42 ? ["box", t[1], 500, 10, 30] : t));
    expect(diffScenes(scene({ solid: big }), scene({ solid: resized }))).toEqual([
      { kind: "resized", ref: "~solid:42", from: big[42], to: resized[42] },
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

  it("reads any bulk key's type from the key, points and material keys included", () => {
    const a = scene({ peg: [[1, 1]], "solid:ice": [["box", 0, 0, 1, 1]] });
    const b = scene({ peg: [[4, 5]] });
    expect(diffScenes(a, b)).toEqual([
      { kind: "moved", ref: "~peg:0", by: [3, 4] },
      { kind: "removed", ref: "~solid:ice:0", type: "solid" },
    ]);
  });

  it("finds bulk keys without a registry, in canonical order", () => {
    expect(bulkKeysOf(scene({ peg: [], "solid:ice": [], solid: [], settings: {} }))).toEqual([
      "peg",
      "solid",
      "solid:ice",
    ]);
  });
});

describe("diffScenes: scene fields", () => {
  it("reports v, game, name, bounds and each settings key", () => {
    const changes = diffScenes(
      scene({ settings: { gravity: [0, 1200] } }),
      scene({
        v: 2,
        game: "x",
        name: "e",
        bounds: [0, 0, 50, 50],
        settings: { gravity: [0, 900], wind: 4 },
      }),
    );
    expect(changes.map((c) => c.kind === "scene" && c.field)).toEqual([
      "v",
      "game",
      "name",
      "bounds",
      "settings.gravity",
      "settings.wind",
    ]);
    expect(describeChange(changes[2]!)).toBe('scene.name: "d" -> "e"');
    expect(describeChange(changes[5]!)).toBe("scene.settings.wind: (unset) -> 4");
  });
});

describe("diffScenes: assets and z", () => {
  it("reports the assets header as a set, ignoring order and repeats", () => {
    expect(diffScenes(scene({ assets: ["a", "b"] }), scene({ assets: ["b", "a", "a"] }))).toEqual(
      [],
    );
    const changes = diffScenes(scene({ assets: ["a"] }), scene({ assets: ["a", "b"] }));
    expect(changes).toEqual([{ kind: "scene", field: "assets", from: ["a"], to: ["a", "b"] }]);
    expect(describeChange(changes[0]!)).toBe('scene.assets: ["a"] -> ["a","b"]');
    expect(diffScenes(scene({ assets: ["a"] }), scene()).map(describeChange)).toEqual([
      'scene.assets: ["a"] -> (unset)',
    ]);
  });

  it("reports a z change on an entity and an instance", () => {
    const inst = { id: "g-1", prefab: "g", at: [0, 0] as [number, number] };
    const a = scene({ instances: [inst] });
    const b = scene({ instances: [{ ...inst, z: -2 }] });
    b.entities![1] = { ...b.entities![1]!, z: 4 };
    expect(diffScenes(a, b).map(describeChange)).toEqual([
      "zone.z: (unset) -> 4",
      "g-1.z: (unset) -> -2",
    ]);
  });
});
