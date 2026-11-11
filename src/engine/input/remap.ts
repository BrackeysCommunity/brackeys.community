import { KEY_CODES, PAD_BUTTONS, type PadButton, type PointerButton } from "../game/input-codes";
import type { Binding } from "../game/types";

/** A player's remapped bindings, per seat and action. */
export type RemapState = {
  v: 1;
  players: Readonly<Record<number, Readonly<Record<string, readonly Binding[]>>>>;
};

/** Where a player's remaps persist between sessions; never sent anywhere. */
export interface RemapStore {
  load(gameId: string): RemapState | null;
  save(gameId: string, state: RemapState): void;
}

/** Remaps kept for this page's life: tests, and hosts that don't persist them. */
export function memoryRemapStore(): RemapStore {
  const saved = new Map<string, RemapState>();
  return {
    load: (gameId) => {
      const state = saved.get(gameId);
      return state ? structuredClone(state) : null;
    },
    save: (gameId, state) => void saved.set(gameId, structuredClone(state)),
  };
}

/**
 * Remaps in `localStorage` under `${prefix}${gameId}`. Every access is in
 * try/catch: storage that is missing, blocked or full, or a stored value that
 * doesn't parse as a v1 state, loads as none and never throws.
 */
export function browserRemapStore(prefix = "jams-engine:remap:"): RemapStore {
  const storage = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    load: (gameId) => {
      try {
        const raw = storage()?.getItem(`${prefix}${gameId}`);
        if (raw == null) return null;
        const state: unknown = JSON.parse(raw);
        return isRemapState(state) ? state : null;
      } catch {
        return null;
      }
    },
    save: (gameId, state) => {
      try {
        storage()?.setItem(`${prefix}${gameId}`, JSON.stringify(state));
      } catch {
        // A remap that can't persist still applies for this session.
      }
    },
  };
}

const DEVICES: readonly string[] = ["key", "pad", "pointer", "touch"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored shape only; whether each binding names a real code is the binding check's job. */
function isRemapState(value: unknown): value is RemapState {
  if (!isRecord(value) || value.v !== 1 || !isRecord(value.players)) return false;
  return Object.entries(value.players).every(
    ([seat, actions]) =>
      /^(0|[1-9]\d*)$/.test(seat) &&
      isRecord(actions) &&
      Object.values(actions).every(
        (bindings) =>
          Array.isArray(bindings) &&
          bindings.every(
            (b) => isRecord(b) && typeof b.device === "string" && DEVICES.includes(b.device),
          ),
      ),
  );
}

export type CaptureDevice = "key" | "pad" | "pointer";

/** A press the host saw while a "press a key" prompt waits. */
export type CapturePress =
  /** A keydown; `repeat` is `KeyboardEvent.repeat`. */
  | { device: "key"; code: string; repeat?: boolean }
  /** A pad button going down, named as the gamepad reader names it. */
  | { device: "pad"; button: PadButton }
  /** A pointerdown; a number is `PointerEvent.button` (0 primary, 1 middle, 2 secondary). */
  | { device: "pointer"; button: PointerButton | number };

/** `wait`: not a press the prompt takes; `cancel`: Escape; `bind`: the captured binding. */
export type CaptureResult =
  | { kind: "wait" }
  | { kind: "cancel" }
  | { kind: "bind"; binding: Binding };

const POINTER_BY_INDEX: readonly PointerButton[] = ["primary", "middle", "secondary"];

/**
 * Judges one press for `GameInstance.input.capture`: Escape always cancels,
 * held-key repeats, unknown key codes and devices the prompt didn't ask for
 * keep it waiting, and anything else becomes the binding.
 */
export function matchCapturePress(
  press: CapturePress,
  devices: readonly CaptureDevice[] = ["key", "pad", "pointer"],
): CaptureResult {
  if (press.device === "key" && press.code === "Escape") return { kind: "cancel" };
  if (!devices.includes(press.device)) return { kind: "wait" };
  switch (press.device) {
    case "key":
      if (press.repeat || !KEY_CODES.includes(press.code)) return { kind: "wait" };
      return { kind: "bind", binding: { device: "key", code: press.code } };
    case "pad": {
      const { button } = press;
      const known =
        typeof button === "number"
          ? Number.isInteger(button) && button >= 0
          : (PAD_BUTTONS as readonly string[]).includes(button);
      return known ? { kind: "bind", binding: { device: "pad", button } } : { kind: "wait" };
    }
    case "pointer": {
      const button =
        typeof press.button === "number" ? POINTER_BY_INDEX[press.button] : press.button;
      return button && POINTER_BY_INDEX.includes(button)
        ? { kind: "bind", binding: { device: "pointer", button } }
        : { kind: "wait" };
    }
  }
}
