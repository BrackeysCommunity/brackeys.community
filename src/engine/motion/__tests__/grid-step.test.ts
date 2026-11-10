import { describe, expect, it } from "vite-plus/test";

import { resolveTime } from "../../game/time";
import type { EngineContext } from "../../game/types";
import { gridGeometry, type Cell } from "../../grid/geometry";
import { createOccupancy } from "../../grid/occupancy";
import type { RuntimeGrid } from "../../runtime/grid";
import { createPoseIndex } from "../../runtime/poses";
import type { GridSettings } from "../../scene/types";
import type { Vec2 } from "../../types";
import type { MotionBody, MotionResult } from "../body";
import { createGridStepper } from "../grid-step";

const SQUARE: GridSettings = { kind: "square", cell: [10, 10] };
const HEX: GridSettings = { kind: "hex", cell: [32, 28], side: 16, stagger: "x", index: "odd" };

function world(rate: number, settings: GridSettings = SQUARE) {
  let tick = 0;
  const geometry = gridGeometry(settings);
  const occupancy = createOccupancy();
  const bounds = { c0: 0, r0: 0, c1: 9, r1: 9 };
  const grid: RuntimeGrid = {
    geometry,
    occupancy,
    bounds,
    passable: (c) =>
      c[0] >= bounds.c0 &&
      c[0] <= bounds.c1 &&
      c[1] >= bounds.r0 &&
      c[1] <= bounds.r1 &&
      !occupancy.wall(c) &&
      !occupancy.blocked(c),
  };
  const time = resolveTime({ game: { kind: "fixed", rate } });
  const poses = createPoseIndex(() => tick);
  const ctx = { time, grid, poses } as unknown as EngineContext;
  return {
    ctx,
    grid,
    poses,
    /** One tick: the clock moves on, then `fn` runs in it. */
    tick(fn: () => void) {
      tick++;
      fn();
    },
  };
}

const at = (poses: EngineContext["poses"], id: string): [number, number] => {
  const p = poses.get(id)!;
  return [p.x, p.y];
};

describe("createGridStepper", () => {
  it.each([
    [60, 250, 15],
    [30, 250, 8],
    [60, 100, 6],
    [30, 1, 1],
  ])("at %i Hz a %i ms step takes %i whole ticks", (rate, msPerStep, ticks) => {
    const w = world(rate);
    const s = createGridStepper(w.ctx, "e", { start: [2, 2], msPerStep });
    expect(at(w.poses, "e")).toEqual(w.grid.geometry.center([2, 2]));
    expect(s.step([3, 2])).toBe(true);
    const seen: [number, number][] = [];
    for (let i = 0; i < ticks; i++) {
      expect(s.moving()).toBe(true);
      w.tick(() => s.update(w.ctx.time.tickMs));
      seen.push(at(w.poses, "e"));
    }
    expect(s.moving()).toBe(false);
    expect(seen.at(-1)).toEqual(w.grid.geometry.center([3, 2]));
    for (let i = 0; i < ticks - 1; i++) expect(seen[i]![0]).toBeLessThan(35);
    expect(seen.map(([x]) => x)).toEqual([...seen.map(([x]) => x)].sort((a, b) => a - b));
    w.tick(() => s.update(w.ctx.time.tickMs));
    expect(at(w.poses, "e")).toEqual([35, 25]);
  });

  it("ends every step exactly on the cell centre, on a hex grid too", () => {
    for (const settings of [SQUARE, HEX]) {
      const w = world(60, settings);
      const s = createGridStepper(w.ctx, "e", { start: [4, 4], msPerStep: 70 });
      let c: Cell = [4, 4];
      for (let n = 0; n < 6; n++) {
        const next = w.grid.geometry.neighbors(c)[n % 4]!;
        expect(s.step(next)).toBe(true);
        while (s.moving()) w.tick(() => s.update(w.ctx.time.tickMs));
        c = next;
        expect(s.cell()).toEqual(c);
        expect(at(w.poses, "e")).toEqual(w.grid.geometry.center(c));
      }
    }
  });

  it("keeps the previous pose for interpolation and snaps only at creation", () => {
    const w = world(60);
    const s = createGridStepper(w.ctx, "e", { start: [0, 0], msPerStep: 50 });
    expect(w.poses.prev("e")).toEqual(w.poses.get("e"));
    s.step([0, 1]);
    w.tick(() => s.update(w.ctx.time.tickMs));
    expect(w.poses.prev("e")).toMatchObject({ x: 5, y: 5 });
    expect(w.poses.get("e")!.x).toBe(5);
    expect(w.poses.get("e")!.y).toBeCloseTo(5 + 10 / 3, 12);
  });

  it("reserves the target cell as the step starts", () => {
    const w = world(60);
    const s = createGridStepper(w.ctx, "e", { start: [1, 1], msPerStep: 100, occupy: true });
    expect(w.grid.occupancy.at([1, 1])).toEqual(["e"]);
    expect(s.step([2, 1])).toBe(true);
    expect(s.cell()).toEqual([2, 1]);
    expect(w.grid.occupancy.cellOf("e")).toEqual([2, 1]);
    expect(w.grid.occupancy.blocked([2, 1])).toBe(true);
    expect(w.grid.occupancy.blocked([1, 1])).toBe(false);
    const other = createGridStepper(w.ctx, "f", { start: [3, 1], msPerStep: 100, occupy: true });
    expect(other.step([2, 1])).toBe(false);
  });

  it("leaves occupancy alone without occupy", () => {
    const w = world(60);
    const s = createGridStepper(w.ctx, "e", { start: [1, 1], msPerStep: 100 });
    s.step([2, 1]);
    expect(w.grid.occupancy.cellOf("e")).toBeUndefined();
  });

  it("refuses a step while moving, into a wall or blocked cell, out of bounds, or to a non-neighbour", () => {
    const w = world(60);
    w.grid.occupancy.setWall([2, 0], true);
    w.grid.occupancy.place("rock", [0, 1]);
    const s = createGridStepper(w.ctx, "e", { start: [1, 0], msPerStep: 100 });
    expect(s.step([2, 0])).toBe(false);
    expect(s.step([0, 1])).toBe(false);
    expect(s.step([1, -1])).toBe(false);
    expect(s.step([2, 1])).toBe(false);
    expect(s.step([1, 2])).toBe(false);
    expect(s.step([1, 0])).toBe(false);
    expect(s.moving()).toBe(false);
    expect(s.step([1, 1])).toBe(true);
    expect(s.step([1, 2])).toBe(false);
    expect(s.cell()).toEqual([1, 1]);
  });

  it("refuses every step without a grid", () => {
    const w = world(60);
    const ctx = { ...w.ctx, grid: null } as unknown as EngineContext;
    const s = createGridStepper(ctx, "e", { start: [1, 1], msPerStep: 100 });
    expect(s.step([2, 1])).toBe(false);
    expect(w.poses.has("e")).toBe(false);
  });

  it("moves a body along with the pose", () => {
    const w = world(60);
    let pos: Vec2 = { x: 0, y: 0 };
    const calls: string[] = [];
    const body: MotionBody = {
      entityId: "e",
      handle: 1,
      position: () => ({ ...pos }),
      move(delta, opts): MotionResult {
        calls.push(`move ${delta.x},${delta.y} slide=${opts?.slide}`);
        pos = { x: pos.x + delta.x, y: pos.y + delta.y };
        w.poses.set("e", pos.x, pos.y);
        return { moved: delta, hits: [], blocked: false };
      },
      teleport(x, y) {
        calls.push(`teleport ${x},${y}`);
        pos = { x, y };
        w.poses.set("e", x, y, undefined, { snap: true });
      },
      setEnabled: () => {},
      destroy: () => {},
    };
    const s = createGridStepper(w.ctx, "e", { start: [1, 1], msPerStep: 50, body });
    expect(calls).toEqual(["teleport 15,15"]);
    s.step([2, 1]);
    while (s.moving()) w.tick(() => s.update(w.ctx.time.tickMs));
    expect(calls.slice(1).every((c) => c.startsWith("move ") && c.endsWith("slide=false"))).toBe(
      true,
    );
    expect(calls).toHaveLength(4);
    expect(pos).toEqual({ x: 25, y: 15 });
    expect(at(w.poses, "e")).toEqual([25, 15]);
  });

  it("keeps the pose on the lerp when the body is held back", () => {
    const w = world(60);
    const pos: Vec2 = { x: 15, y: 15 };
    const body: MotionBody = {
      entityId: "e",
      handle: 1,
      position: () => ({ ...pos }),
      move: () => ({ moved: { x: 0, y: 0 }, hits: [], blocked: true }),
      teleport: () => {},
      setEnabled: () => {},
      destroy: () => {},
    };
    const s = createGridStepper(w.ctx, "e", { start: [1, 1], msPerStep: 50, body });
    s.step([1, 2]);
    while (s.moving()) w.tick(() => s.update(w.ctx.time.tickMs));
    expect(at(w.poses, "e")).toEqual([15, 25]);
  });
});
