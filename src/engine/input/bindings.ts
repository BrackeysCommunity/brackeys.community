import { declaredBindings } from "../game/input-bindings";
import type { PadAxis, PadButton, PointerButton } from "../game/input-codes";
import type { ActionDef, ActionKind, Binding, DeviceId } from "../game/types";
import type { InputMapFile } from "../project/kinds/input-map";
import type { ActionBindings, InputBinding, Vec2 } from "../types";
import { qAxis, qVector } from "./quantize";
import type { RemapState } from "./remap";

/** An action's bindings: its `bindings`, else its 0.x `keys` mapped through `KEY_TO_CODE`. */
export function actionBindings(binding: InputBinding): readonly Binding[] {
  return declaredBindings(binding);
}

/** Bindings by action, from a list in which a later entry for an action adds to the earlier ones. */
export function bindingsByAction(list: readonly InputBinding[]): ActionBindings {
  const out: Record<string, Binding[]> = {};
  for (const binding of list) (out[binding.action] ??= []).push(...actionBindings(binding));
  return out;
}

/** Where a seat's bindings for an action came from, first to last in precedence. */
export type BindingLayerName = "remap" | "host" | "map" | "game";

/** The four layers, each optional but the game's. */
export type BindingLayers = {
  /** The player's remaps (a `RemapStore`'s state), per seat. */
  remap?: RemapState | null;
  /** The host's `GameConfig.bindings`. */
  host?: readonly InputBinding[] | null;
  /** The project's input map. */
  map?: Pick<InputMapFile, "actions"> | null;
  /** The game's `actions`, which also give each action its kind. */
  game: readonly ActionDef[];
  /** How many seats there are (`resolvePlayers(…).max`); default 1. */
  players?: number;
};

/** One binding as a device table holds it. */
export type BoundInput = {
  action: string;
  kind: ActionKind;
  /** The seat the input drives. */
  player: number;
  /**
   * The binding names its seat (a key binding's `player`), so it drives
   * that seat whoever owns the device; otherwise it drives `player` only
   * while that seat owns the device.
   */
  fixed: boolean;
  binding: Binding;
};

type Table<K> = ReadonlyMap<K, readonly BoundInput[]>;

/** Every binding by the device input it listens to, in action, then seat, then binding order. */
export type DeviceTables = {
  /** By `KeyboardEvent.code`. */
  keys: Table<string>;
  padButtons: Table<PadButton>;
  padAxes: Table<PadAxis | "lt" | "rt">;
  padSticks: Table<"left" | "right">;
  pointer: Table<PointerButton>;
  /** By touch control id. */
  touch: Table<string>;
};

export type ResolvedBindings = {
  players: number;
  /** Every action any layer names: the game's in declared order, then the others by first appearance. */
  actions: readonly string[];
  /** A declared action's kind; "button" for one only a host or remap names. */
  kindOf: (action: string) => ActionKind;
  /** A seat's winning bindings by action (default seat 0). */
  bindings: (player?: number) => ActionBindings;
  /** The layer whose bindings a seat uses for an action; null for an action no layer names. */
  source: (action: string, player?: number) => BindingLayerName | null;
  tables: DeviceTables;
};

/**
 * Combines the binding layers: per action and seat, the first layer that
 * names the action (the player's remap, the host, the project's input map,
 * the game) supplies its bindings, replacing the later layers' whole; a
 * layer that names an action with no bindings leaves it unbound. Then
 * indexes every seat's bindings by device. Bindings are taken as given:
 * `bindingProblems` judges them where they enter.
 */
export function resolveBindings(layers: BindingLayers): ResolvedBindings {
  const players = Math.max(1, Math.floor(layers.players ?? 1));
  const kinds = new Map<string, ActionKind>();
  for (const def of layers.game)
    if (!kinds.has(def.action)) kinds.set(def.action, def.kind ?? "button");

  const game = bindingsByAction(layers.game);
  const map = layers.map?.actions ? mapBindings(layers.map.actions) : null;
  const host = layers.host ? bindingsByAction(layers.host) : null;
  const remap = layers.remap?.players ?? null;

  const actions = [...kinds.keys()];
  const seen = new Set(actions);
  const note = (names: Iterable<string>) => {
    for (const name of names)
      if (!seen.has(name)) {
        seen.add(name);
        actions.push(name);
      }
  };
  note(Object.keys(map ?? {}));
  note(Object.keys(host ?? {}));
  for (let p = 0; p < players; p++) note(Object.keys(remap?.[p] ?? {}));

  const has = (o: object | null | undefined, k: string): o is Record<string, readonly Binding[]> =>
    !!o && Object.hasOwn(o, k);

  const seats: {
    bindings: Record<string, readonly Binding[]>;
    source: Map<string, BindingLayerName>;
  }[] = [];
  for (let p = 0; p < players; p++) {
    const bindings: Record<string, readonly Binding[]> = {};
    const source = new Map<string, BindingLayerName>();
    const seatRemap = remap?.[p];
    for (const action of actions) {
      const pick = (name: BindingLayerName, layer: object | null | undefined): boolean => {
        if (!has(layer, action)) return false;
        // A key binding pinned to another seat drives that seat only.
        bindings[action] = layer[action]!.filter(
          (b) => b.device !== "key" || b.player === undefined || b.player === p,
        );
        source.set(action, name);
        return true;
      };
      if (!pick("remap", seatRemap) && !pick("host", host) && !pick("map", map)) pick("game", game);
    }
    seats.push({ bindings, source });
  }

  const tables = {
    keys: new Map<string, BoundInput[]>(),
    padButtons: new Map<PadButton, BoundInput[]>(),
    padAxes: new Map<PadAxis | "lt" | "rt", BoundInput[]>(),
    padSticks: new Map<"left" | "right", BoundInput[]>(),
    pointer: new Map<PointerButton, BoundInput[]>(),
    touch: new Map<string, BoundInput[]>(),
  };
  const add = <K>(table: Map<K, BoundInput[]>, key: K, entry: BoundInput) => {
    const list = table.get(key);
    if (list) list.push(entry);
    else table.set(key, [entry]);
  };
  const kindOf = (action: string): ActionKind => kinds.get(action) ?? "button";

  for (const action of actions) {
    const kind = kindOf(action);
    for (let p = 0; p < players; p++) {
      for (const binding of seats[p]!.bindings[action] ?? []) {
        const entry: BoundInput = { action, kind, player: p, fixed: false, binding };
        switch (binding.device) {
          case "key":
            add(tables.keys, binding.code, { ...entry, fixed: binding.player !== undefined });
            break;
          case "pad":
            if ("stick" in binding) add(tables.padSticks, binding.stick, entry);
            else if ("button" in binding) add(tables.padButtons, binding.button, entry);
            else add(tables.padAxes, binding.axis, entry);
            break;
          case "pointer":
            add(tables.pointer, binding.button, entry);
            break;
          case "touch":
            add(tables.touch, binding.control, entry);
            break;
        }
      }
    }
  }

  const seatOf = (player = 0) => seats[player];
  return {
    players,
    actions,
    kindOf,
    bindings: (player) => ({ ...seatOf(player)?.bindings }),
    source: (action, player) => seatOf(player)?.source.get(action) ?? null,
    tables,
  };
}

/** The kinds of device a seat owns, each feeding its own tables. */
export type DeviceClass = "keyboard" | "pointer" | "touch" | "pad";

export const deviceClass = (device: DeviceId): DeviceClass =>
  device.startsWith("pad:") ? "pad" : (device as DeviceClass);

const CLASS_TABLES: Readonly<Record<DeviceClass, readonly (keyof DeviceTables)[]>> = {
  keyboard: ["keys"],
  pointer: ["pointer"],
  touch: ["touch"],
  pad: ["padButtons", "padAxes", "padSticks"],
};

/**
 * The tables an input system reads for devices owned by the seats in
 * `owners`: per device class, the bindings of its owner's seat, plus every
 * binding that names its own seat (a key binding's `player`), all marked
 * `fixed` so they drive the seat they carry. A class whose owner is null
 * keeps only the bindings that name a seat; a class `owners` leaves out
 * reads nothing.
 */
export function seatTables(
  tables: DeviceTables,
  owners: Partial<Record<DeviceClass, number | null>>,
): DeviceTables {
  const out = {
    keys: new Map(),
    padButtons: new Map(),
    padAxes: new Map(),
    padSticks: new Map(),
    pointer: new Map(),
    touch: new Map(),
  } as { [K in keyof DeviceTables]: Map<unknown, BoundInput[]> };
  for (const cls of Object.keys(CLASS_TABLES) as DeviceClass[]) {
    if (!Object.hasOwn(owners, cls)) continue;
    const owner = owners[cls] ?? null;
    for (const name of CLASS_TABLES[cls]) {
      for (const [key, list] of tables[name] as ReadonlyMap<unknown, readonly BoundInput[]>) {
        const kept = list.flatMap((b) =>
          b.fixed ? [b] : b.player === owner ? [{ ...b, fixed: true }] : [],
        );
        if (kept.length > 0) out[name].set(key, kept);
      }
    }
  }
  return out as unknown as DeviceTables;
}

function mapBindings(actions: NonNullable<InputMapFile["actions"]>): ActionBindings {
  const out: Record<string, Binding[]> = {};
  for (const entry of actions) (out[entry.action] ??= []).push(...(entry.bindings ?? []));
  return out;
}

/**
 * What one binding reads now: 1 for a held key or button (0 or absent once
 * let go), an analog reading for a pad axis or trigger, a position for a
 * stick or an on-screen stick or pad.
 */
export type BindingReading = { binding: Binding; reading: number | Vec2 };

/** An action's combined state: `pressed` for a button; also `value` for an axis, `x` and `y` for a vector. */
export type ActionValue = { pressed: boolean; value?: number; x?: number; y?: number };

const isVec = (r: number | Vec2): r is Vec2 => typeof r === "object";

/** A key or pad button: it contributes its binding's `value` (default 1) while held. */
function isPress(binding: Binding): binding is Extract<Binding, { value?: number }> {
  return binding.device === "key" || (binding.device === "pad" && "button" in binding);
}

/** A number reading on an axis action: a press scaled by its `value`, a pad axis by its `scale`. */
function axisContribution(binding: Binding, reading: number): number {
  if (isPress(binding)) return reading * (binding.value ?? 1);
  if (binding.device === "pad" && "axis" in binding) return reading * (binding.scale ?? 1);
  return reading;
}

/** The value furthest from zero; values of both signs tied for furthest cancel to 0. */
function largestMagnitude(values: readonly number[]): number {
  let best = 0;
  let cancelled = false;
  for (const v of values) {
    const m = Math.abs(v);
    if (m > Math.abs(best)) {
      best = v;
      cancelled = false;
    } else if (m > 0 && m === Math.abs(best) && v !== best) {
      cancelled = true;
    }
  }
  return cancelled ? 0 : best;
}

/**
 * Combines every binding of one action into its state, the one rule the
 * live input and anything replaying device readings use. A button is down
 * while any binding reads non-zero; an axis takes the reading furthest from
 * zero, clamped to −1…1; a vector sums its keys and pad buttons (each its
 * `value` on its `axis`) and adds the stick reading furthest from the
 * centre, then clamps the sum to the unit disc. Axis and vector values are
 * quantised to 1/1000, and `pressed` means non-zero.
 */
export function combineAction(kind: ActionKind, readings: readonly BindingReading[]): ActionValue {
  if (kind === "button") {
    const pressed = readings.some(({ reading }) =>
      isVec(reading) ? reading.x !== 0 || reading.y !== 0 : reading !== 0,
    );
    return { pressed };
  }
  if (kind === "axis") {
    const values: number[] = [];
    for (const { binding, reading } of readings)
      if (!isVec(reading)) values.push(axisContribution(binding, reading));
    const value = qAxis(largestMagnitude(values));
    return { pressed: value !== 0, value };
  }
  const sum = { x: 0, y: 0 };
  let stick: Vec2 | null = null;
  let stickMagnitude = 0;
  for (const { binding, reading } of readings) {
    if (isVec(reading)) {
      const m = reading.x * reading.x + reading.y * reading.y;
      if (m > stickMagnitude) {
        stick = reading;
        stickMagnitude = m;
      }
    } else if (isPress(binding) && binding.axis) {
      sum[binding.axis] += reading * (binding.value ?? 1);
    }
  }
  if (stick) {
    sum.x += stick.x;
    sum.y += stick.y;
  }
  const { x, y } = qVector(sum);
  return { pressed: x !== 0 || y !== 0, x, y };
}

/** Whether two states of one action differ, so the change raises an action. */
export function actionValueChanged(a: ActionValue, b: ActionValue): boolean {
  return a.pressed !== b.pressed || a.value !== b.value || a.x !== b.x || a.y !== b.y;
}
