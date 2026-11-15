import { describe, expect, it } from "vite-plus/test";

import { loadCompatRapier } from "../../__tests__/fixtures/compat-rapier";
import { canDecompose, decomposeBatch, decomposePolygon } from "../decompose";
import { expandScene } from "../expand";
import { applyOps } from "../ops";
import { isConvex, isSimplePolygon } from "../shape-geometry";
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
  it("splits 1,000 random simple polygons into convex pieces of the original vertices, area exact", () => {
    const next = rng(26);
    for (let k = 0; k < 1000; k++) {
      const poly = randomPolygon(next);
      const input = metres(poly);
      const result = decomposePolygon(input);
      if (!result.ok) throw new Error(`refused polygon ${k}: ${result.issue.message}`);
      expect(result.area2).toBe(Math.abs(twiceArea(poly)));
      const vertices = new Set(input.map(key));
      let sum = 0;
      for (const piece of result.pieces) {
        expect(piece.length).toBeGreaterThanOrEqual(3);
        expect(piece.length).toBeLessThanOrEqual(8);
        expect(isConvex(px(piece))).toBe(true);
        for (const p of piece) expect(vertices.has(key(p))).toBe(true);
        const a = twiceArea(px(piece));
        expect(Math.sign(a)).toBe(Math.sign(twiceArea(poly)));
        sum += Math.abs(a);
      }
      expect(sum).toBe(result.area2);
    }
  }, 30_000);

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
    if (result.ok) expect(result.area2 % 1).toBe(0);
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

  it("gives pieces Rapier takes as convex hulls", async () => {
    const R = await loadCompatRapier();
    const next = rng(7);
    for (let k = 0; k < 50; k++) {
      const result = decomposePolygon(metres(randomPolygon(next)));
      if (!result.ok) throw new Error("refused");
      for (const piece of result.pieces) {
        const desc = R.ColliderDesc.convexHull(new Float32Array(piece.flat()));
        expect(desc).not.toBeNull();
      }
    }
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

  it("refuses a missing entity and one with nothing to split", () => {
    const def = scene([rock({ shape: ["box", 0, 0, 1, 1] })]);
    const missing = decomposeBatch(def, "nope", engine);
    expect(!missing.ok && missing.issue.code).toBe("ref-not-found");
    const convex = decomposeBatch(def, "rock", engine);
    expect(!convex.ok && convex.issue.code).toBe("poly-invalid");
  });
});
