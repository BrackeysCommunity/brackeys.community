/**
 * Affine transforms, the dihedral group of quarter turns and flips, and
 * rigid frames at any angle. No imports, so `./scene`, `./collab` and
 * `math.ts` can all share it.
 *
 * Turns are clockwise on screen (y down): one quarter turn takes `[1, 0]`
 * to `[0, 1]`. Quarter turns are built from integers, never trig, so integer
 * inputs give integer outputs exactly; other angles use sine and cosine.
 */

type Pt = [x: number, y: number];

/** x' = a·x + c·y + tx, y' = b·x + d·y + ty (Pixi's Matrix convention). */
export type Transform2D = { a: number; b: number; c: number; d: number; tx: number; ty: number };

export const IDENTITY_2D: Transform2D = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

export const isIdentity = (t: Transform2D): boolean =>
  t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.tx === 0 && t.ty === 0;

/** Whether `t` turns or flips, rather than only moving. */
export const turns = (t: Transform2D): boolean =>
  !(t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1);

/** Equal but for float noise: a parent frame this close hasn't moved its children. */
export const sameFrame = (p: Transform2D, q: Transform2D): boolean =>
  Math.abs(p.a - q.a) <= 1e-12 &&
  Math.abs(p.b - q.b) <= 1e-12 &&
  Math.abs(p.c - q.c) <= 1e-12 &&
  Math.abs(p.d - q.d) <= 1e-12 &&
  Math.abs(p.tx - q.tx) <= 1e-9 &&
  Math.abs(p.ty - q.ty) <= 1e-9;

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

/** Steps applied innermost first, as a parent chain lists them, as one transform. */
export const composeSteps = (steps: readonly Transform2D[]): Transform2D =>
  steps.reduce((acc, t) => compose(t, acc), IDENTITY_2D);

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

/**
 * The dihedral element an instance's or node's `rot` (degrees, absent 0)
 * and `flip` spell; null when `rot` is off the quarter turns.
 */
export function turnOf(d: { rot?: number; flip?: boolean }): Dihedral | null {
  const deg = typeof d.rot === "number" ? normDeg(d.rot) : 0;
  return deg % 90 === 0 ? { rot: quarter(deg / 90), flip: d.flip === true } : null;
}

/** The inverse element: what undoes `d`. */
export const inverseTurn = (d: Dihedral): Dihedral =>
  d.flip ? d : { rot: quarter(4 - d.rot), flip: false };

export const isIdentityTurn = (d: Dihedral): boolean => d.rot === 0 && !d.flip;

/** A pure translation by `[dx, dy]`. */
export const translation = ([dx, dy]: Pt): Transform2D => ({ ...IDENTITY_2D, tx: dx, ty: dy });

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

/** An angle and a flip without an origin: what a frame does to directions. */
export type Orientation = { rot: number; flip: boolean };

/** Mirror x when `flip`, turn `rot` degrees clockwise (y down), move to `at`. */
export type Frame = { at: Pt; rot: number } & Orientation;

/** Micro-units, no -0: how a frame's off-quarter numbers are kept, so two machines agree. */
const micro = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** An angle in degrees in [0, 360), never `-0`. */
export const normDeg = (deg: number): number => {
  const r = deg % 360;
  return r < 0 ? r + 360 : r + 0;
};

/** `deg` in [0, 360) to the micro-degree. */
const settleDeg = (deg: number) => {
  const r = micro(normDeg(deg));
  return r === 360 ? 0 : r;
};

/** Whether `deg` is a whole number of quarter turns. */
export const isQuarterTurn = (deg: number): boolean => normDeg(deg) % 90 === 0;

/** `deg` in radians; a whole number of quarter turns is k·π/2 for k in 0..3, the same bits every time. */
export function turnRadians(deg: number): number {
  const wrapped = normDeg(deg);
  return wrapped % 90 === 0 ? ((wrapped / 90) * Math.PI) / 2 : (deg * Math.PI) / 180;
}

/**
 * Built from integers when `rot` is a multiple of 90, so quarter turns stay
 * exact; from sine and cosine otherwise.
 */
export function frame(f: Frame): Transform2D {
  const deg = normDeg(f.rot);
  if (deg % 90 === 0) return dihedral({ rot: quarter(deg / 90), flip: f.flip }, f.at);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = f.flip ? -1 : 1;
  return {
    a: z(sx * cos),
    b: z(sx * sin),
    c: z(0 - sin),
    d: z(cos),
    tx: z(f.at[0]),
    ty: z(f.at[1]),
  };
}

/** The angle in [0, 360) and the flip of a rigid transform; exact for quarter turns. */
export function frameOf(t: Transform2D): Orientation {
  const d = dihedralOf(t);
  if (d) return { rot: d.rot * 90, flip: d.flip };
  const flip = t.a * t.d - t.b * t.c < 0;
  // A flip mirrors x first, so the turn is read from the image of [-1, 0].
  const deg = (Math.atan2(flip ? -t.b : t.b, flip ? -t.a : t.a) * 180) / Math.PI;
  return { rot: settleDeg(deg), flip };
}

/** `outer ∘ inner` on orientations: a flip reverses the turn it is applied after. */
export function composeOrientations(outer: Orientation, inner: Orientation): Orientation {
  return {
    rot: settleDeg(outer.flip ? outer.rot - inner.rot : outer.rot + inner.rot),
    flip: outer.flip !== inner.flip,
  };
}

export function composeFrames(outer: Frame, inner: Frame): Frame {
  const [x, y] = applyPt(frame(outer), inner.at);
  return {
    at: isQuarterTurn(outer.rot) ? [x, y] : [micro(x), micro(y)],
    ...composeOrientations(outer, inner),
  };
}

/** The frame a rigid transform is: its translation, angle and flip. */
export const asFrame = (t: Transform2D): Frame => ({ at: [t.tx, t.ty], ...frameOf(t) });
