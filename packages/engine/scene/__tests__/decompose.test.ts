// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { loadCompatRapier } from "../../__tests__/fixtures/compat-rapier";
import { createRegistry, defineGame } from "../../game/define";
import type { Registry } from "../../game/types";
import { canDecompose, decomposeBatch, decomposePolygon, splittableSite } from "../decompose";
import { expandScene } from "../expand";
import { applyOps } from "../ops";
import { cross3, isConvex, isSimplePolygon, segmentsMeet } from "../shape-geometry";
import type { EntityDef, Pt, SceneDefinition } from "../types";
import { validateScene } from "../validate";
import { engine } from "./fixtures/fake-game";

const PPM = 100;

/** A seeded LCG, so every run draws the same polygons. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A random star-shaped integer polygon in whole px, kept only when simple. */
function randomPolygon(next: () => number): Pt[] {
  for (;;) {
    const n = 4 + Math.floor(next() * 14);
    const angles = Array.from({ length: n }, () => next() * 2 * Math.PI).sort((a, b) => a - b);
    const pts = angles.map((a): Pt => {
      const r = 20 + Math.floor(next() * 200);
      return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
    });
    if (isSimplePolygon(pts)) return next() < 0.5 ? pts : pts.reverse();
  }
}

/**
 * A random simple integer polygon that needn't be star-shaped: random points
 * joined in a random order, then untangled by 2-opt (reversing the run
 * between two crossing edges) until no edges cross.
 */
function untangledPolygon(next: () => number): Pt[] {
  for (;;) {
    const n = 5 + Math.floor(next() * 16);
    const pts = Array.from(
      { length: n },
      (): Pt => [Math.floor(next() * 400), Math.floor(next() * 400)],
    );
    for (let pass = 0, crossed = true; crossed && pass < 500; pass++) {
      crossed = false;
      for (let i = 0; i < n - 2 && !crossed; i++)
        for (let j = i + 2; j < n && !crossed; j++) {
          if (i === 0 && j === n - 1) continue;
          if (!segmentsMeet(pts[i]!, pts[i + 1]!, pts[j]!, pts[(j + 1) % n]!)) continue;
          pts.splice(i + 1, j - i, ...pts.slice(i + 1, j + 1).reverse());
          crossed = true;
        }
    }
    if (isSimplePolygon(pts) && !isConvex(pts)) return pts;
  }
}

/** A comb: a bar with `teeth` upright teeth, `w` px wide and as far apart. */
function comb(teeth: number, w: number): Pt[] {
  const pts: Pt[] = [
    [0, 0],
    [(2 * teeth - 1) * w, 0],
  ];
  for (let t = teeth - 1; t >= 0; t--) {
    pts.push([2 * t * w + w, 100], [2 * t * w, 100]);
    if (t > 0) pts.push([2 * t * w, 20], [2 * t * w - w, 20]);
  }
  return pts;
}

/** An arm wound `turns` times about the origin, `width` px thick. */
function spiral(turns: number, width: number): Pt[] {
  const steps = Math.round(turns * 32);
  const arm = (k: number, r0: number): Pt => {
    const a = (k / 32) * 2 * Math.PI;
    const r = r0 + 60 * a;
    return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
  };
  const outer = Array.from({ length: steps + 1 }, (_, k) => arm(k, 40 + width));
  const inner = Array.from({ length: steps + 1 }, (_, k) => arm(steps - k, 40));
  return [...outer, ...inner];
}

const twiceArea = (pts: readonly Pt[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a;
};

const metres = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]): Pt => [x / PPM, y / PPM]);
const px = (pts: readonly Pt[]): Pt[] =>
  pts.map(([x, y]): Pt => [Math.round(x * PPM), Math.round(y * PPM)]);
const key = ([x, y]: Pt) => `${x},${y}`;

const ell: Pt[] = metres([
  [0, 0],
  [400, 0],
  [400, 100],
  [100, 100],
  [100, 300],
  [0, 300],
]);

describe("decomposePolygon", () => {
  /** Checks `poly` (whole px) splits into convex pieces of its own vertices whose areas sum exactly. */
  const expectExactSplit = (poly: readonly Pt[], label: string) => {
    const input = metres(poly);
    const result = decomposePolygon(input);
    if (!result.ok) throw new Error(`refused ${label}: ${result.issue.message}`);
    expect(result.area2, label).toBe(Math.abs(twiceArea(poly)));
    const vertices = new Set(input.map(key));
    let sum = 0;
    for (const piece of result.pieces) {
      expect(piece.length, label).toBeGreaterThanOrEqual(3);
      expect(piece.length, label).toBeLessThanOrEqual(8);
      expect(isConvex(px(piece)), label).toBe(true);
      for (const p of piece) expect(vertices.has(key(p)), label).toBe(true);
      const a = twiceArea(px(piece));
      expect(Math.sign(a), label).toBe(Math.sign(twiceArea(poly)));
      sum += Math.abs(a);
    }
    expect(sum, label).toBe(result.area2);
    return result;
  };

  /**
   * Splits 1,000 polygons `draw` gives. One that leaves a sliver Rapier
   * refuses (two parts nearly meeting) is refused instead, and is rare.
   */
  const splitThousand = (draw: () => Pt[], label: string) => {
    let refused = 0;
    for (let k = 0; k < 1000; ) {
      const poly = draw();
      const result = decomposePolygon(metres(poly));
      if (!result.ok) {
        expect(result.issue.message, `${label} ${k}`).toContain("too thin");
        refused++;
        continue;
      }
      expectExactSplit(poly, `${label} ${k++}`);
    }
    expect(refused).toBeLessThan(50);
  };

  it("splits 1,000 random star-shaped polygons into convex pieces of the original vertices, area exact", () => {
    const next = rng(26);
    splitThousand(() => randomPolygon(next), "star");
  }, 30_000);

  it("splits 1,000 random simple polygons that aren't star-shaped the same way", () => {
    const next = rng(54);
    splitThousand(() => untangledPolygon(next), "untangled");
  }, 60_000);

  it("splits a comb and a spiral exactly", () => {
    const teeth = comb(6, 10);
    expect(isSimplePolygon(teeth)).toBe(true);
    const combed = expectExactSplit(teeth, "comb");
    expect(combed.ok && combed.pieces.length).toBeGreaterThanOrEqual(6);
    for (const turns of [1.5, 2.5]) {
      const arm = spiral(turns, 50);
      expect(isSimplePolygon(arm), `spiral ${turns}`).toBe(true);
      expectExactSplit(arm, `spiral ${turns}`);
      expectExactSplit([...arm].reverse(), `spiral ${turns} reversed`);
    }
  });

  it("keeps pieces at most maxVertices and merges an L into two", () => {
    const result = decomposePolygon(ell);
    expect(result.ok && result.pieces.length).toBe(2);
    const fine = decomposePolygon(ell, { maxVertices: 3 });
    expect(fine.ok && fine.pieces.every((p) => p.length === 3)).toBe(true);
  });

  it("works in the game's px per metre", () => {
    const at32 = ell.map(([x, y]): Pt => [Math.round(x * 32) / 32, Math.round(y * 32) / 32]);
    const result = decomposePolygon(at32, { pxPerMetre: 32 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.area2 % 1).toBe(0);
      expect(result.pieceArea2.reduce((a, b) => a + Math.abs(b), 0)).toBe(result.area2);
    }
  });

  it("refuses self-intersecting, collinear and two-point input", () => {
    const bowtie: Pt[] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ];
    const line: Pt[] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    const two: Pt[] = [
      [0, 0],
      [1, 0],
    ];
    for (const pts of [bowtie, line, two]) {
      const result = decomposePolygon(pts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issue.code).toBe("poly-invalid");
      expect(canDecompose(pts)).toBe(false);
    }
  });

  it("offers a split for a concave simple polygon only", () => {
    expect(canDecompose(ell)).toBe(true);
    expect(
      canDecompose([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(false);
  });

  it("gives pieces Rapier builds as the engine does, keeping every corner", async () => {
    const R = await loadCompatRapier();
    const world = new R.World(new R.Vector2(0, 0));
    const next = rng(7);
    // A corner turning under about 1.5° Rapier drops from any poly, so these turn more.
    const turnsEnough = (poly: readonly Pt[]) =>
      poly.every((b, i) => {
        const a = poly[(i + poly.length - 1) % poly.length]!;
        const c = poly[(i + 1) % poly.length]!;
        const turn = Math.atan2(
          Math.abs(cross3(a, b, c)),
          (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]),
        );
        return turn > (2 * Math.PI) / 180;
      });
    const draw = (gen: () => Pt[]) => {
      for (;;) {
        const poly = gen();
        if (turnsEnough(poly) && decomposePolygon(metres(poly)).ok) return poly;
      }
    };
    const polys = [
      ...Array.from({ length: 25 }, () => draw(() => randomPolygon(next))),
      ...Array.from({ length: 25 }, () => draw(() => untangledPolygon(next))),
      comb(4, 10),
      spiral(2, 50),
      // In-line points on an edge leave the pieces, as Rapier would drop them.
      [
        [0, 0],
        [200, 0],
        [400, 0],
        [400, 100],
        [100, 100],
        [100, 300],
        [0, 300],
        [0, 150],
      ] as Pt[],
    ];
    for (const [k, poly] of polys.entries()) {
      const result = decomposePolygon(metres(poly));
      if (!result.ok) throw new Error(`polygon ${k}: ${result.issue.message}`);
      for (const piece of result.pieces) {
        // physics.ts builds a poly collider this way: counter-clockwise, no hull.
        const ccw = twiceArea(piece) < 0 ? [...piece].reverse() : piece;
        const desc = R.ColliderDesc.convexPolyline(new Float32Array(ccw.flat()))!.setDensity(1);
        const collider = world.createCollider(desc);
        // A dropped corner would cut a sliver off the mass.
        const area = Math.abs(twiceArea(piece)) / 2;
        expect(Math.abs(collider.mass() - area) / area, `polygon ${k}`).toBeLessThan(1e-3);
      }
    }
    world.free();
  });

  it("refuses a polygon that forces a sliver Rapier would refuse", () => {
    // The dip sits 1 px over the floor, so the floor's piece is a triangle 179° wide.
    const dip = metres([
      [0, 0],
      [400, 0],
      [400, 100],
      [200, 1],
      [0, 100],
    ]);
    const result = decomposePolygon(dip);
    expect(!result.ok && result.issue.code).toBe("poly-invalid");
    expect(!result.ok && result.issue.message).toContain("too thin");
    expect(canDecompose(dip)).toBe(false);
  });

  it("refuses a point off the whole-px grid rather than moving it", () => {
    const off: Pt[] = ell.map(([x, y], k): Pt => (k === 3 ? [x + 0.123, y] : [x, y]));
    expect(canDecompose(off)).toBe(false);
    const result = decomposePolygon(off);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("poly-invalid");
      expect(result.issue.message).toContain("snap it first");
    }
  });

  it("returns the caller's own points, not re-derived ones", () => {
    const result = decomposePolygon(ell);
    if (!result.ok) throw new Error(result.issue.message);
    for (const piece of result.pieces)
      for (const p of piece) expect(ell.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true);
    for (const piece of result.pieces)
      for (let i = 0; i < piece.length; i++)
        expect(
          cross3(
            px([piece[(i + piece.length - 1) % piece.length]!])[0]!,
            px([piece[i]!])[0]!,
            px([piece[(i + 1) % piece.length]!])[0]!,
          ),
        ).not.toBe(0);
  });
});

describe("decomposeBatch", () => {
  const rock = (over: Partial<EntityDef> = {}): EntityDef => ({
    id: "rock",
    type: "prop",
    shape: ["poly", ...ell.flat()],
    density: 1,
    restitution: 0,
    ...over,
  });
  const scene = (extra: EntityDef[]): SceneDefinition => ({
    v: 1,
    name: "t",
    bounds: [0, 0, 1000, 1000],
    entities: extra,
  });
  const polyIssues = (def: SceneDefinition) =>
    validateScene(def, engine).filter((i) => i.code === "poly-invalid");

  it("replaces the entity with one per piece, ids skipping those taken, and validates", () => {
    const def = scene([rock(), { id: "rock-1", type: "marker", at: [5, 5] }]);
    expect(polyIssues(def)).toHaveLength(1);
    const made = decomposeBatch(def, "rock", engine);
    if (!made.ok) throw new Error(made.issue.message);
    const applied = applyOps(def, made.batch, engine);
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    const ids = (applied.def.entities ?? []).map((e) => e.id);
    expect(ids).toEqual(["rock-2", "rock-3", "rock-1"]);
    const piece = applied.def.entities![0]!;
    expect(piece).toMatchObject({ type: "prop", density: 1, restitution: 0 });
    expect(polyIssues(applied.def)).toEqual([]);
    expect(() => expandScene(applied.def, engine)).not.toThrow();
  });

  it("wraps the pieces in a node named for the entity with group", () => {
    const def = scene([rock()]);
    const made = decomposeBatch(def, "rock", engine, { group: true });
    if (!made.ok) throw new Error(made.issue.message);
    const applied = applyOps(def, made.batch, engine);
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    const list = applied.def.entities ?? [];
    expect(list.map((e) => [e.id, e.type, e.parent])).toEqual([
      ["rock", "node", undefined],
      ["rock-1", "prop", "rock"],
      ["rock-2", "prop", "rock"],
    ]);
    expect(polyIssues(applied.def)).toEqual([]);
  });

  it("refuses group where the game has no node type to group under", () => {
    const types = new Map([...engine.types].filter(([name]) => name !== "node"));
    const nodeless = Object.create(engine, { types: { value: types } }) as Registry;
    const made = decomposeBatch(scene([rock()]), "rock", nodeless, { group: true });
    expect(!made.ok && made.issue.code).toBe("parent-type");
    expect(!made.ok && made.issue.message).toContain("no node type");
    expect(decomposeBatch(scene([rock()]), "rock", nodeless).ok).toBe(true);
  });

  it("reports the split's areas with the batch, summing exactly", () => {
    const made = decomposeBatch(scene([rock()]), "rock", engine);
    if (!made.ok) throw new Error(made.issue.message);
    expect(made.area2).toBe(2 * (400 * 100 + 100 * 200));
    expect(made.pieceArea2.reduce((a, b) => a + Math.abs(b), 0)).toBe(made.area2);
  });

  it("refuses while another entity's behavior names it, naming the referrer", () => {
    const hinge: EntityDef = {
      id: "hinge",
      type: "marker",
      at: [1, 1],
      behaviors: { joint: { kind: "revolute", to: "rock" } },
    };
    const made = decomposeBatch(scene([rock(), hinge]), "rock", engine, { group: true });
    expect(!made.ok && made.issue).toMatchObject({
      code: "op-invalid",
      entityIds: ["rock", "hinge"],
    });
    expect(!made.ok && made.issue.message).toContain("hinge");
  });

  it("refuses a missing entity and one with nothing to split", () => {
    const def = scene([rock({ shape: ["box", 0, 0, 1, 1] })]);
    const missing = decomposeBatch(def, "nope", engine);
    expect(!missing.ok && missing.issue.code).toBe("ref-not-found");
    const convex = decomposeBatch(def, "rock", engine);
    expect(!convex.ok && convex.issue.code).toBe("poly-invalid");
  });
});

describe("splittableSite", () => {
  const concave = ["poly", ...ell.flat()] as EntityDef["shape"];
  const collider = ["poly", 0, 0, 2, 0, 1, 0.5, 2, 1, 0, 1];

  it("skips a polygon field and a convex poly for the first concave one decomposeBatch splits", () => {
    const room: EntityDef = {
      id: "room",
      type: "nav",
      shape: concave,
      behaviors: { collider: { shape: collider } },
    };
    expect(splittableSite(engine, room)?.field).toBe("behaviors.collider.shape");
    expect(splittableSite(engine, { id: "hall", type: "nav", shape: concave })).toBeNull();
    const made = decomposeBatch(
      { v: 1, name: "t", bounds: [0, 0, 10, 10], entities: [room] },
      "room",
      engine,
    );
    expect(made.ok && made.batch.ops.filter((o) => o.op === "add").length).toBeGreaterThan(1);
  });

  it("judges at the game's px per metre", () => {
    const coarse = createRegistry(
      defineGame({
        id: "coarse",
        types: [],
        actions: [],
        world: { lengthUnit: 1 },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    // A 0.2 m notch is off the whole-px grid at 1 px per metre.
    const notched = ["poly", 0, 0, 4, 0, 4, 4, 2, 4, 2, 3.8, 1.9, 4, 0, 4];
    const rock: EntityDef = {
      id: "rock",
      type: "prop",
      shape: notched,
      density: 1,
      restitution: 0,
    };
    expect(splittableSite(engine, rock)?.field).toBe("shape");
    expect(splittableSite(coarse, rock)).toBeNull();
    const def: SceneDefinition = { v: 1, name: "t", bounds: [0, 0, 10, 10], entities: [rock] };
    expect(decomposeBatch(def, "rock", coarse).ok).toBe(false);
    expect(decomposeBatch(def, "rock", engine).ok).toBe(true);
  });
});
