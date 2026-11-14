import { describe, expect, it } from "vite-plus/test";

import {
  applyPt,
  applyVec,
  compose,
  composeDihedral,
  composeFrames,
  composeOrientations,
  dihedral,
  dihedralOf,
  flipWorld,
  frame,
  frameOf,
  isQuarterTurn,
  IDENTITY_2D,
  invert,
  inverseTurn,
  isIdentityTurn,
  translation,
  turnOf,
  type Dihedral,
  type Frame,
  type Transform2D,
} from "../transform";

type Pt = [number, number];

const ELEMENTS: Dihedral[] = [false, true].flatMap((flip) =>
  ([0, 1, 2, 3] as const).map((rot) => ({ rot, flip })),
);

/** A seeded LCG, so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function randomPts(n: number, seed = 7): Pt[] {
  const next = rng(seed);
  const int = () => (next() % 20001) - 10000;
  return Array.from({ length: n }, () => [int(), int()] as Pt);
}

const linear = (t: Transform2D) => [t.a, t.b, t.c, t.d];

describe("dihedral", () => {
  it("turns clockwise on screen with y down", () => {
    expect(applyVec(dihedral({ rot: 1, flip: false }, [0, 0]), [1, 0])).toEqual([0, 1]);
    expect(applyVec(dihedral({ rot: 1, flip: false }, [0, 0]), [0, 1])).toEqual([-1, 0]);
    expect(applyVec(dihedral({ rot: 3, flip: false }, [0, 0]), [1, 0])).toEqual([0, -1]);
  });

  it("mirrors x before turning, then translates to `at`", () => {
    const t = dihedral({ rot: 1, flip: true }, [10, 20]);
    // [3, 4] → mirrored [-3, 4] → turned [-4, -3] → moved [6, 17]
    expect(applyPt(t, [3, 4])).toEqual([6, 17]);
  });

  it("gives the identity for no turn and no flip at the origin", () => {
    expect(dihedral({ rot: 0, flip: false }, [0, 0])).toEqual(IDENTITY_2D);
  });

  it("spells each of the eight elements once", () => {
    const seen = new Set(ELEMENTS.map((d) => linear(dihedral(d, [0, 0])).join(",")));
    expect(seen.size).toBe(8);
    for (const d of ELEMENTS) expect(dihedralOf(dihedral(d, [5, -3]))).toEqual(d);
  });

  it("has integer entries and no negative zeros", () => {
    for (const d of ELEMENTS) {
      for (const v of Object.values(dihedral(d, [0, 0]))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(Object.is(v, -0)).toBe(false);
      }
    }
  });
});

describe("compose, invert, applyPt", () => {
  it("inverts every element exactly on random integer points", () => {
    const pts = randomPts(200);
    for (const d of ELEMENTS) {
      for (const at of randomPts(5, 99)) {
        const t = dihedral(d, at);
        const inv = invert(t);
        for (const p of pts) {
          const q = applyPt(t, p);
          expect(Number.isInteger(q[0]) && Number.isInteger(q[1])).toBe(true);
          expect(applyPt(inv, q)).toEqual(p);
        }
        expect(compose(t, inv)).toEqual(IDENTITY_2D);
        expect(compose(inv, t)).toEqual(IDENTITY_2D);
      }
    }
  });

  it("composes as outer after inner", () => {
    const outer = dihedral({ rot: 1, flip: false }, [100, 0]);
    const inner = dihedral({ rot: 0, flip: true }, [5, 5]);
    for (const p of randomPts(50)) {
      expect(applyPt(compose(outer, inner), p)).toEqual(applyPt(outer, applyPt(inner, p)));
    }
  });

  it("applies only the linear part to vectors", () => {
    const t = dihedral({ rot: 2, flip: false }, [100, 200]);
    expect(applyVec(t, [3, 4])).toEqual([-3, -4]);
    expect(applyPt(t, [3, 4])).toEqual([97, 196]);
  });

  it("refuses a transform with no inverse", () => {
    expect(() => invert({ a: 0, b: 0, c: 0, d: 0, tx: 1, ty: 1 })).toThrow(/no inverse/);
  });
});

describe("dihedralOf", () => {
  it("is null for a linear part outside the group", () => {
    expect(dihedralOf({ ...IDENTITY_2D, a: 2 })).toBeNull();
    expect(dihedralOf({ a: 0.6, b: 0.8, c: -0.8, d: 0.6, tx: 0, ty: 0 })).toBeNull();
  });
});

describe("composeDihedral", () => {
  it("agrees with matrix compose for every pair", () => {
    for (const outer of ELEMENTS) {
      for (const inner of ELEMENTS) {
        const m = compose(dihedral(outer, [0, 0]), dihedral(inner, [0, 0]));
        expect(dihedralOf(m), `${JSON.stringify(outer)} ∘ ${JSON.stringify(inner)}`).toEqual(
          composeDihedral(outer, inner),
        );
      }
    }
  });

  it("is closed, with an identity and an inverse for every element", () => {
    const key = (d: Dihedral) => `${d.rot}${d.flip}`;
    const all = new Set(ELEMENTS.map(key));
    const id: Dihedral = { rot: 0, flip: false };
    for (const a of ELEMENTS) {
      expect(composeDihedral(id, a)).toEqual(a);
      expect(composeDihedral(a, id)).toEqual(a);
      expect(ELEMENTS.some((b) => key(composeDihedral(a, b)) === key(id))).toBe(true);
      for (const b of ELEMENTS) expect(all.has(key(composeDihedral(a, b)))).toBe(true);
    }
  });

  it("is associative", () => {
    for (const a of ELEMENTS)
      for (const b of ELEMENTS)
        for (const c of ELEMENTS)
          expect(composeDihedral(composeDihedral(a, b), c)).toEqual(
            composeDihedral(a, composeDihedral(b, c)),
          );
  });
});

describe("flipWorld", () => {
  it("mirrors world x and world y", () => {
    for (const d of ELEMENTS) {
      const t = dihedral(d, [0, 0]);
      for (const p of randomPts(20)) {
        const [x, y] = applyPt(t, p);
        expect(applyPt(dihedral(flipWorld(d, "x"), [0, 0]), p)).toEqual([0 - x, y]);
        expect(applyPt(dihedral(flipWorld(d, "y"), [0, 0]), p)).toEqual([x, 0 - y]);
      }
    }
  });

  it('gives "y" as a flip followed by a half turn', () => {
    for (const d of ELEMENTS) {
      expect(flipWorld(d, "y")).toEqual(
        composeDihedral({ rot: 2, flip: false }, flipWorld(d, "x")),
      );
    }
  });

  it("undoes itself", () => {
    for (const d of ELEMENTS) {
      expect(flipWorld(flipWorld(d, "x"), "x")).toEqual(d);
      expect(flipWorld(flipWorld(d, "y"), "y")).toEqual(d);
    }
  });
});

describe("turn helpers", () => {
  it("turnOf reads rot in degrees and flip, null off the quarter turns", () => {
    expect(turnOf({})).toEqual({ rot: 0, flip: false });
    expect(turnOf({ rot: 270, flip: true })).toEqual({ rot: 3, flip: true });
    expect(turnOf({ rot: 360 })).toEqual({ rot: 0, flip: false });
    expect(turnOf({ rot: -90 })).toEqual({ rot: 3, flip: false });
    expect(turnOf({ rot: 30 })).toBeNull();
  });

  it("inverseTurn undoes every element", () => {
    for (const d of ELEMENTS) {
      expect(isIdentityTurn(composeDihedral(inverseTurn(d), d))).toBe(true);
      expect(isIdentityTurn(composeDihedral(d, inverseTurn(d)))).toBe(true);
    }
    expect(ELEMENTS.filter(isIdentityTurn)).toEqual([{ rot: 0, flip: false }]);
  });

  it("translation only moves", () => {
    expect(translation([3, -4])).toEqual({ ...IDENTITY_2D, tx: 3, ty: -4 });
    expect(applyPt(translation([3, -4]), [1, 1])).toEqual([4, -3]);
  });
});

describe("rigid frames", () => {
  it("builds quarter turns from integers, the same transforms as dihedral", () => {
    for (const d of ELEMENTS) {
      for (const at of randomPts(20, 3 + d.rot)) {
        const f: Frame = { at, rot: 90 * d.rot, flip: d.flip };
        expect(frame(f)).toEqual(dihedral(d, at));
        expect(frame({ ...f, rot: f.rot - 360 })).toEqual(dihedral(d, at));
        expect(frameOf(frame(f))).toEqual({ rot: 90 * d.rot, flip: d.flip });
      }
    }
  });

  it("turns clockwise on screen at any angle, mirroring x first", () => {
    const t = frame({ at: [10, 20], rot: 30, flip: false });
    const [x, y] = applyPt(t, [1, 0]);
    expect(x).toBeCloseTo(10 + Math.cos(Math.PI / 6), 12);
    expect(y).toBeCloseTo(20 + Math.sin(Math.PI / 6), 12);
    const [fx, fy] = applyPt(frame({ at: [0, 0], rot: 30, flip: true }), [1, 0]);
    expect(fx).toBeCloseTo(-Math.cos(Math.PI / 6), 12);
    expect(fy).toBeCloseTo(-Math.sin(Math.PI / 6), 12);
  });

  it("reads back the angle and flip of random frames to the file's precision", () => {
    const next = rng(11);
    for (let i = 0; i < 500; i++) {
      const rot = (next() % 360_000_000) / 1e6;
      const flip = next() % 2 === 1;
      const at: Pt = [
        ((next() % 2_000_001) - 1_000_000) / 1e3,
        ((next() % 2_000_001) - 1_000_000) / 1e3,
      ];
      expect(frameOf(frame({ at, rot, flip }))).toEqual({ rot, flip });
    }
  });

  it("composes frames as their transforms compose", () => {
    const next = rng(5);
    const deg = () => (next() % 3600) / 10;
    for (let i = 0; i < 200; i++) {
      const outer: Frame = { at: [next() % 100, next() % 100], rot: deg(), flip: next() % 2 === 1 };
      const inner: Frame = { at: [next() % 100, next() % 100], rot: deg(), flip: next() % 2 === 1 };
      const want = compose(frame(outer), frame(inner));
      const got = frame(composeFrames(outer, inner));
      for (const k of ["a", "b", "c", "d", "tx", "ty"] as const)
        expect(got[k]).toBeCloseTo(want[k], 5);
      expect(composeFrames(outer, inner)).toMatchObject(composeOrientations(outer, inner));
    }
  });

  it("keeps quarter turns of integer frames on integers", () => {
    for (const a of ELEMENTS)
      for (const b of ELEMENTS) {
        const f = composeFrames(
          { at: [3, -7], rot: 90 * a.rot, flip: a.flip },
          { at: [11, 5], rot: 90 * b.rot, flip: b.flip },
        );
        expect(f.at.every(Number.isInteger)).toBe(true);
        expect({ rot: f.rot / 90, flip: f.flip }).toEqual(composeDihedral(a, b));
        expect(isQuarterTurn(f.rot)).toBe(true);
      }
    expect(isQuarterTurn(-90)).toBe(true);
    expect(isQuarterTurn(135)).toBe(false);
  });
});
