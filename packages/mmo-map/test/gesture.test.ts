import { describe, expect, test } from "vite-plus/test";

import { pan, zoomAt } from "../src/camera.ts";
import {
  backing,
  KEY_PAN,
  KEY_ZOOM,
  keyMove,
  pinch,
  slipped,
  TAP_SLOP_PX,
  WHEEL_RATE,
  wheelZoom,
} from "../src/gesture.ts";
import { packStyle } from "./support.ts";

const v = packStyle().view;
const view = { width: 800, height: 600 };
const cam = { x: 10, y: -4, size: 8 };

describe("gestures", () => {
  test("a tap slips once it moves past the slop", () => {
    const tap = { x: 100, y: 100 };
    expect(slipped(tap, { x: 100 + TAP_SLOP_PX, y: 100 })).toBe(false);
    expect(slipped(tap, { x: 100 + TAP_SLOP_PX + 0.01, y: 100 })).toBe(true);
    expect(slipped(tap, { x: 106, y: 106 })).toBe(true);
  });

  test("the wheel zooms round the pointer by an exponential of its delta", () => {
    const at = { x: 200, y: 150 };
    expect(wheelZoom(cam, 100, at, view, v)).toEqual(
      zoomAt(cam, Math.exp(-100 * WHEEL_RATE), at, view, v),
    );
    expect(wheelZoom(cam, -100, at, view, v).size).toBeGreaterThan(cam.size);
  });

  test("a pinch follows the midpoint and zooms by the spread round it", () => {
    const other = { x: 300, y: 300 };
    const was = { x: 400, y: 300 };
    const now = { x: 520, y: 340 };
    const mid = { x: 410, y: 320 };
    const moved = pan(cam, mid.x - 350, mid.y - 300);
    const spread = Math.hypot(220, 40) / 100;
    expect(pinch(cam, was, now, other, view, v)).toEqual(zoomAt(moved, spread, mid, view, v));
    // A finger on top of the other cannot set a ratio, so it only pans.
    expect(pinch(cam, other, { x: 310, y: 300 }, other, view, v)).toEqual(pan(cam, 5, 0));
  });

  test("arrows pan by a part of the view and +, = and - zoom round its centre", () => {
    const centre = { x: 400, y: 300 };
    const dx = view.width * KEY_PAN;
    const dy = view.height * KEY_PAN;
    expect(keyMove(cam, "ArrowLeft", view, v)).toEqual(pan(cam, dx, 0));
    expect(keyMove(cam, "ArrowRight", view, v)).toEqual(pan(cam, -dx, 0));
    expect(keyMove(cam, "ArrowUp", view, v)).toEqual(pan(cam, 0, dy));
    expect(keyMove(cam, "ArrowDown", view, v)).toEqual(pan(cam, 0, -dy));
    const zin = zoomAt(cam, KEY_ZOOM, centre, view, v);
    expect(keyMove(cam, "+", view, v)).toEqual(zin);
    expect(keyMove(cam, "=", view, v)).toEqual(zin);
    expect(keyMove(cam, "-", view, v)).toEqual(zoomAt(cam, 1 / KEY_ZOOM, centre, view, v));
    expect(keyMove(cam, "Enter", view, v)).toBeUndefined();
    expect(keyMove(cam, "a", view, v)).toBeUndefined();
  });

  test("the backing store follows the pixel ratio, clamped at 2, and 0 counts as 1", () => {
    expect(backing({ width: 100.4, height: 50 }, 1.5)).toEqual({
      width: 151,
      height: 75,
      dpr: 1.5,
    });
    expect(backing(view, 3)).toEqual({ width: 1600, height: 1200, dpr: 2 });
    expect(backing(view, 0)).toEqual({ width: 800, height: 600, dpr: 1 });
    expect(backing({ width: 0, height: 0 }, 1)).toEqual({ width: 1, height: 1, dpr: 1 });
  });
});
