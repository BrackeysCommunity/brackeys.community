import { ticksFor, ticksIn } from "../game/time";
import type { EngineContext } from "../game/types";
import { sameCell, type Cell } from "../grid/geometry";
import type { MotionBody } from "./body";

/** Moves an entity cell to cell, one neighbour at a time. */
export interface GridStepper {
  cell(): Cell;
  moving(): boolean;
  /** Starts a step to a neighbour; false when it's moving, blocked or not a neighbour. Reserves the cell at once. */
  step(to: Cell): boolean;
  /** Advances the step; call once per tick. Lerps exactly by whole ticks. */
  update(dtMs: number): void;
}

type Step = { from: Cell; to: Cell; ticks: number; done: number };

/**
 * A stepper for `entityId` on the loaded scene's grid, standing on `start`'s
 * centre. Each step takes `ticksFor(msPerStep, ctx.time)` ticks, writes the
 * entity's pose every tick (moving `body` along with it when given) and ends
 * exactly on the target's centre. With `occupy`, the entity stands in
 * `ctx.grid.occupancy` and a step moves it to its target as the step
 * starts. Without a grid nothing moves and every step is refused.
 */
export function createGridStepper(
  ctx: EngineContext,
  entityId: string,
  opts: { start: Cell; msPerStep: number; body?: MotionBody; occupy?: boolean },
): GridStepper {
  const { body } = opts;
  const occupy = opts.occupy ?? false;
  let cell: Cell = [opts.start[0], opts.start[1]];
  let current: Step | null = null;

  function moveTo(x: number, y: number, snap: boolean): void {
    if (body) {
      const at = body.position();
      if (snap) body.teleport(x, y);
      else if (at.x !== x || at.y !== y) body.move({ x: x - at.x, y: y - at.y }, { slide: false });
    }
    ctx.poses.set(entityId, x, y, undefined, snap ? { snap: true } : undefined);
  }

  const grid = ctx.grid;
  if (grid) {
    const [x, y] = grid.geometry.center(cell);
    moveTo(x, y, true);
    if (occupy) grid.occupancy.place(entityId, cell);
  }

  return {
    cell: () => cell,
    moving: () => current !== null,
    step(to) {
      const grid = ctx.grid;
      if (current || !grid) return false;
      if (!grid.geometry.neighbors(cell).some((n) => sameCell(n, to))) return false;
      if (!grid.passable(to)) return false;
      const target: Cell = [to[0], to[1]];
      current = { from: cell, to: target, ticks: ticksFor(opts.msPerStep, ctx.time), done: 0 };
      cell = target;
      if (occupy) grid.occupancy.place(entityId, target);
      return true;
    },
    update(dtMs) {
      const grid = ctx.grid;
      if (!current || !grid) return;
      const ticks = Math.round(ticksIn(dtMs, ctx.time));
      if (ticks <= 0) return;
      const s = current;
      s.done = Math.min(s.ticks, s.done + ticks);
      const [tx, ty] = grid.geometry.center(s.to);
      if (s.done === s.ticks) {
        current = null;
        moveTo(tx, ty, false);
        return;
      }
      const [fx, fy] = grid.geometry.center(s.from);
      const t = s.done / s.ticks;
      moveTo(fx + (tx - fx) * t, fy + (ty - fy) * t, false);
    },
  };
}
