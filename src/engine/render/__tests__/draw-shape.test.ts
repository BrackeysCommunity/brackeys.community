import type { Graphics } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { shapeOutline } from "../../scene/shape-outline";
import type { ShapeObj } from "../../scene/types";
import { drawShape, traceShape } from "../draw-shape";

type Call = [method: string, ...args: unknown[]];

/** The slice of Pixi's `Graphics` the drawing helpers use, recording every call. */
function recordingGraphics(): { g: Graphics; calls: Call[] } {
  const calls: Call[] = [];
  const g = {} as Record<string, unknown>;
  for (const method of ["moveTo", "lineTo", "arc", "closePath", "fill", "stroke"]) {
    g[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return g;
    };
  }
  return { g: g as unknown as Graphics, calls };
}

const SHAPES: ShapeObj[] = [
  { type: "box", cx: 10, cy: 20, hw: 5, hh: 2, rotDeg: 30 },
  { type: "circle", cx: 3, cy: 4, r: 5 },
  { type: "capsule", cx: 0, cy: 0, r: 2, halfLen: 10, rotDeg: 45 },
  {
    type: "poly",
    pts: [
      [0, 0],
      [10, 0],
      [5, 8],
    ],
  },
  {
    type: "chain",
    pts: [
      [0, 0],
      [10, 5],
      [20, 0],
    ],
  },
];

const box = SHAPES[0]!;
const chain = SHAPES[4]!;

describe("traceShape", () => {
  it.each(SHAPES.map((s) => [s.type, s] as const))("replays the %s outline", (_, shape) => {
    const { g, calls } = recordingGraphics();
    traceShape(g, shape);
    const expected: Call[] = shapeOutline(shape).map((c) => {
      switch (c.op) {
        case "moveTo":
        case "lineTo":
          return [c.op, c.x, c.y];
        case "arc":
          return ["arc", c.cx, c.cy, c.r, c.start, c.end];
        case "close":
          return ["closePath"];
      }
    });
    expect(calls).toEqual(expected);
  });

  it("neither fills nor strokes", () => {
    const { g, calls } = recordingGraphics();
    traceShape(g, box);
    expect(calls.some(([m]) => m === "fill" || m === "stroke")).toBe(false);
  });
});

describe("drawShape", () => {
  it("fills then strokes a closed shape after tracing it", () => {
    const { g, calls } = recordingGraphics();
    drawShape(g, box, { fill: 0x112233, stroke: 0x445566, alpha: 0.5, strokeWidth: 3 });
    const traced = calls.length - 2;
    expect(calls.slice(0, traced).map(([m]) => m)).toEqual([
      "moveTo",
      "lineTo",
      "lineTo",
      "lineTo",
      "closePath",
    ]);
    expect(calls.slice(traced)).toEqual([
      ["fill", { color: 0x112233, alpha: 0.5 }],
      ["stroke", { color: 0x445566, alpha: 0.5, width: 3 }],
    ]);
  });

  it("defaults alpha to 1 and the stroke width to 1", () => {
    const { g, calls } = recordingGraphics();
    drawShape(g, box, { stroke: 0xffffff });
    expect(calls.at(-1)).toEqual(["stroke", { color: 0xffffff, alpha: 1, width: 1 }]);
    expect(calls.some(([m]) => m === "fill")).toBe(false);
  });

  it("only fills when the style has no stroke", () => {
    const { g, calls } = recordingGraphics();
    drawShape(g, box, { fill: 0x123456 });
    expect(calls.at(-1)).toEqual(["fill", { color: 0x123456, alpha: 1 }]);
    expect(calls.some(([m]) => m === "stroke")).toBe(false);
  });

  it("never fills a chain, and strokes it in its fill color without a stroke", () => {
    const { g, calls } = recordingGraphics();
    drawShape(g, chain, { fill: 0x00ff00, alpha: 0.4 });
    expect(calls.some(([m]) => m === "fill" || m === "closePath")).toBe(false);
    expect(calls.at(-1)).toEqual(["stroke", { color: 0x00ff00, alpha: 0.4, width: 1 }]);
  });

  it("draws nothing for an empty style", () => {
    const { g, calls } = recordingGraphics();
    drawShape(g, box, { alpha: 0.5 });
    expect(calls).toEqual([]);
  });
});
