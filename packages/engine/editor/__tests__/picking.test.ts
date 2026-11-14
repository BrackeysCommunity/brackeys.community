import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { Pt, SceneDefinition } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import kitchenSink from "../../scenes/kitchen-sink.json";
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
    // Screen px per metre at zoom 1.
    const at = (p: Pt) => pickAt(yardIndex, p, { tolPx: 4, scale: 100 }).map((e) => e.ref);
    expect(at([17, 9])).toContain("lift");
    expect(at([17, 6])).not.toContain("lift");
  });
});

describe("sprite boxes", () => {
  const decal = defineEntityType({
    type: "decal",
    description: "A picture with no body.",
    system: () => ({ spawn: () => {}, despawn: () => {}, clear: () => {}, size: () => 0 }),
    fields: { at: pointField("Where its sprite is posed.") },
    behaviors: { required: { sprite: { size: [0.4, 0.6], anchor: [0.5, 1] } } },
  });
  const walls = createRegistry(
    defineGame({
      id: "walls",
      types: [decal],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const scene: SceneDefinition = {
    v: 3,
    name: "sprites",
    bounds: [0, 0, 10, 5],
    entities: [
      {
        id: "crate",
        type: "prop",
        shape: ["box", 1, 1, 0.1, 0.1],
        density: 1,
        restitution: 0,
        behaviors: { sprite: { size: [0.8, 0.4] } },
      },
      { id: "pin", type: "marker", at: [3, 1], behaviors: { sprite: { asset: "pin" } } },
      { id: "poster", type: "decal", at: [5, 2] },
    ],
  };
  const spriteIndex = createSpatialIndex({
    asset: (id) => (id === "pin" ? { id, kind: "texture", size: [20, 100] } : undefined),
  });
  spriteIndex.rebuild(scene, walls);
  // Screen px per metre at zoom 1 in a 100 px per metre game.
  const hits = (p: Pt) => pickAt(spriteIndex, p, { tolPx: 0, scale: 100 }).map((e) => e.ref);

  it("hits a body's sprite where it draws past the body", () => {
    expect(hits([1.35, 1])).toEqual(["crate"]);
    expect(hits([1, 1.25])).toEqual([]);
  });

  it("hits a point entity anywhere in its sprite's box, sized from the asset lookup", () => {
    // The 20 × 100 px texture is 0.2 × 1 m at 100 px per metre.
    expect(hits([3, 1.45])).toEqual(["pin"]);
    expect(hits([3, 1.55])).toEqual([]);
    // A type's required sprite: bottom-centre anchored, so the box stands on the point.
    expect(hits([5.15, 1.5])).toEqual(["poster"]);
    expect(hits([5, 2.05])).toEqual([]);
  });

  it("selects by the sprite's box in a marquee", () => {
    const around = { minX: 4.7, minY: 1.3, maxX: 5.3, maxY: 2.1 };
    expect(marqueeSelect(spriteIndex, around, { touch: false })).toEqual(["poster"]);
    const touching = { minX: 1.3, minY: 0.9, maxX: 1.5, maxY: 1.1 };
    expect(marqueeSelect(spriteIndex, touching, { touch: false })).toEqual([]);
    expect(marqueeSelect(spriteIndex, touching, { touch: true })).toEqual(["crate"]);
  });
});

describe("camera regions", () => {
  const scene: SceneDefinition = {
    v: 3,
    name: "regions",
    bounds: [0, 0, 20, 6],
    entities: [
      {
        id: "crate",
        type: "marker",
        at: [5, 3],
        behaviors: { sprite: { size: [0.4, 0.4], anchor: [0.5, 0.5] } },
      },
      { id: "room", type: "camera-region", shape: ["box", 5, 2.5, 3, 2] },
      // Framed as its bounds: x 11.902…18.098, y 0.134…4.866.
      { id: "hall", type: "camera-region", shape: ["box", 15, 2.5, 3, 1, 30] },
    ],
  };
  const regionIndex = createSpatialIndex();
  regionIndex.rebuild(scene, registry);
  // 4 screen px at 100 px per metre: 0.04 m of slack.
  const hits = (p: Pt) => pickAt(regionIndex, p, { tolPx: 4, scale: 100 }).map((e) => e.ref);

  it("picks what's inside a region rather than the region, which picks only by its outline", () => {
    // In the crate's sprite, clear of its point's pick radius.
    expect(hits([5.15, 3.15])).toEqual(["crate"]);
    expect(hits([4, 2])).toEqual([]);
    expect(hits([2.03, 2.5])).toEqual(["room"]);
    expect(hits([1.97, 2.5])).toEqual(["room"]);
    expect(hits([1.9, 2.5])).toEqual([]);
    expect(hits([5, 4.5])).toEqual(["room"]);
  });

  it("picks a turned region by the box it frames, not its turned outline", () => {
    // On the turned box's own edge, well inside the box the region frames.
    expect(hits([14.5, 3.366])).toEqual([]);
    expect(hits([11.902, 2.5])).toEqual(["hall"]);
    expect(hits([15, 4.866])).toEqual(["hall"]);
  });

  it("picks the kitchen sink's tweened crate inside its framing region", () => {
    const sinkIndex = createSpatialIndex();
    sinkIndex.rebuild(structuredClone(kitchenSink) as unknown as SceneDefinition, registry);
    const at = (p: Pt) => pickAt(sinkIndex, p, { tolPx: 4, scale: 100 }).map((e) => e.ref);
    expect(at([11.7, 5.1])).toEqual(["std-tween"]);
    expect(at([9, 4])).toEqual(["framing"]);
  });

  it("marquees a region by the box it frames, and with touch by its outline only", () => {
    const inside = { minX: 4, minY: 2, maxX: 6, maxY: 3.5 };
    expect(marqueeSelect(regionIndex, inside, { touch: true })).toEqual(["crate"]);
    const crossing = { minX: 7.5, minY: 2, maxX: 8.5, maxY: 3 };
    expect(marqueeSelect(regionIndex, crossing, { touch: true })).toEqual(["room"]);
    const aroundHall = { minX: 11.8, minY: 0.1, maxX: 18.2, maxY: 4.9 };
    expect(marqueeSelect(regionIndex, aroundHall, { touch: false })).toEqual(["hall"]);
    const aroundTurned = { minX: 12, minY: 0.2, maxX: 18, maxY: 4.8 };
    expect(marqueeSelect(regionIndex, aroundTurned, { touch: false })).toEqual([]);
  });
});
