// Pointy-top axial hexes, laid out as Go's render.HexCentre and
// render.PixelToHex lay them, so a tile the site draws sits where /map
// draws it.

export interface Axial {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

/** E, NE, NW, W, SW, SE: the order of sim/hex. */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const DIRECTION_IDS = ["e", "ne", "nw", "w", "sw", "se"] as const;

const ROOT3 = Math.sqrt(3);

export function hexCentre(h: Axial, size: number): Point {
  return { x: size * ROOT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

/** Corner i sits at 60i − 30°, clockwise from the upper right on screen. */
export function hexCorners(c: Point, size: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i) - Math.PI / 6;
    out.push({ x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) });
  }
  return out;
}

/** The two corners of the side facing direction d. */
export function sideCorners(d: number): [number, number] {
  const i = (6 - d) % 6;
  return [i, (i + 1) % 6];
}

// Go's math.Round rounds half away from zero; Math.round does not.
function roundHalfAway(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

function cubeRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = roundHalfAway(q);
  let rr = roundHalfAway(r);
  const rs = roundHalfAway(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

export function pixelToHex(x: number, y: number, size: number): Axial {
  const px = x / size;
  const py = y / size;
  return cubeRound((ROOT3 / 3) * px - py / 3, (2 / 3) * py);
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function hexKey(h: Axial): string {
  return `${h.q},${h.r}`;
}

export function neighbour(h: Axial, d: number): Axial {
  const o = DIRECTIONS[d]!;
  return { q: h.q + o.q, r: h.r + o.r };
}
