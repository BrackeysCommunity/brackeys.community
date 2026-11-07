import { describe, expect, it } from "vite-plus/test";

import { aabb } from "../shape-geometry";
import { shapeIsClosed, shapeOutline, type PathCommand } from "../shape-outline";
import type { ShapeObj } from "../types";

const PI = Math.PI;

function round(cmds: PathCommand[]): PathCommand[] {
  const r = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
  return cmds.map((c) => {
    switch (c.op) {
      case "moveTo":
      case "lineTo":
        return { ...c, x: r(c.x), y: r(c.y) };
      case "arc":
        return { ...c, cx: r(c.cx), cy: r(c.cy), r: r(c.r), start: r(c.start), end: r(c.end) };
      case "close":
        return c;
    }
  });
}

function points(cmds: PathCommand[]): [number, number][] {
  return cmds.flatMap((c) => (c.op === "moveTo" || c.op === "lineTo" ? [[c.x, c.y]] : [])) as [
    number,
    number,
  ][];
}

describe("shapeOutline", () => {
  it("outlines an axis-aligned box corner by corner, clockwise on screen", () => {
    expect(shapeOutline({ type: "box", cx: 10, cy: 20, hw: 5, hh: 2, rotDeg: 0 })).toEqual([
      { op: "moveTo", x: 5, y: 18 },
      { op: "lineTo", x: 15, y: 18 },
      { op: "lineTo", x: 15, y: 22 },
      { op: "lineTo", x: 5, y: 22 },
      { op: "close" },
    ]);
  });

  it("rotates a box's corners", () => {
    const box: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 4, hh: 2, rotDeg: 90 };
    expect(round(shapeOutline(box))).toEqual([
      { op: "moveTo", x: 2, y: -4 },
      { op: "lineTo", x: 2, y: 4 },
      { op: "lineTo", x: -2, y: 4 },
      { op: "lineTo", x: -2, y: -4 },
      { op: "close" },
    ]);
  });

  it("puts a rotated box's corners on its aabb", () => {
    const box: ShapeObj = { type: "box", cx: 30, cy: -12, hw: 25, hh: 8, rotDeg: 33 };
    const pts = points(shapeOutline(box));
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    const b = aabb(box);
    expect(Math.min(...xs)).toBeCloseTo(b.minX, 9);
    expect(Math.max(...xs)).toBeCloseTo(b.maxX, 9);
    expect(Math.min(...ys)).toBeCloseTo(b.minY, 9);
    expect(Math.max(...ys)).toBeCloseTo(b.maxY, 9);
  });

  it("outlines a circle as one full arc", () => {
    expect(shapeOutline({ type: "circle", cx: 3, cy: 4, r: 5 })).toEqual([
      { op: "moveTo", x: 8, y: 4 },
      { op: "arc", cx: 3, cy: 4, r: 5, start: 0, end: 2 * PI },
      { op: "close" },
    ]);
  });

  it("outlines an upright capsule as one stadium", () => {
    expect(
      round(shapeOutline({ type: "capsule", cx: 0, cy: 0, r: 2, halfLen: 10, rotDeg: 0 })),
    ).toEqual(
      round([
        { op: "moveTo", x: 2, y: -10 },
        { op: "lineTo", x: 2, y: 10 },
        { op: "arc", cx: 0, cy: 10, r: 2, start: 0, end: PI },
        { op: "lineTo", x: -2, y: -10 },
        { op: "arc", cx: 0, cy: -10, r: 2, start: PI, end: 2 * PI },
        { op: "close" },
      ]),
    );
  });

  it("rotates a capsule, ends and caps together", () => {
    expect(
      round(shapeOutline({ type: "capsule", cx: 5, cy: 5, r: 1, halfLen: 3, rotDeg: 90 })),
    ).toEqual(
      round([
        { op: "moveTo", x: 8, y: 6 },
        { op: "lineTo", x: 2, y: 6 },
        { op: "arc", cx: 2, cy: 5, r: 1, start: PI / 2, end: (3 * PI) / 2 },
        { op: "lineTo", x: 8, y: 4 },
        { op: "arc", cx: 8, cy: 5, r: 1, start: (3 * PI) / 2, end: (5 * PI) / 2 },
        { op: "close" },
      ]),
    );
  });

  it("joins a capsule's sides to its caps", () => {
    const cap: ShapeObj = { type: "capsule", cx: -7, cy: 11, r: 3, halfLen: 6, rotDeg: 37 };
    const cmds = shapeOutline(cap);
    let at: [number, number] | null = null;
    for (const c of cmds) {
      if (c.op === "arc") {
        expect(at).not.toBeNull();
        const [x, y] = at!;
        expect(x).toBeCloseTo(c.cx + c.r * Math.cos(c.start), 9);
        expect(y).toBeCloseTo(c.cy + c.r * Math.sin(c.start), 9);
        at = [c.cx + c.r * Math.cos(c.end), c.cy + c.r * Math.sin(c.end)];
      } else if (c.op !== "close") {
        at = [c.x, c.y];
      }
    }
    const first = cmds[0] as Extract<PathCommand, { op: "moveTo" }>;
    expect(at![0]).toBeCloseTo(first.x, 9);
    expect(at![1]).toBeCloseTo(first.y, 9);
  });

  it("closes a polygon through its points", () => {
    expect(
      shapeOutline({
        type: "poly",
        pts: [
          [0, 0],
          [10, 0],
          [5, 8],
        ],
      }),
    ).toEqual([
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 10, y: 0 },
      { op: "lineTo", x: 5, y: 8 },
      { op: "close" },
    ]);
  });

  it("leaves a chain open", () => {
    expect(
      shapeOutline({
        type: "chain",
        pts: [
          [0, 0],
          [10, 5],
          [20, 0],
        ],
      }),
    ).toEqual([
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 10, y: 5 },
      { op: "lineTo", x: 20, y: 0 },
    ]);
  });

  it("outlines nothing for an empty point list", () => {
    expect(shapeOutline({ type: "poly", pts: [] })).toEqual([]);
    expect(shapeOutline({ type: "chain", pts: [] })).toEqual([]);
  });
});

describe("shapeIsClosed", () => {
  it("is false only for a chain", () => {
    expect(shapeIsClosed({ type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 })).toBe(true);
    expect(shapeIsClosed({ type: "circle", cx: 0, cy: 0, r: 1 })).toBe(true);
    expect(shapeIsClosed({ type: "capsule", cx: 0, cy: 0, r: 1, halfLen: 1, rotDeg: 0 })).toBe(
      true,
    );
    expect(shapeIsClosed({ type: "poly", pts: [] })).toBe(true);
    expect(shapeIsClosed({ type: "chain", pts: [] })).toBe(false);
  });
});
