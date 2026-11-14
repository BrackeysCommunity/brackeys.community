import { describe, expect, it } from "vite-plus/test";

import { fakeToolContext, pointer, toolRegistry } from "../../__tests__/fixtures/test-tool";
import type { SceneDefinition } from "../../scene/types";
import { drawBatch, drawnShape, boxTool } from "../builtin/draw";
import { lock45, strokeShape } from "../builtin/polyline";
import { selectTool } from "../builtin/select";
import { createSpatialIndex } from "../spatial-index";
import { DEFAULT_SNAP } from "../tools";

const doc = (): SceneDefinition => ({ v: 1, name: "t", bounds: [0, 0, 10, 10], entities: [] });

/** The test game's px per metre. */
const PPM = 100;

describe("draw helpers", () => {
  it("draws boxes between corners, squares with Shift, from the centre with Alt", () => {
    const none = { shift: false, alt: false };
    expect(drawnShape("box", [0, 0], [0.64, 0.32], none, PPM)).toEqual({
      type: "box",
      cx: 0.32,
      cy: 0.16,
      hw: 0.32,
      hh: 0.16,
      rotDeg: 0,
    });
    expect(
      drawnShape("box", [0, 0], [0.64, -0.16], { shift: true, alt: false }, PPM),
    ).toMatchObject({ cx: 0.32, cy: -0.32, hw: 0.32, hh: 0.32 });
    expect(
      drawnShape("box", [0.1, 0.1], [0.2, 0.3], { shift: false, alt: true }, PPM),
    ).toMatchObject({ cx: 0.1, cy: 0.1, hw: 0.1, hh: 0.2 });
    // Half a world px wide: too small to keep.
    expect(drawnShape("box", [0, 0], [0.01, 0.4], none, PPM)).toBeNull();
    expect(drawnShape("circle", [0, 0], [0.3, 0.4], none, PPM)).toEqual({
      type: "circle",
      cx: 0,
      cy: 0,
      r: 0.5,
    });
    // At 32 px per metre the smallest box is two world px across.
    expect(drawnShape("box", [0, 0], [0.0625, 0.0625], none, 32)).toMatchObject({
      hw: 0.03125,
      hh: 0.03125,
    });
    expect(drawnShape("box", [0, 0], [0.03125, 0.0625], none, 32)).toBeNull();
  });

  it("adds a bulk entry for a type with a shape bulk key, else an entity with a fresh id", () => {
    const box = drawnShape("box", [0, 0], [0.64, 0.32], { shift: false, alt: false }, PPM)!;
    expect(drawBatch(doc(), toolRegistry, "solid", box)).toEqual({
      batch: {
        label: "Draw box",
        ops: [{ op: "addBulk", key: "solid", shapes: [["box", 0.32, 0.16, 0.32, 0.16]] }],
      },
      select: "~solid:0",
    });
    expect(drawBatch(doc(), toolRegistry, "sensor", box)?.batch.ops).toEqual([
      {
        op: "add",
        entity: { id: "sensor", type: "sensor", shape: ["box", 0.32, 0.16, 0.32, 0.16] },
      },
    ]);
    expect(drawBatch(doc(), toolRegistry, "marker", box)).toBeNull();
    const tri = {
      type: "poly" as const,
      pts: [
        [0, 0],
        [0.64, 0],
        [0, 0.64],
      ] as [number, number][],
    };
    expect(drawBatch(doc(), toolRegistry, "nav", tri)?.batch.ops).toEqual([
      { op: "add", entity: { id: "nav", type: "nav", shape: ["poly", 0, 0, 0.64, 0, 0, 0.64] } },
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
    tool.pointer!(pointer("move", [1.28, 0.64]));
    expect(tool.overlay!().ghosts).toHaveLength(1);
    expect(tool.cancel!()).toBe(true);
    tool.pointer!(pointer("up", [1.28, 0.64]));
    expect(ctx.commits).toEqual([]);
  });
});

describe("pen helpers", () => {
  it("locks to the nearest 45° line", () => {
    expect(lock45([0, 0], [1, 0.08], PPM)).toEqual([1, 0]);
    expect(lock45([0, 0], [0.6, 0.5], PPM)).toEqual([0.55, 0.55]);
    expect(lock45([0.1, 0.1], [0.12, -0.9], PPM)).toEqual([0.1, -0.9]);
    // A whole number of world px along each axis at 32 px per metre.
    expect(lock45([0, 0], [0.6, 0.5], 32)).toEqual([0.5625, 0.5625]);
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
    expect(tool.pointer!(pointer("down", [0.05, 0.05]))).toBe(true);
    expect(tool.gesture!()).toBe(true);
    tool.pointer!(pointer("up", [0.05, 0.05]));
    expect(ctx.selected).toEqual([[]]);
    expect(ctx.commits).toEqual([]);
  });
});

describe("the select tool's click into instances", () => {
  /** A resolved view: a room instance holding a lid and a nested post with a top. */
  const view = (): SceneDefinition => ({
    ...doc(),
    entities: [
      { id: "room-1/lid", type: "sensor", shape: ["box", 2, 2, 0.5, 0.5, 0] },
      { id: "room-1/post-a/top", type: "sensor", shape: ["box", 6, 2, 0.5, 0.5, 0] },
      { id: "crate", type: "sensor", shape: ["box", 6, 6, 0.5, 0.5, 0] },
    ],
  });
  function rig() {
    const ctx = fakeToolContext(toolRegistry, view());
    const index = createSpatialIndex();
    index.rebuild(ctx.doc, toolRegistry);
    ctx.index = () => index;
    ctx.scale = () => PPM;
    const tool = selectTool.create(ctx);
    const click = (at: [number, number], rest: Parameters<typeof pointer>[2] = {}) => {
      tool.pointer!(pointer("down", at, rest));
      tool.pointer!(pointer("up", at, rest));
      return ctx.selection();
    };
    return { ctx, tool, click };
  }

  it("selects the outermost instance, then the next level, then the hit", () => {
    const { click } = rig();
    expect(click([6, 2])).toEqual(["room-1"]);
    expect(click([6, 2])).toEqual(["room-1/post-a"]);
    expect(click([6, 2])).toEqual(["room-1/post-a/top"]);
    expect(click([6, 2])).toEqual(["room-1/post-a/top"]);
    expect(click([2, 2])).toEqual(["room-1"]);
    expect(click([2, 2])).toEqual(["room-1/lid"]);
    expect(click([6, 6])).toEqual(["crate"]);
  });

  it("keeps the selected level on the press, so a drag moves it, and steps in on the release", () => {
    const { ctx, tool, click } = rig();
    click([6, 2]);
    tool.pointer!(pointer("down", [6, 2]));
    expect(ctx.selection()).toEqual(["room-1"]);
    tool.pointer!(pointer("up", [6, 2]));
    expect(ctx.selection()).toEqual(["room-1/post-a"]);
  });

  it("steps in at once on a double-click, and cycles exact hits with Alt", () => {
    const { click } = rig();
    expect(click([6, 2])).toEqual(["room-1"]);
    expect(click([6, 2], { clicks: 2 })).toEqual(["room-1/post-a"]);
    expect(click([6, 2], { clicks: 2 })).toEqual(["room-1/post-a/top"]);
    expect(click([2, 2], { alt: true })).toEqual(["room-1/lid"]);
  });
});
