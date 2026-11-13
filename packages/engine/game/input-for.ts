/**
 * How a behavior reads the player driving its entity: the seat its
 * `player-input` block names. Type imports only outside `game/`, so the
 * canvas-sync image can carry it.
 */
import type { PointerState } from "../input/state";
import type { Vec2 } from "../types";
import type { BehaviorSystem } from "./behaviors";
import { PLAYER_INPUT, type PlayerInputBlock } from "./behaviors/player-input";
import type { EngineContext } from "./types";

/** One seat's input this tick, as `ctx.input` gives it for that seat. */
export type SeatInput = {
  held(action: string): boolean;
  /** Went down this tick. */
  pressed(action: string): boolean;
  released(action: string): boolean;
  /** An axis's value, or 0/1 for a button. */
  value(action: string): number;
  vector(action: string): Vec2;
  pointer(): PointerState | null;
  /** The seat read, or null when the entity carries no `player-input` or its seat hasn't joined. */
  readonly seat: number | null;
};

/** The `player-input` behavior's system, as `ctx.behavior("player-input")` gives it. */
export interface PlayerInputSystem extends BehaviorSystem<PlayerInputBlock> {
  /** The seat the entity's block names, joined or not; null when it carries none. */
  seatOf(entityId: string): number | null;
  /**
   * The entity's view, made once per attached entity, reading its seat at
   * each call: nothing held while the seat hasn't joined. Undefined when the
   * entity carries no `player-input`.
   */
  inputFor(entityId: string): SeatInput | undefined;
}

const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

/** The view that reads as nothing held. */
const NOTHING: SeatInput = Object.freeze({
  held: () => false,
  pressed: () => false,
  released: () => false,
  value: () => 0,
  vector: () => ZERO,
  pointer: () => null,
  seat: null,
});

/** The seat's input for an entity carrying `player-input`, else a view that reads as nothing held. */
export function inputFor(ctx: EngineContext, entityId: string): SeatInput {
  return ctx.behavior<PlayerInputSystem>(PLAYER_INPUT.name)?.inputFor(entityId) ?? NOTHING;
}
