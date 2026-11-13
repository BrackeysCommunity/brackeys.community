import type { ActionKind, GameCommand, PlayerInfo, PlayersDef, Registry } from "../game/types";
import { PLAYER_JOINED, PLAYER_LEFT, type StepEvent } from "../runtime/types";
import type { InputAction, Vec2 } from "../types";
import { createSeatBook, resolvePlayers } from "./players";
import { q, qAxis, qPointer, qVector } from "./quantize";
import type { TickInput } from "./stream";

/** A seat's pointer this tick. */
export type PointerState = {
  /** World position, quantised. */
  x: number;
  y: number;
  /** Bit 0 primary, 1 secondary, 2 middle. */
  buttons: number;
  /** False after it left the canvas. */
  over: boolean;
};

/** Each seat's actions and pointer for the tick being simulated (`EngineContext.input`). */
export interface InputState {
  held(action: string, player?: number): boolean;
  /** Went down this tick. */
  pressed(action: string, player?: number): boolean;
  released(action: string, player?: number): boolean;
  /** An axis's value, or 0/1 for a button. */
  value(action: string, player?: number): number;
  vector(action: string, player?: number): Vec2;
  pointer(player?: number): PointerState | null;
  players(): readonly PlayerInfo[];
  /** The tick's commands, the engine's (`@elapsed`, `@nav`) among them, in the order the tick holds them. */
  commands(): readonly GameCommand[];
}

/** The runtime's side: each step feeds the tick's input and raises the seat events it returns. */
export type RuntimeInputState = InputState & {
  update(input: TickInput): Omit<StepEvent, "tick">[];
};

type ActionState = { held: boolean; value: number; vector: Vec2 };

type Seat = {
  actions: Map<string, ActionState>;
  pressed: Set<string>;
  released: Set<string>;
  pointer: PointerState | null;
};

const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

/** The declared kind, else what the action carries: x/y a vector, a value an axis. */
function kindOf(kinds: ReadonlyMap<string, ActionKind>, a: InputAction): ActionKind {
  const declared = kinds.get(a.action);
  if (declared) return declared;
  if (a.x !== undefined || a.y !== undefined) return "vector";
  return a.value !== undefined ? "axis" : "button";
}

function stateOf(kind: ActionKind, a: InputAction): ActionState {
  if (kind === "button") {
    return { held: a.pressed, value: a.pressed ? 1 : 0, vector: ZERO };
  }
  if (kind === "axis") {
    const value = qAxis(a.value ?? (a.pressed ? 1 : 0));
    return { held: value !== 0, value, vector: ZERO };
  }
  const v = qVector({ x: a.x ?? 0, y: a.y ?? 0 });
  const held = v.x !== 0 || v.y !== 0;
  return {
    held,
    value: held ? q(Math.sqrt(v.x * v.x + v.y * v.y)) : 0,
    vector: held ? Object.freeze(v) : ZERO,
  };
}

const pointerOf = (p: PointerState): PointerState =>
  Object.freeze({
    x: qPointer(p.x),
    y: qPointer(p.y),
    buttons: p.buttons | 0,
    over: p.over,
  });

/**
 * The input state a runtime derives from its ticks. A tick's seat changes
 * apply first, each raising `player:joined` or `player:left` (`player` the
 * seat, `data: { device }`, `at` the origin); then every action applies in
 * order per seat: `held` and the values are where the last one left them,
 * `pressed` and `released` name the edges this tick crossed (a press and
 * release inside one tick are both seen). A seat's pointer is kept until a
 * tick brings a new one. Values are quantised again on the way in, which
 * leaves already-quantised input unchanged. The seats are `players`, by
 * default the game's (`{ max: 1, join: "auto" }` without one): under
 * `"auto"` seat 0 starts with the keyboard, pointer and touch.
 */
export function createInputState(
  registry: Registry,
  players: PlayersDef = resolvePlayers(null, registry.game),
): RuntimeInputState {
  const kinds = new Map<string, ActionKind>(
    registry.actions.map((a) => [a.action, a.kind ?? "button"]),
  );
  const seats = new Map<number, Seat>();
  const book = createSeatBook(players);
  let commands: readonly GameCommand[] = [];

  const seat = (player: number): Seat => {
    let s = seats.get(player);
    if (!s) {
      s = { actions: new Map(), pressed: new Set(), released: new Set(), pointer: null };
      seats.set(player, s);
    }
    return s;
  };
  const action = (name: string, player = 0): ActionState | undefined =>
    seats.get(player)?.actions.get(name);

  return {
    held: (name, player) => action(name, player)?.held ?? false,
    pressed: (name, player = 0) => seats.get(player)?.pressed.has(name) ?? false,
    released: (name, player = 0) => seats.get(player)?.released.has(name) ?? false,
    value: (name, player) => action(name, player)?.value ?? 0,
    vector: (name, player) => action(name, player)?.vector ?? ZERO,
    pointer: (player = 0) => seats.get(player)?.pointer ?? null,
    players: book.players,
    commands: () => commands,
    update(input) {
      commands = input.commands;
      const events: Omit<StepEvent, "tick">[] = [];
      for (const change of input.joins) {
        for (const done of book.apply(change)) {
          events.push({
            type: done.joined ? PLAYER_JOINED : PLAYER_LEFT,
            player: done.player,
            at: { x: 0, y: 0 },
            data: { device: done.device },
          });
        }
      }
      for (const s of seats.values()) {
        s.pressed.clear();
        s.released.clear();
      }
      for (const a of input.actions) {
        const s = seat(a.player ?? 0);
        const next = stateOf(kindOf(kinds, a), a);
        const was = s.actions.get(a.action)?.held ?? false;
        if (next.held && !was) s.pressed.add(a.action);
        if (!next.held && was) s.released.add(a.action);
        s.actions.set(a.action, next);
      }
      input.pointers.forEach((p, player) => {
        if (p) seat(player).pointer = pointerOf(p);
      });
      return events;
    },
  };
}
