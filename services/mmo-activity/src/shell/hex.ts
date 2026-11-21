import type { Point } from "./board.ts";

/** A room on a floor's map, in axial coordinates: q across, r down, pointy side up. */
export interface Axial {
  q: number;
  r: number;
}

/** The room a fork's way leads to, by way id, beside the room the party stands in. */
export const WAY_ROOMS: Record<string, Axial> = {
  "way-0": { q: -1, r: 1 },
  "way-1": { q: 0, r: 1 },
  "way-2": { q: 1, r: 0 },
};

/** The room the stair back up is in. */
export const UP_ROOM: Axial = { q: 0, r: -1 };

/** The room the party stands in. */
export const HERE_ROOM: Axial = { q: 0, r: 0 };

/** A room's centre, pointy side up, for rooms whose sides are size px from the centre. */
export function centre(a: Axial, size: number): Point {
  return { x: size * (2 * a.q + a.r), y: size * Math.sqrt(3) * a.r };
}

/** A room's outline as SVG points, its corners scale × the corner radius out. */
export function corners(c: Point, size: number, scale = 1): string {
  const R = ((size * 2) / Math.sqrt(3)) * scale;
  return Array.from({ length: 6 }, (_, k) => {
    const a = (k * Math.PI) / 3 + Math.PI / 6;
    return `${(c.x + R * Math.cos(a)).toFixed(2)},${(c.y + R * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** The box that holds every room given, with a margin, as an SVG viewBox. */
export function viewBox(rooms: Axial[], size: number, pad = 0): string {
  const R = (size * 2) / Math.sqrt(3);
  const cs = rooms.map((a) => centre(a, size));
  const left = Math.min(...cs.map((c) => c.x)) - size - pad;
  const right = Math.max(...cs.map((c) => c.x)) + size + pad;
  const top = Math.min(...cs.map((c) => c.y)) - R - pad;
  const bottom = Math.max(...cs.map((c) => c.y)) + R + pad;
  return [left, top, right - left, bottom - top].map((n) => n.toFixed(2)).join(" ");
}

/** Points spread round a room's centre for so many tokens, the first at the top. */
export function ring(c: Point, n: number, radius: number): Point[] {
  if (n <= 1) return [{ ...c }];
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a) };
  });
}
