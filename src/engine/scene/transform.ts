/**
 * Affine transforms and the dihedral group of quarter turns and flips that
 * instances and groups use. No imports, so `./scene`, `./collab` and
 * `math.ts` can all share it.
 *
 * Quarter turns are clockwise on screen (y down): one turn takes `[1, 0]`
 * to `[0, 1]`. The matrices are built from integers, never trig, so integer
 * inputs give integer outputs exactly.
 */

type Pt = [x: number, y: number];

/** x' = a·x + c·y + tx, y' = b·x + d·y + ty (Pixi's Matrix convention). */
export type Transform2D = { a: number; b: number; c: number; d: number; tx: number; ty: number };

export const IDENTITY_2D: Transform2D = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/** A quarter-turn transform: mirror x when `flip`, then turn `rot` quarter turns clockwise, then translate to `at`. */
export type Dihedral = { rot: 0 | 1 | 2 | 3; flip: boolean };

/** `-0` becomes `0`, so equal transforms compare equal. */
const z = (n: number) => n + 0;

/** The linear part of `rot` quarter turns: [a, b, c, d]. */
const TURNS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 1],
  [0, 1, -1, 0],
  [-1, 0, 0, -1],
  [0, -1, 1, 0],
];

const quarter = (n: number): Dihedral["rot"] => (((n % 4) + 4) % 4) as Dihedral["rot"];

export function dihedral(d: Dihedral, at: Pt): Transform2D {
  const [a, b, c, dd] = TURNS[quarter(d.rot)] ?? [1, 0, 0, 1];
  return d.flip
    ? { a: z(0 - a), b: z(0 - b), c, d: dd, tx: z(at[0]), ty: z(at[1]) }
    : { a, b, c, d: dd, tx: z(at[0]), ty: z(at[1]) };
}

export function compose(outer: Transform2D, inner: Transform2D): Transform2D {
  const o = outer;
  const i = inner;
  return {
    a: z(o.a * i.a + o.c * i.b),
    b: z(o.b * i.a + o.d * i.b),
    c: z(o.a * i.c + o.c * i.d),
    d: z(o.b * i.c + o.d * i.d),
    tx: z(o.a * i.tx + o.c * i.ty + o.tx),
    ty: z(o.b * i.tx + o.d * i.ty + o.ty),
  };
}

export function invert(t: Transform2D): Transform2D {
  const det = t.a * t.d - t.b * t.c;
  if (det === 0 || !Number.isFinite(det)) throw new Error("the transform has no inverse");
  const a = t.d / det;
  const b = -t.b / det;
  const c = -t.c / det;
  const d = t.a / det;
  return {
    a: z(a),
    b: z(b),
    c: z(c),
    d: z(d),
    tx: z(-(a * t.tx + c * t.ty)),
    ty: z(-(b * t.tx + d * t.ty)),
  };
}

export function applyPt(t: Transform2D, p: Pt): Pt {
  return [z(t.a * p[0] + t.c * p[1] + t.tx), z(t.b * p[0] + t.d * p[1] + t.ty)];
}

/** The linear part only: for directions. */
export function applyVec(t: Transform2D, v: Pt): Pt {
  return [z(t.a * v[0] + t.c * v[1]), z(t.b * v[0] + t.d * v[1])];
}

/** The dihedral part of a transform whose linear part is one, else null. */
export function dihedralOf(t: Transform2D): Dihedral | null {
  for (const flip of [false, true]) {
    for (let rot = 0; rot < 4; rot++) {
      const m = dihedral({ rot: rot as Dihedral["rot"], flip }, [0, 0]);
      if (m.a === t.a && m.b === t.b && m.c === t.c && m.d === t.d) {
        return { rot: rot as Dihedral["rot"], flip };
      }
    }
  }
  return null;
}

/** `outer ∘ inner` on the dihedral group: composing turns and flips without matrices. */
export function composeDihedral(outer: Dihedral, inner: Dihedral): Dihedral {
  // A mirror reverses the turn it is applied after: F·Rᵏ = R⁻ᵏ·F.
  return {
    rot: quarter(outer.rot + (outer.flip ? -inner.rot : inner.rot)),
    flip: outer.flip !== inner.flip,
  };
}

/** The world-axis flip `"x"` or `"y"` composed onto `d` (what the transform op does). */
export function flipWorld(d: Dihedral, axis: "x" | "y"): Dihedral {
  return composeDihedral({ rot: axis === "x" ? 0 : 2, flip: true }, d);
}
