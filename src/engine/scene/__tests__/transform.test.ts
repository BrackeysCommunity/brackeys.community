import { describe, expect, it } from "vite-plus/test";

import {
  applyPt,
  applyVec,
  compose,
  composeDihedral,
  dihedral,
  dihedralOf,
  flipWorld,
  IDENTITY_2D,
  invert,
  type Dihedral,
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
