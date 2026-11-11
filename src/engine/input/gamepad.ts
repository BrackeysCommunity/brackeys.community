import type { PadAxis, PadButton } from "../game/input-codes";
import { PAD_AXES, PAD_BUTTONS } from "../game/input-codes";
import type { Binding } from "../game/types";
import type { Vec2 } from "../types";
import { DEFAULT_DEADZONE, q, radialDeadzone } from "./quantize";

/** What the reader needs of a `Gamepad`, so tests can pass plain objects. */
export type PadSnapshot = {
  index: number;
  /** A different id at the same index is a different pad: the old one disconnects. */
  id?: string;
  /** "standard" when the browser maps it to the W3C layout. */
  mapping: string;
  connected: boolean;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
};

export type GamepadReaderOptions = {
  /** `navigator.getGamepads` by default; absent means no pads. */
  getGamepads?: () => readonly (PadSnapshot | null)[];
  /** Radial stick deadzone, 0…1; default 0.15. */
  deadzone?: number;
};

/** A pad's binding, as `reading` takes it. */
export type PadBinding = Extract<Binding, { device: "pad" }>;

/**
 * One change since the last poll. Buttons report edges; axes and sticks
 * report their new value after the deadzone, quantised to 1/1000. A
 * standard pad names its buttons, sticks and axes (its analog triggers are
 * the axes "lt" and "rt"); any other pad reports buttons and axes by raw
 * index and has no sticks. `index` is always the raw button or axis index.
 */
export type PadChange =
  | { pad: number; kind: "button"; button: PadButton; index: number; pressed: boolean }
  | { pad: number; kind: "axis"; axis: PadAxis | "lt" | "rt"; index?: number; value: number }
  | { pad: number; kind: "stick"; stick: "left" | "right"; x: number; y: number };

export type GamepadPoll = {
  tick: number;
  /** In pad order; a pad's connection comes before its changes, its disconnection after its releases. */
  changes: PadChange[];
  /** Pad indices that appeared since the last poll. */
  connected: number[];
  /** Pad indices that went away since the last poll; their held inputs are released in `changes`. */
  disconnected: number[];
};

/** Reads every pad once per tick into edges and value changes. */
export type GamepadReader = {
  /**
   * Reads `getGamepads()` once and reports what changed since the last
   * poll. A second poll for the same tick reads nothing and reports
   * nothing, so a tick never sees an edge twice.
   */
  poll(tick: number): GamepadPoll;
  /** Connected pad indices, as of the last poll. */
  pads(): number[];
  /** What a binding reads on a pad as of the last poll: 1 or 0 for a button, an axis value, a stick position. */
  reading(pad: number, binding: PadBinding): number | Vec2;
  /** Forgets every pad; later polls report nothing. */
  destroy(): void;
};

type PadState = {
  id: string | undefined;
  standard: boolean;
  buttons: boolean[];
  /** By raw index; on a standard pad the stick axes after the radial deadzone. */
  axes: number[];
  triggers: { lt: number; rt: number };
  sticks: { left: Vec2; right: Vec2 };
};

const ZERO: Vec2 = { x: 0, y: 0 };
const LT = PAD_BUTTONS.indexOf("lt");
const RT = PAD_BUTTONS.indexOf("rt");

function browserGamepads(): (() => readonly (PadSnapshot | null)[]) | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  return () => navigator.getGamepads();
}

const finite = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0);

function readPad(pad: PadSnapshot, deadzone: number): PadState {
  const standard = pad.mapping === "standard";
  const buttons = pad.buttons.map((b) => !!b.pressed);
  const trigger = (i: number) => q(Math.min(1, Math.max(0, finite(pad.buttons[i]?.value))));
  if (!standard) {
    return {
      id: pad.id,
      standard,
      buttons,
      axes: pad.axes.map((v) => radialDeadzone({ x: finite(v), y: 0 }, deadzone).x),
      triggers: { lt: 0, rt: 0 },
      sticks: { left: ZERO, right: ZERO },
    };
  }
  const stick = (i: number) =>
    radialDeadzone({ x: finite(pad.axes[i]), y: finite(pad.axes[i + 1]) }, deadzone);
  const left = stick(0);
  const right = stick(2);
  const axes = pad.axes.map((v, i) =>
    i < PAD_AXES.length ? 0 : radialDeadzone({ x: finite(v), y: 0 }, deadzone).x,
  );
  axes[0] = left.x;
  axes[1] = left.y;
  axes[2] = right.x;
  axes[3] = right.y;
  return {
    id: pad.id,
    standard,
    buttons,
    axes,
    triggers: { lt: trigger(LT), rt: trigger(RT) },
    sticks: { left, right },
  };
}

const EMPTY: PadState = {
  id: undefined,
  standard: false,
  buttons: [],
  axes: [],
  triggers: { lt: 0, rt: 0 },
  sticks: { left: ZERO, right: ZERO },
};

/** An empty pad of the same layout, what a pad is compared against when it connects or leaves. */
const emptyLike = (s: PadState): PadState => ({ ...EMPTY, standard: s.standard, id: s.id });

function diff(pad: number, before: PadState, after: PadState, out: PadChange[]): void {
  const standard = after.standard;
  const buttonCount = Math.max(before.buttons.length, after.buttons.length);
  for (let i = 0; i < buttonCount; i++) {
    const was = before.buttons[i] ?? false;
    const now = after.buttons[i] ?? false;
    if (was === now) continue;
    const button: PadButton = standard ? (PAD_BUTTONS[i] ?? i) : i;
    out.push({ pad, kind: "button", button, index: i, pressed: now });
  }
  const axisCount = Math.max(before.axes.length, after.axes.length);
  for (let i = 0; i < axisCount; i++) {
    const was = before.axes[i] ?? 0;
    const now = after.axes[i] ?? 0;
    if (was === now) continue;
    const axis: PadAxis = standard ? (PAD_AXES[i] ?? i) : i;
    out.push({ pad, kind: "axis", axis, index: i, value: now });
  }
  if (!standard) return;
  for (const trigger of ["lt", "rt"] as const) {
    if (before.triggers[trigger] !== after.triggers[trigger])
      out.push({ pad, kind: "axis", axis: trigger, value: after.triggers[trigger] });
  }
  for (const stick of ["left", "right"] as const) {
    const was = before.sticks[stick];
    const now = after.sticks[stick];
    if (was.x !== now.x || was.y !== now.y)
      out.push({ pad, kind: "stick", stick, x: now.x, y: now.y });
  }
}

/**
 * Polls the browser's pads (or `getGamepads`) once per shell tick into
 * button edges and quantised axis and stick values. Pads are keyed by
 * index; a pad missing from the list, `null` or not `connected` is gone.
 */
export function createGamepadReader(opts: GamepadReaderOptions = {}): GamepadReader {
  const source = opts.getGamepads ?? browserGamepads();
  const deadzone = opts.deadzone ?? DEFAULT_DEADZONE;
  let states = new Map<number, PadState>();
  let lastTick: number | null = null;
  let destroyed = false;

  const read = (): Map<number, PadState> => {
    const next = new Map<number, PadState>();
    if (!source) return next;
    let list: readonly (PadSnapshot | null)[];
    try {
      list = source() ?? [];
    } catch {
      return next;
    }
    for (const pad of list) {
      if (!pad || !pad.connected || next.has(pad.index)) continue;
      next.set(pad.index, readPad(pad, deadzone));
    }
    return next;
  };

  const poll = (tick: number): GamepadPoll => {
    const result: GamepadPoll = { tick, changes: [], connected: [], disconnected: [] };
    if (destroyed || tick === lastTick) return result;
    lastTick = tick;
    const next = read();
    const indices = [...new Set([...states.keys(), ...next.keys()])].sort((a, b) => a - b);
    for (const pad of indices) {
      const before = states.get(pad);
      const after = next.get(pad);
      const replaced =
        !!before && !!after && (before.id !== after.id || before.standard !== after.standard);
      if (before && (!after || replaced)) {
        diff(pad, before, emptyLike(before), result.changes);
        result.disconnected.push(pad);
      }
      if (after && (!before || replaced)) {
        result.connected.push(pad);
        diff(pad, emptyLike(after), after, result.changes);
      } else if (before && after) {
        diff(pad, before, after, result.changes);
      }
    }
    states = next;
    return result;
  };

  const reading = (pad: number, binding: PadBinding): number | Vec2 => {
    const state = states.get(pad);
    if ("stick" in binding) return state?.standard ? state.sticks[binding.stick] : ZERO;
    if (!state) return 0;
    if ("button" in binding) {
      if (typeof binding.button === "number") return state.buttons[binding.button] ? 1 : 0;
      return state.standard && state.buttons[PAD_BUTTONS.indexOf(binding.button)] ? 1 : 0;
    }
    const axis = binding.axis;
    if (typeof axis === "number") return state.axes[axis] ?? 0;
    if (!state.standard) return 0;
    if (axis === "lt" || axis === "rt") return state.triggers[axis];
    return state.axes[PAD_AXES.indexOf(axis)] ?? 0;
  };

  return {
    poll,
    pads: () => [...states.keys()].sort((a, b) => a - b),
    reading,
    destroy() {
      destroyed = true;
      states = new Map();
    },
  };
}
