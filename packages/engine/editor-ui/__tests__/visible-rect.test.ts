import { describe, expect, it, vi } from "vite-plus/test";

import { frameInView, setVisibleArea, visibleFrame, type VisibleArea } from "../frame/visible-rect";

const rect = { minX: 0, minY: 0, maxX: 60, maxY: 40 };

const game = () => ({ frame: vi.fn(), panBy: vi.fn() });

describe("visibleFrame", () => {
  it("grows the rect by the covered fraction and pans by half the inset difference", () => {
    const area: VisibleArea = {
      width: 1000,
      height: 500,
      insets: { left: 300, right: 100, top: 50, bottom: 0 },
    };
    const fit = visibleFrame(rect, area);
    // 600 of 1000 px are visible across, 450 of 500 down.
    expect(fit.rect.minX).toBeCloseTo(30 - (60 * (1000 / 600)) / 2);
    expect(fit.rect.maxX).toBeCloseTo(30 + (60 * (1000 / 600)) / 2);
    expect(fit.rect.minY).toBeCloseTo(20 - (40 * (500 / 450)) / 2);
    expect(fit.rect.maxY).toBeCloseTo(20 + (40 * (500 / 450)) / 2);
    expect(fit.pan).toEqual({ x: 100, y: 25 });
  });

  it("keeps the centre, so the pan alone moves it to the visible area's centre", () => {
    const area: VisibleArea = {
      width: 1440,
      height: 900,
      insets: { left: 296, right: 428, top: 0, bottom: 48 },
    };
    const fit = visibleFrame(rect, area);
    expect((fit.rect.minX + fit.rect.maxX) / 2).toBeCloseTo(30);
    expect((fit.rect.minY + fit.rect.maxY) / 2).toBeCloseTo(20);
    // The visible area's centre sits (296 - 428) / 2 px left of the canvas's.
    const visibleCentre = 296 + (1440 - 296 - 428) / 2;
    expect(1440 / 2 + fit.pan.x).toBeCloseTo(visibleCentre);
    expect(fit.pan.y).toBe(-24);
  });

  it("leaves a rect alone with nothing covered, and a point stays a point", () => {
    const none: VisibleArea = {
      width: 800,
      height: 600,
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
    };
    expect(visibleFrame(rect, none)).toEqual({ rect, pan: { x: 0, y: 0 } });
    const point = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    const fit = visibleFrame(point, { ...none, insets: { ...none.insets, left: 200 } });
    expect(fit.rect).toEqual(point);
    expect(fit.pan).toEqual({ x: 100, y: 0 });
  });

  it("ignores insets on an axis they would cover entirely", () => {
    const fit = visibleFrame(rect, {
      width: 400,
      height: 300,
      insets: { left: 300, right: 200, top: 30, bottom: 0 },
    });
    expect(fit.rect.minX).toBe(0);
    expect(fit.rect.maxX).toBe(60);
    expect(fit.pan.x).toBe(0);
    expect(fit.pan.y).toBe(15);
  });
});

describe("frameInView", () => {
  it("is the game's own frame without a visible area", () => {
    const g = game();
    frameInView(g, rect);
    expect(g.frame).toHaveBeenCalledWith(rect);
    expect(g.panBy).not.toHaveBeenCalled();
  });

  it("frames the grown rect and pans while an area is set, and stops once it's unset", () => {
    const g = game();
    const area: VisibleArea = {
      width: 1000,
      height: 500,
      insets: { left: 300, right: 100, top: 0, bottom: 0 },
    };
    const off = setVisibleArea(g, () => area);
    frameInView(g, rect);
    expect(g.frame).toHaveBeenCalledWith(visibleFrame(rect, area).rect);
    expect(g.panBy).toHaveBeenCalledWith({ x: 100, y: 0 });

    off();
    frameInView(g, rect);
    expect(g.frame).toHaveBeenLastCalledWith(rect);
    expect(g.panBy).toHaveBeenCalledTimes(1);
  });

  it("skips the pan when the insets balance", () => {
    const g = game();
    const off = setVisibleArea(g, () => ({
      width: 1000,
      height: 500,
      insets: { left: 200, right: 200, top: 0, bottom: 0 },
    }));
    frameInView(g, rect);
    expect(g.frame).toHaveBeenCalledOnce();
    expect(g.panBy).not.toHaveBeenCalled();
    off();
  });

  it("keeps a newer registration when an older one unregisters", () => {
    const g = game();
    const offOld = setVisibleArea(g, () => null);
    const offNew = setVisibleArea(g, () => ({
      width: 1000,
      height: 500,
      insets: { left: 400, right: 0, top: 0, bottom: 0 },
    }));
    offOld();
    frameInView(g, rect);
    expect(g.panBy).toHaveBeenCalledWith({ x: 200, y: 0 });
    offNew();
  });
});
