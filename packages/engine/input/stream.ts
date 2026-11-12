import { DEFAULT_TIME } from "../game/defaults";
import type { DeviceId, GameCommand } from "../game/types";
import type { RecordingStream, SeatEvent, SystemEvent } from "../scene/recording-schema";
import type { InputAction } from "../types";
import type { PointerState } from "./state";

export type { SeatEvent, SystemEvent };

/** A seat taking or leaving a device this tick. */
export type SeatChange = { player: number; device: DeviceId; joined: boolean };

/** One tick's input, merged system first, then seats in order. */
export type TickInput = {
  tick: number;
  actions: InputAction[];
  commands: GameCommand[];
  /** Per seat; undefined when unchanged this tick. */
  pointers: (PointerState | undefined)[];
  joins: SeatChange[];
};

/** The names a stream's events index into. */
export type StreamTables = { actions: readonly string[]; commands: readonly string[] };

const isTickInput = (input: TickInput | readonly InputAction[]): input is TickInput =>
  !Array.isArray(input);

/**
 * The runtime's normaliser: a `TickInput` as given (with `commands` after
 * its own), or 0.x's action array and commands as a tick of seat 0 with no
 * pointer or seat changes. The array itself is kept, so the game's
 * `beforeStep` receives the caller's array.
 */
export function tickInputOf(
  input: TickInput | InputAction[],
  commands?: readonly GameCommand[],
  tick = 0,
): TickInput {
  if (isTickInput(input)) {
    return commands && commands.length > 0
      ? { ...input, commands: [...input.commands, ...commands] }
      : input;
  }
  return { tick, actions: input, commands: [...(commands ?? [])], pointers: [], joins: [] };
}

const ELAPSED = "@elapsed";
const ANALOG = 1000;
const POINTER = 10_000;
const SUB_TICK = 1000;

const toInt = (v: number, step: number): number => Math.round(v * step) + 0;
const fromInt = (v: number, step: number): number => v / step + 0;

/** How a tick's events stamp their time: `subTick` writes each action's offset into its tick. */
export type EncodeOptions = { subTick?: boolean };

/**
 * How decoded actions are stamped: `timestamp` is the event's time on a
 * `tickMs` clock (default the engine's), and with `subTick` every action
 * carries its `offset`, 0 when the event sits on the tick itself.
 */
export type DecodeOptions = { tickMs?: number; subTick?: boolean };

const thousandthsOf = (offset: number): number =>
  Math.min(
    SUB_TICK - 1,
    Math.max(0, Math.round((Number.isFinite(offset) ? offset : 0) * SUB_TICK)),
  );

/** An offset as a recording keeps it: thousandths of a tick, inside the tick. */
export function qOffset(offset: number): number {
  return thousandthsOf(offset) / SUB_TICK;
}

/**
 * Where `timestamp` falls in the `tickMs` window starting at `startMs`, as a
 * quantised offset: before the window is 0, after it the window's last thousandth.
 */
export function offsetIn(timestamp: number, startMs: number, tickMs: number): number {
  return qOffset(tickMs > 0 ? (timestamp - startMs) / tickMs : 0);
}

/** `tick` plus `offset` as thousandths, kept inside the tick. */
function stampOf(tick: number, offset: number | undefined, subTick: boolean): number {
  if (!subTick || offset === undefined || !Number.isFinite(offset)) return tick;
  return (tick * SUB_TICK + thousandthsOf(offset)) / SUB_TICK;
}

const seatOf = (player: number | undefined): number => player ?? 0;

function indexIn(table: readonly string[], name: string, what: string): number {
  const index = table.indexOf(name);
  if (index < 0) {
    throw new Error(`encodeTick: ${what} "${name}" is not in the stream's ${what} table`);
  }
  return index;
}

function elapsedMs(command: GameCommand): number {
  const ms = (command.args as { ms?: unknown } | undefined)?.ms;
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new Error(`encodeTick: ${ELAPSED} needs args { ms: number }`);
  }
  return ms;
}

function actionEvent(a: InputAction, tables: StreamTables, t: number): SeatEvent {
  const action = indexIn(tables.actions, a.action, "action");
  if (a.x !== undefined || a.y !== undefined) {
    return [t, "v", action, toInt(a.x ?? 0, ANALOG), toInt(a.y ?? 0, ANALOG)];
  }
  if (a.value !== undefined) return [t, "a", action, toInt(a.value, ANALOG)];
  return [t, "b", action, a.pressed ? 1 : 0];
}

/**
 * A tick's input as per-seat and system events: each seat's actions, then
 * its pointer, then its commands; `@elapsed` and seat changes on the system
 * stream. Action and command names are written as indexes into `tables`, so
 * a name missing from them throws. `seats` runs to the highest seat with an
 * event.
 */
export function encodeTick(
  input: TickInput,
  tables: StreamTables,
  opts: EncodeOptions = {},
): { seats: SeatEvent[][]; system: SystemEvent[] } {
  const subTick = opts.subTick === true;
  const seats: SeatEvent[][] = [];
  const seat = (player: number): SeatEvent[] => {
    if (!Number.isInteger(player) || player < 0) {
      throw new Error(`encodeTick: seat ${player} is not a seat index`);
    }
    while (seats.length <= player) seats.push([]);
    return seats[player] as SeatEvent[];
  };
  const system: SystemEvent[] = [];
  const tick = input.tick;

  for (const change of input.joins) {
    system.push([tick, change.joined ? "j" : "l", change.player, change.device]);
  }
  for (const command of input.commands) {
    if (command.name === ELAPSED) system.push([tick, "w", elapsedMs(command)]);
  }
  for (const a of input.actions) {
    seat(seatOf(a.player)).push(actionEvent(a, tables, stampOf(tick, a.offset, subTick)));
  }
  input.pointers.forEach((p, player) => {
    if (!p) return;
    seat(player).push([
      tick,
      "p",
      toInt(p.x, POINTER),
      toInt(p.y, POINTER),
      p.buttons | 0,
      p.over ? 1 : 0,
    ]);
  });
  for (const command of input.commands) {
    if (command.name === ELAPSED) continue;
    const index = indexIn(tables.commands, command.name, "command");
    seat(seatOf(command.player)).push(
      command.args === undefined
        ? [tick, "c", index]
        : [tick, "c", index, structuredClone(command.args)],
    );
  }
  return { seats, system };
}

const emptyTick = (tick: number): TickInput => ({
  tick,
  actions: [],
  commands: [],
  pointers: [],
  joins: [],
});

function nameAt(table: readonly string[], index: unknown, where: string, what: string): string {
  const name = Number.isInteger(index) ? table[index as number] : undefined;
  if (name === undefined) {
    throw new Error(
      `decodeStreams: ${where} names ${what} ${String(index)}, past the ${what} table`,
    );
  }
  return name;
}

function tickOf(t: unknown, where: string): number {
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
    throw new Error(`decodeStreams: ${where} has tick ${String(t)}`);
  }
  return Math.floor(t);
}

/**
 * A recording's streams as one `TickInput` per tick that has input, in tick
 * order. A tick's input is merged system first (seat changes and
 * `@elapsed`), then seats in order, each in stream order; the seat shows as
 * `player` from seat 1 on. Commands' args are copies, so a replay can't
 * change the recording. A malformed event throws, naming where it is.
 */
export function decodeStreams(
  rec: RecordingStream,
  opts: DecodeOptions = {},
): Map<number, TickInput> {
  const tickMs = opts.tickMs ?? 1000 / DEFAULT_TIME.rate;
  const subTick = opts.subTick === true;
  const ticks = new Map<number, TickInput>();
  const at = (tick: number): TickInput => {
    let input = ticks.get(tick);
    if (!input) {
      input = emptyTick(tick);
      ticks.set(tick, input);
    }
    return input;
  };

  rec.system.forEach((event, i) => {
    const where = `system[${i}]`;
    const tick = tickOf(event[0], where);
    const input = at(tick);
    switch (event[1]) {
      case "w":
        input.commands.push({ name: ELAPSED, args: { ms: event[2] } });
        break;
      case "j":
      case "l":
        input.joins.push({ player: event[2], device: event[3], joined: event[1] === "j" });
        break;
      default:
        throw new Error(`decodeStreams: ${where} has unknown kind ${JSON.stringify(event[1])}`);
    }
  });

  rec.inputs.forEach((stream, player) => {
    const seat = player === 0 ? {} : { player };
    stream.forEach((event, i) => {
      const where = `inputs[${player}][${i}]`;
      const t = event[0];
      const tick = tickOf(t, where);
      const input = at(tick);
      const kind = event[1];
      if (kind === "p") {
        while (input.pointers.length < player) input.pointers.push(undefined);
        input.pointers[player] = {
          x: fromInt(event[2], POINTER),
          y: fromInt(event[3], POINTER),
          buttons: event[4] | 0,
          over: event[5] === 1,
        };
        return;
      }
      if (kind === "c") {
        const name = nameAt(rec.commands, event[2], where, "command");
        const args = event[3];
        input.commands.push(
          args === undefined ? { name, ...seat } : { name, args: structuredClone(args), ...seat },
        );
        return;
      }
      if (kind !== "b" && kind !== "a" && kind !== "v") {
        throw new Error(`decodeStreams: ${where} has unknown kind ${JSON.stringify(kind)}`);
      }
      const action = nameAt(rec.actions, event[2], where, "action");
      const thousandths = Math.round((t - tick) * SUB_TICK);
      const stamp: Pick<InputAction, "tick" | "timestamp" | "offset"> = {
        tick,
        timestamp: (tick + thousandths / SUB_TICK) * tickMs,
      };
      if (subTick || thousandths !== 0) stamp.offset = thousandths / SUB_TICK;
      if (kind === "b") {
        input.actions.push({ action, pressed: event[3] === 1, ...seat, ...stamp });
      } else if (kind === "a") {
        const value = fromInt(event[3], ANALOG);
        input.actions.push({ action, pressed: value !== 0, value, ...seat, ...stamp });
      } else {
        const x = fromInt(event[3], ANALOG);
        const y = fromInt(event[4], ANALOG);
        input.actions.push({ action, pressed: x !== 0 || y !== 0, x, y, ...seat, ...stamp });
      }
    });
  });

  return new Map([...ticks].sort(([a], [b]) => a - b));
}

/**
 * A tick's input in the order a replay feeds it: seat changes and
 * `@elapsed` first, then each seat's actions and commands in seat order,
 * each seat's in the order given. Live paths step this, so a run and its
 * replay see the same order.
 */
export function mergeTick(input: TickInput): TickInput {
  const bySeat = <T extends { player?: number }>(items: readonly T[]): T[] =>
    items
      .map((item, i) => ({ item, i, seat: seatOf(item.player) }))
      .sort((a, b) => a.seat - b.seat || a.i - b.i)
      .map(({ item }) => item);
  const elapsed = input.commands.filter((c) => c.name === ELAPSED);
  const rest = input.commands.filter((c) => c.name !== ELAPSED);
  return {
    ...input,
    actions: bySeat(input.actions),
    commands: [...elapsed, ...bySeat(rest)],
  };
}
