import {
  bindingProblems,
  DEFAULT_PLAYERS,
  SEAT_LIMIT,
  seatLimitOf,
  type BindingProblem,
} from "../game/input-bindings";
import type { DeviceId, PlayerInfo, PlayersDef } from "../game/types";
import type { SeatChange } from "./stream";

export type { DeviceId, PlayerInfo, PlayersDef } from "../game/types";
export { DEFAULT_PLAYERS, resolvePlayers } from "../game/input-bindings";

/** The most seats a game or an input map may declare. */
export const MAX_PLAYERS = SEAT_LIMIT;

/** The devices seat 0 owns from the start under `"auto"`. */
const AUTO_DEVICES: readonly DeviceId[] = ["keyboard", "pointer", "touch"];

/** How many seats `def` allows: its `max`, floored and held to 1–`MAX_PLAYERS`. */
export const seatCount: (def: PlayersDef) => number = seatLimitOf;

/**
 * `player-unknown` for a seat a script track, command or `assign` names
 * past `max`; null for a seat that exists. The same rule `bindingProblems`
 * applies to a key binding's `player`.
 */
export function seatProblem(player: number, max: number): BindingProblem | null {
  const problem = bindingProblems({ device: "key", code: "Space", player }, { kind: "button", max })
    .filter((p) => p.code === "player-unknown")
    .at(0);
  return problem ? { ...problem, path: "" } : null;
}

/** Which seat owns each device; the rule both the live seats and the runtime's state follow. */
export type SeatBook = {
  max: number;
  seatOf: (device: DeviceId) => number | null;
  /** Seat `player`'s devices, in the order they joined. */
  devices: (player: number) => readonly DeviceId[];
  /** Seats with no device, lowest first. */
  free: () => number[];
  /**
   * Applies one change and returns what actually changed: a device joining
   * a seat leaves the one it held first; a change naming a seat that doesn't
   * exist, a join already in place or a leave of a device the seat doesn't
   * own changes nothing.
   */
  apply: (change: SeatChange) => SeatChange[];
  players: () => readonly PlayerInfo[];
};

/** Seats `0…max−1`; under `"auto"` seat 0 starts with the keyboard, pointer and touch. */
export function createSeatBook(def: PlayersDef): SeatBook {
  const max = seatCount(def);
  const seats: DeviceId[][] = Array.from({ length: max }, () => []);
  if (def.join === "auto") seats[0]!.push(...AUTO_DEVICES);
  let listed: readonly PlayerInfo[] | null = null;

  const seatOf = (device: DeviceId): number | null => {
    const at = seats.findIndex((devices) => devices.includes(device));
    return at < 0 ? null : at;
  };
  const leave = (player: number, device: DeviceId): SeatChange => {
    const devices = seats[player]!;
    devices.splice(devices.indexOf(device), 1);
    return { player, device, joined: false };
  };

  return {
    max,
    seatOf,
    devices: (player) => seats[player] ?? [],
    free: () => seats.flatMap((devices, i) => (devices.length === 0 ? [i] : [])),
    apply(change) {
      const devices = seats[change.player];
      if (!devices) return [];
      const owner = seatOf(change.device);
      const out: SeatChange[] = [];
      if (change.joined) {
        if (owner === change.player) return [];
        if (owner !== null) out.push(leave(owner, change.device));
        devices.push(change.device);
        out.push({ player: change.player, device: change.device, joined: true });
      } else {
        if (owner !== change.player) return [];
        out.push(leave(owner, change.device));
      }
      listed = null;
      return out;
    },
    players: () =>
      (listed ??= Object.freeze(
        seats.map((devices, index) =>
          Object.freeze({
            index,
            devices: Object.freeze([...devices]),
            joined: devices.length > 0,
          }),
        ),
      )),
  };
}

const isPad = (device: DeviceId): device is `pad:${number}` => device.startsWith("pad:");

/** The live seats: the join policy applied to devices as they connect, press and leave. */
export type Seats = {
  readonly def: PlayersDef;
  /** The seat a device drives now; null while it has none. */
  seatOf: (device: DeviceId) => number | null;
  /** A pad connected (`gamepadconnected`): under `"auto"` it takes a free seat, or waits for one. */
  connect: (device: DeviceId) => void;
  /** A pad disconnected: its seat is freed, and under `"auto"` the longest-waiting pad takes it. */
  disconnect: (device: DeviceId) => void;
  /**
   * A device's key, button or touch went down. Under `"press"` a device
   * without a seat takes the lowest free one. Returns the seat it drives.
   */
  press: (device: DeviceId) => number | null;
  /**
   * The host puts a device in a seat, or frees it with null, under any
   * policy; an assigned device is the host's from then on, so `"auto"`
   * and `"press"` leave it alone. `player-unknown` for a seat past `max`.
   */
  assign: (device: DeviceId, player: number | null) => BindingProblem | null;
  players: () => readonly PlayerInfo[];
  /** The changes made since the last call, in order: the next tick's `TickInput.joins`. */
  drain: () => SeatChange[];
};

/**
 * Seats for live input. Every change is made at once, so the device's next
 * input reaches its new seat, and queued for the tick that records it; the
 * runtime's state replays the queued changes through the same `SeatBook`
 * rule, so a replay has the same seats on the same ticks. With one seat
 * under `"auto"` every pad joins seat 0 too.
 */
export function createSeats(def: PlayersDef = DEFAULT_PLAYERS): Seats {
  const book = createSeatBook(def);
  const pending: SeatChange[] = [];
  /** Connected pads in connection order, so auto seats them first come, first served. */
  const connected: DeviceId[] = [];
  /** Devices the host assigned or freed: no policy seats them again. */
  const hosted = new Set<DeviceId>();

  const apply = (change: SeatChange) => pending.push(...book.apply(change));
  const join = (player: number, device: DeviceId) => apply({ player, device, joined: true });

  /** Under auto, waiting pads take free seats in connection order. */
  const seatWaiting = () => {
    if (def.join !== "auto") return;
    for (const device of connected) {
      if (hosted.has(device) || book.seatOf(device) !== null) continue;
      const seat = book.max === 1 ? 0 : book.free()[0];
      if (seat === undefined) return;
      join(seat, device);
    }
  };

  return {
    def,
    seatOf: book.seatOf,
    connect(device) {
      if (!isPad(device) || connected.includes(device)) return;
      connected.push(device);
      hosted.delete(device);
      seatWaiting();
    },
    disconnect(device) {
      const at = connected.indexOf(device);
      if (at >= 0) connected.splice(at, 1);
      hosted.delete(device);
      const seat = book.seatOf(device);
      if (seat !== null) apply({ player: seat, device, joined: false });
      seatWaiting();
    },
    press(device) {
      const seat = book.seatOf(device);
      if (seat !== null || def.join !== "press" || hosted.has(device)) return seat;
      const free = book.free()[0];
      if (free === undefined) return null;
      join(free, device);
      return free;
    },
    assign(device, player) {
      if (player !== null) {
        const problem = seatProblem(player, book.max);
        if (problem) return problem;
      }
      hosted.add(device);
      const seat = book.seatOf(device);
      if (player !== null) join(player, device);
      else if (seat !== null) apply({ player: seat, device, joined: false });
      seatWaiting();
      return null;
    },
    players: book.players,
    drain: () => pending.splice(0),
  };
}
