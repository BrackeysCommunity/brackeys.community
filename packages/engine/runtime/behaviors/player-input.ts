import type { BehaviorSystemFactory } from "../../game/behaviors";
import type { PlayerInputBlock, PlayerInputHandle } from "../../game/behaviors/player-input";
import type { PlayerInputSystem, SeatInput } from "../../game/input-for";
import type { EngineContext } from "../../game/types";

const ZERO = Object.freeze({ x: 0, y: 0 });

/**
 * The `player-input` system: which seat each carrier names, and one view per
 * carrier over `ctx.input` that reads that seat while it has joined and
 * nothing held otherwise. A view reads the seat at each call, so a block
 * update between ticks takes effect on the next one; a detached entity's
 * view reads as nothing held. Its state is the block alone: no save.
 */
export const createPlayerInputSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const seats = new Map<string, number>();
  const views = new Map<string, SeatInput>();

  /** The entity's seat when it has joined, else null. */
  const live = (id: string): number | null => {
    const seat = seats.get(id);
    if (seat === undefined) return null;
    return ctx.input.players()[seat]?.joined ? seat : null;
  };

  const viewOf = (id: string): SeatInput => ({
    held(action) {
      const seat = live(id);
      return seat !== null && ctx.input.held(action, seat);
    },
    pressed(action) {
      const seat = live(id);
      return seat !== null && ctx.input.pressed(action, seat);
    },
    released(action) {
      const seat = live(id);
      return seat !== null && ctx.input.released(action, seat);
    },
    value(action) {
      const seat = live(id);
      return seat === null ? 0 : ctx.input.value(action, seat);
    },
    vector(action) {
      const seat = live(id);
      return seat === null ? ZERO : ctx.input.vector(action, seat);
    },
    pointer() {
      const seat = live(id);
      return seat === null ? null : ctx.input.pointer(seat);
    },
    get seat() {
      return live(id);
    },
  });

  const system: PlayerInputSystem = {
    attach(id, block: PlayerInputBlock) {
      seats.set(id, block.seat);
    },
    update(id, block: PlayerInputBlock) {
      seats.set(id, block.seat);
    },
    detach(id) {
      seats.delete(id);
      views.delete(id);
    },
    clear() {
      seats.clear();
      views.clear();
    },
    size: () => seats.size,
    seatOf: (id) => seats.get(id) ?? null,
    inputFor(id) {
      if (!seats.has(id)) return undefined;
      let view = views.get(id);
      if (!view) {
        view = viewOf(id);
        views.set(id, view);
      }
      return view;
    },
    handle: (id): PlayerInputHandle => ({
      get seat() {
        return system.seatOf(id);
      },
      get input() {
        return system.inputFor(id) ?? viewOf(id);
      },
    }),
  };
  return system;
};
