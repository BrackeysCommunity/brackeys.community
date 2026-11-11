import { describe, expect, it } from "vite-plus/test";

import { fakeToolContext, pointer, toolRegistry } from "../../__tests__/fixtures/test-tool";
import type { SceneDefinition } from "../../scene/types";
import { drawBatch, drawnShape, boxTool } from "../builtin/draw";
import { lock45, strokeShape } from "../builtin/polyline";
import { selectTool } from "../builtin/select";
import { DEFAULT_SNAP } from "../tools";

const doc = (): SceneDefinition => ({ v: 1, name: "t", bounds: [0, 0, 1000, 1000], entities: [] });

describe("draw helpers", () => {
  it("draws boxes between corners, squares with Shift, from the centre with Alt", () => {
    const none = { shift: false, alt: false };
    expect(drawnShape("box", [0, 0], [64, 32], none)).toEqual({
      type: "box",
      cx: 32,
      cy: 16,
      hw: 32,
      hh: 16,
      rotDeg: 0,
    });
    expect(drawnShape("box", [0, 0], [64, -16], { shift: true, alt: false })).toMatchObject({
      cx: 32,
      cy: -32,
      hw: 32,
      hh: 32,
    });
    expect(drawnShape("box", [10, 10], [20, 30], { shift: false, alt: true })).toMatchObject({
      cx: 10,
      cy: 10,
      hw: 10,
      hh: 20,
    });
    expect(drawnShape("box", [0, 0], [1, 40], none)).toBeNull();
    expect(drawnShape("circle", [0, 0], [30, 40], none)).toEqual({
      type: "circle",
      cx: 0,
      cy: 0,
      r: 50,
    });
  });

  it("adds a bulk entry for a type with a shape bulk key, else an entity with a fresh id", () => {
    const box = drawnShape("box", [0, 0], [64, 32], { shift: false, alt: false })!;
    expect(drawBatch(doc(), toolRegistry, "solid", box)).toEqual({
      batch: {
        label: "Draw box",
        ops: [{ op: "addBulk", key: "solid", shapes: [["box", 32, 16, 32, 16]] }],
      },
      select: "~solid:0",
    });
    expect(drawBatch(doc(), toolRegistry, "sensor", box)?.batch.ops).toEqual([
      { op: "add", entity: { id: "sensor", type: "sensor", shape: ["box", 32, 16, 32, 16] } },
    ]);
    expect(drawBatch(doc(), toolRegistry, "marker", box)).toBeNull();
    const tri = {
      type: "poly" as const,
      pts: [
        [0, 0],
        [64, 0],
        [0, 64],
      ] as [number, number][],
    };
    expect(drawBatch(doc(), toolRegistry, "nav", tri)?.batch.ops).toEqual([
      { op: "add", entity: { id: "nav", type: "nav", shape: ["poly", 0, 0, 64, 0, 0, 64] } },
    ]);
  });

  it("offer their type choice in the overlay, solid unless another is picked", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), DEFAULT_SNAP);
    const tool = boxTool.create(ctx);
    expect(tool.overlay!().option).toMatchObject({ label: "Draw type", value: "solid" });
    expect(tool.command!("type:sensor")).toBe(true);
    expect(tool.overlay!().option?.value).toBe("sensor");
    expect(tool.command!("rotate-cw")).toBe(false);
  });

  it("drop a stroke on Escape with no batch", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), DEFAULT_SNAP);
    const tool = boxTool.create(ctx);
    tool.pointer!(pointer("down", [0, 0]));
    tool.pointer!(pointer("move", [128, 64]));
    expect(tool.overlay!().ghosts).toHaveLength(1);
    expect(tool.cancel!()).toBe(true);
    tool.pointer!(pointer("up", [128, 64]));
    expect(ctx.commits).toEqual([]);
  });
});

describe("pen helpers", () => {
  it("locks to the nearest 45° line", () => {
    expect(lock45([0, 0], [100, 8])).toEqual([100, 0]);
    expect(lock45([0, 0], [60, 50])).toEqual([55, 55]);
    expect(lock45([10, 10], [12, -90])).toEqual([10, -90]);
  });

  it("closes into a poly when convex and a closed chain when not", () => {
    const square = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as [number, number][];
    expect(strokeShape(square, true).type).toBe("poly");
    const notch = [...square.slice(0, 3), [5, 5] as [number, number], [0, 10] as [number, number]];
    expect(strokeShape(notch, true)).toEqual({ type: "chain", pts: [...notch, [0, 0]] });
    expect(strokeShape(square, false)).toEqual({ type: "chain", pts: square });
  });

  it("keeps a concave stroke a poly where the field takes concave polys or no chains", () => {
    const notch: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 5],
      [0, 10],
    ];
    expect(strokeShape(notch, true, { chain: true, concavePoly: true })).toEqual({
      type: "poly",
      pts: notch,
    });
    expect(strokeShape(notch, true, { chain: false, concavePoly: false }).type).toBe("poly");
  });
});

describe("the select tool on a bare context", () => {
  it("claims a press on empty space as a marquee and selects nothing for a click", () => {
    const ctx = fakeToolContext(toolRegistry, doc());
    const tool = selectTool.create(ctx);
    expect(tool.pointer!(pointer("down", [5, 5]))).toBe(true);
    expect(tool.gesture!()).toBe(true);
    tool.pointer!(pointer("up", [5, 5]));
    expect(ctx.selected).toEqual([[]]);
    expect(ctx.commits).toEqual([]);
  });
});
