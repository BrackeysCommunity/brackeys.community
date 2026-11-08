import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { Pt, SceneDefinition } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import { cycleHit, marqueeSelect, pickAt } from "../picking";
import { createSpatialIndex } from "../spatial-index";

const registry = createRegistry();

/** One entity of each shape, apart from each other, plus a cloud of boxes over a solid. */
const def: SceneDefinition = {
  v: 1,
  name: "pick",
  bounds: [0, 0, 2000, 1000],
  solid: [["box", 1000, 900, 400, 20]],
  entities: [
    { id: "box", type: "solid", shape: ["box", 100, 100, 40, 20] },
    { id: "tilted", type: "solid", shape: ["box", 300, 100, 40, 40, 45] },
    { id: "ball", type: "solid", shape: ["circle", 500, 100, 30] },
    { id: "pill", type: "solid", shape: ["capsule", 700, 100, 40, 10] },
    { id: "tri", type: "solid", shape: ["poly", 900, 60, 960, 140, 840, 140] },
    { id: "rail", type: "solid", shape: ["chain", 1100, 100, 1300, 100, 1300, 200] },
    { id: "flag", type: "marker", at: [1500, 100] },
    { id: "cloud", type: "solid", layer: "decor", shape: ["box", 1000, 890, 60, 20] },
  ],
};

const index = createSpatialIndex();
index.rebuild(def, registry);

const refsAt = (p: Pt, scale: number, layers?: { hidden: string[]; locked: string[] }) =>
  pickAt(index, p, {
    tolPx: 4,
    scale,
    ...(layers
      ? { layers: { hidden: new Set(layers.hidden), locked: new Set(layers.locked) } }
      : {}),
  }).map((e) => e.ref);

describe("pickAt", () => {
  // At scale 1 the 4px tolerance is 4 world px; at scale 4 it is 1.
  const cases: { ref: string; inside: Pt; near: Pt; far: Pt }[] = [
    { ref: "box", inside: [100, 100], near: [143, 100], far: [146, 100] },
    // The diamond's right corner is at 300 + 40√2 ≈ 356.6; a box's slack is square in its own frame.
    { ref: "tilted", inside: [350, 100], near: [359, 100], far: [363, 100] },
    { ref: "ball", inside: [520, 100], near: [533, 100], far: [536, 100] },
    { ref: "pill", inside: [700, 145], near: [700, 153], far: [700, 156] },
    { ref: "tri", inside: [900, 120], near: [900, 143], far: [900, 146] },
    { ref: "rail", inside: [1200, 100], near: [1200, 103], far: [1200, 106] },
  ];

  for (const c of cases) {
    it(`hits ${c.ref} within the tolerance at scale 1, and only closer at scale 4`, () => {
      expect(refsAt(c.inside, 1)).toContain(c.ref);
      expect(refsAt(c.near, 1)).toContain(c.ref);
      expect(refsAt(c.far, 1)).not.toContain(c.ref);
      expect(refsAt(c.inside, 4)).toContain(c.ref);
      expect(refsAt(c.near, 4)).not.toContain(c.ref);
    });
  }

  it("never hits a chain's inside", () => {
    expect(refsAt([1250, 150], 1)).not.toContain("rail");
  });

  it("picks a point within its radius in screen px", () => {
    expect(refsAt([1507, 100], 1)).toEqual(["flag"]);
    expect(refsAt([1507, 100], 2)).toEqual([]);
    expect(refsAt([1503, 100], 2)).toEqual(["flag"]);
  });

  it("puts the topmost layer first and skips hidden and locked layers", () => {
    expect(refsAt([1000, 895], 1)).toEqual(["cloud", "~solid:0"]);
    expect(refsAt([1000, 895], 1, { hidden: ["decor"], locked: [] })).toEqual(["~solid:0"]);
    expect(refsAt([1000, 895], 1, { hidden: [], locked: ["terrain"] })).toEqual(["cloud"]);
  });
});

describe("cycleHit", () => {
  const hits = pickAt(index, [1000, 895], { tolPx: 4, scale: 1 });
  it("starts at the top and walks down, wrapping", () => {
    expect(cycleHit(hits)).toBe("cloud");
    expect(cycleHit(hits, "cloud")).toBe("~solid:0");
    expect(cycleHit(hits, "~solid:0")).toBe("cloud");
    expect(cycleHit(hits, "elsewhere")).toBe("cloud");
    expect(cycleHit([], "cloud")).toBeUndefined();
  });
});

describe("marqueeSelect", () => {
  it("selects what it contains, or with touch what it touches", () => {
    const rect = { minX: 50, minY: 50, maxX: 345, maxY: 150 };
    expect(marqueeSelect(index, rect, { touch: false })).toEqual(["box"]);
    expect(marqueeSelect(index, rect, { touch: true }).sort()).toEqual(["box", "tilted"]);
  });

  it("uses exact geometry when touching", () => {
    // Inside the tilted box's AABB corner, outside the diamond.
    const corner = { minX: 340, minY: 60, maxX: 350, maxY: 70 };
    expect(marqueeSelect(index, corner, { touch: true })).toEqual([]);
  });

  it("selects points inside it and skips hidden and locked layers", () => {
    const all = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };
    const layers = { hidden: new Set<string>(["terrain"]), locked: new Set<string>(["decor"]) };
    const picked = marqueeSelect(index, all, { touch: false, layers });
    expect(picked).toContain("flag");
    expect(picked).not.toContain("~solid:0");
    expect(picked).not.toContain("cloud");
    expect(picked).toHaveLength(7);
  });

  it("picks the engine yard's follower at its path's first point", () => {
    const yardIndex = createSpatialIndex();
    yardIndex.rebuild(structuredClone(yard) as unknown as SceneDefinition, registry);
    expect(pickAt(yardIndex, [1700, 900], { tolPx: 4, scale: 1 }).map((e) => e.ref)).toContain(
      "lift",
    );
    expect(pickAt(yardIndex, [1700, 600], { tolPx: 4, scale: 1 }).map((e) => e.ref)).not.toContain(
      "lift",
    );
  });
});
