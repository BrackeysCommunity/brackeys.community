import { KEY_TO_CODE, pointerBit, POINTER_BUTTONS, type PointerButton } from "../game/input-codes";
import type { DeviceId } from "../game/types";
import { createToolRouter, isEditableTarget, TOOL_PRIORITY } from "../tool-router";
import type { ToolConsumer, ToolEvent, ToolRouter } from "../tool-router";
import type { InputAction, UiActionEvent, Vec2 } from "../types";
import { actionValueChanged, combineAction } from "./bindings";
import type { ActionValue, BoundInput, DeviceTables } from "./bindings";
import type { GamepadPoll, GamepadReader, PadBinding, PadChange } from "./gamepad";
import type { TouchControlValue } from "./touch-controls";

/** The pointer as play input last saw it, in CSS pixels from the input target's top-left corner. */
export type PointerReading = {
  x: number;
  y: number;
  /** Bit 0 primary, 1 secondary, 2 middle: the buttons play input holds. */
  buttons: number;
  /** Whether the pointer is over the input target; a lifted touch is not. */
  over: boolean;
};

/** A touch on an on-screen control, from where it starts until it lifts. */
export type ControlTouch = {
  phase: "start" | "move" | "end";
  /** CSS pixels from the input target's top-left corner. */
  screen: Vec2;
  /** The touch's `pointerId`, so two thumbs on two controls stay apart. */
  id: number;
};

/**
 * What on-screen controls offer play input. A touch that starts where
 * `controlAt` names a control belongs to that control until it lifts, and
 * `drive` follows it there (the overlay turns it into the control's value
 * and reports that through `setControl`); every other touch is left to the
 * pointer.
 */
export type TouchControlTarget = {
  /** The control under `screen` (CSS pixels from the input target's top-left corner), or null. */
  controlAt: (screen: Vec2) => string | null;
  /** Follows a touch that started on `control`; absent when the overlay listens for its own touches. */
  drive?: (control: string, touch: ControlTouch) => void;
};

export type InputSystemOptions = {
  /**
   * Whether an action is UI-only (`isUiAction`): its changes reach `onAction`
   * listeners and never the tick queue. Default: none is.
   */
  isUi?: (action: string) => boolean;
};

export type InputSystem = {
  /** Listens on `target` by itself; inside the shell a tool router feeds `consumer()` instead. */
  attach: (target: HTMLElement | Window) => void;
  detach: () => void;
  /** The simulation's actions since the last poll, stamped `tick`; never a UI-only action. */
  poll: (tick: number) => InputAction[];
  /**
   * Every action's edges and quantised value changes as the devices produce
   * them, UI-only or not, plus a held button's OS key repeat (`repeat: true`);
   * `actions` narrows it. Pads reach listeners through `setFramePads` only.
   * Returns the unsubscribe.
   */
  onAction: (
    listener: (e: UiActionEvent) => void,
    opts?: { actions?: readonly string[] },
  ) => () => void;
  /** Whether any `onAction` listener is registered, so a host knows to poll pads each frame. */
  listening: () => boolean;
  /** The pointer in CSS pixels from the input target's top-left corner. */
  getMousePosition: () => { x: number; y: number };
  /** Whether the pointer has moved over the input target yet. */
  hasPointer: () => boolean;
  /** The pointer's position, the buttons play input holds, and whether it is over the target. */
  getPointer: () => PointerReading;
  /** Routes touches that start on an on-screen control to it; null routes every touch to the pointer. */
  setTouchControls: (target: TouchControlTarget | null) => void;
  /**
   * A poll's pad changes, raising the actions the pads' bindings name. Every
   * pad drives seat 0; a binding reads the connected pad furthest from rest.
   */
  setPads: (
    poll: GamepadPoll,
    reader: Pick<GamepadReader, "pads" | "reading">,
    timestamp?: number,
  ) => void;
  /**
   * `setPads` for the listeners: a frame poll's pad changes (`GamepadReader.pollFrame`,
   * read through its `frame` cursor) reach `onAction` and never the tick queue.
   */
  setFramePads: (
    poll: GamepadPoll,
    reader: Pick<GamepadReader, "pads" | "reading">,
    timestamp?: number,
  ) => void;
  /** An on-screen control's value, raising the actions its touch bindings name (the overlay's sink). */
  setControl: (control: string, value: TouchControlValue, timestamp?: number) => void;
  /** While disabled, key presses are ignored and their default actions left alone. */
  setEnabled: (enabled: boolean) => void;
  /** Whether the physical key `code` (a `KeyboardEvent.code`, "KeyW") is held. */
  isKeyDown: (code: string) => boolean;
  /** Lets go of every held key, pointer button and control, for when the target loses focus and its releases go elsewhere. */
  releaseAll: (timestamp?: number) => void;
  /** Drops queued actions and forgets held keys without releasing them, so nothing pressed before reaches the next tick. */
  flush: () => void;
  /** Play input as a router consumer at `TOOL_PRIORITY.play`: key presses, the pointer and its buttons, touches. */
  consumer: () => ToolConsumer;
  destroy: () => void;
};

type KeyEvent = Extract<ToolEvent, { kind: "key" }>;

/** Browser and app shortcuts (Mod+S), and typing into a field, are not game input. */
function isForeignKey(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target);
}

/**
 * The physical keys an event stands for: its `code`, or, for a key with no
 * physical position (a virtual keyboard reports `code: ""`), every code its
 * US-layout key comes from.
 */
function codesOf(e: KeyEvent): readonly string[] {
  if (e.code) return [e.code];
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return KEY_TO_CODE[key] ?? [];
}

/** The pointer buttons by DOM `button` number, with their `buttons` bits. */
const POINTER_BUTTON: readonly { name: PointerButton; bit: number }[] = (
  ["primary", "middle", "secondary"] as const
).map((name) => ({ name, bit: pointerBit(name) }));
const PRIMARY_BIT = pointerBit("primary");
const BUTTON_BITS = POINTER_BUTTONS.reduce((bits, b) => bits | pointerBit(b), 0);

/** What each of an action's bindings reads now, and the state they combine to. */
type Side = { readings: Map<BoundInput, number | Vec2>; state: ActionValue };

/**
 * One seat's action, read twice: `tick` for the simulation's queue, with
 * pads as the tick poll read them; `live` for `onAction`, with pads as the
 * frame poll read them. Keys, the pointer and touch feed both alike.
 */
type Slot = {
  action: string;
  kind: BoundInput["kind"];
  player: number;
  tick: Side;
  live: Side;
  /** The device that last moved the live side, which its events name. */
  device: DeviceId;
};

/** Which of a slot's sides a reading feeds. */
type Sides = "both" | "tick" | "live";

type Listener = { fn: (e: UiActionEvent) => void; actions: ReadonlySet<string> | null };

const neutral = (kind: BoundInput["kind"]): ActionValue =>
  kind === "button"
    ? { pressed: false }
    : kind === "axis"
      ? { pressed: false, value: 0 }
      : { pressed: false, x: 0, y: 0 };

/**
 * Turns key presses, pointer buttons and on-screen controls into the
 * actions `tables` binds (`resolveBindings`), matching each key by its
 * physical `code` so a binding means the same key on every layout; the
 * engine gives no action a meaning. The keyboard, the pointer and touch
 * drive seat 0, and any seat a key binding names. An action's bindings
 * combine by `combineAction`: a button action is raised on each edge of
 * "any binding held", an axis or vector action whenever its quantised value
 * changes. A touch that starts on an on-screen control drives it; the first
 * other touch is the pointer, holding its primary button. Each change goes
 * to the `onAction` listeners, and to the tick queue unless `opts.isUi`
 * names its action.
 */
export function createInputSystem(
  tables: Pick<DeviceTables, "keys"> &
    Partial<Pick<DeviceTables, "pointer" | "touch" | "padButtons" | "padAxes" | "padSticks">>,
  opts: InputSystemOptions = {},
): InputSystem {
  const isUi = opts.isUi ?? (() => false);
  const actionQueue: InputAction[] = [];
  const listeners: Listener[] = [];
  const keysDown = new Set<string>();
  const slots = new Map<string, Slot>();
  const mousePosition = { x: 0, y: 0 };
  let pointerSeen = false;
  let pointerOver = false;
  let buttonsHeld = 0;
  let controls: TouchControlTarget | null = null;
  /** Touches on a control, by `pointerId`. */
  const controlTouches = new Map<number, string>();
  /** The touch acting as the pointer. */
  let pointerTouch: number | null = null;

  let enabled = true;
  let ownRouter: ToolRouter | null = null;

  function slotOf(bound: BoundInput): Slot {
    const id = `${bound.player}:${bound.action}`;
    let slot = slots.get(id);
    if (!slot) {
      const side = (): Side => ({ readings: new Map(), state: neutral(bound.kind) });
      slot = {
        action: bound.action,
        kind: bound.kind,
        player: bound.player,
        tick: side(),
        live: side(),
        device: "keyboard",
      };
      slots.set(id, slot);
    }
    return slot;
  }

  /** Re-combines one side of a slot; the new state when it changed. */
  function combine(slot: Slot, side: Side): ActionValue | null {
    const readings = [...side.readings].map(([bound, reading]) => ({
      binding: bound.binding,
      reading,
    }));
    const next = combineAction(slot.kind, readings);
    if (!actionValueChanged(side.state, next)) return null;
    side.state = next;
    return next;
  }

  function emit(slot: Slot, value: ActionValue, repeat = false): void {
    if (listeners.length === 0) return;
    const event: UiActionEvent = {
      action: slot.action,
      player: slot.player,
      kind: slot.kind,
      device: slot.device,
    };
    if (slot.kind === "button") event.down = value.pressed;
    if (repeat) event.repeat = true;
    if (slot.kind === "axis") event.value = value.value ?? 0;
    if (slot.kind === "vector") event.vector = { x: value.x ?? 0, y: value.y ?? 0 };
    for (const l of [...listeners]) {
      if (l.actions && !l.actions.has(slot.action)) continue;
      try {
        l.fn(event);
      } catch (error) {
        console.error("[input] an onAction listener threw", error);
      }
    }
  }

  /**
   * Re-combines the sides `sides` names: a changed tick side queues an
   * action unless it is UI-only, a changed live side reaches the listeners.
   */
  function settle(slot: Slot, timestamp: number, sides: Sides = "both"): void {
    if (sides !== "live") {
      const next = combine(slot, slot.tick);
      if (next && !isUi(slot.action)) {
        const action: InputAction = {
          action: slot.action,
          pressed: next.pressed,
          tick: 0,
          timestamp,
        };
        if (next.value !== undefined) action.value = next.value;
        if (next.x !== undefined) action.x = next.x;
        if (next.y !== undefined) action.y = next.y;
        if (slot.player !== 0) action.player = slot.player;
        actionQueue.push(action);
      }
    }
    if (sides !== "tick") {
      const next = combine(slot, slot.live);
      if (next) emit(slot, next);
    }
  }

  /** Whether a binding drives its seat now: seat 0's, or one routed to the seat that owns its device. */
  const drives = (b: BoundInput) => b.player === 0 || b.fixed;

  const sidesOf = (slot: Slot, sides: Sides): Side[] =>
    sides === "both" ? [slot.tick, slot.live] : [slot[sides]];

  /**
   * Sets what each binding in `bound` reads (null: let go), skipping those
   * for a seat that doesn't own the device; whether any of them is bound.
   */
  function read(
    bound: Iterable<BoundInput>,
    reading: number | Vec2 | null,
    timestamp: number,
    device: DeviceId,
  ): boolean {
    const touched: Slot[] = [];
    for (const b of bound) {
      if (!drives(b)) continue;
      const slot = slotOf(b);
      for (const side of sidesOf(slot, "both")) {
        if (reading === null) side.readings.delete(b);
        else side.readings.set(b, reading);
      }
      slot.device = device;
      if (!touched.includes(slot)) touched.push(slot);
    }
    for (const slot of touched) settle(slot, timestamp);
    return touched.length > 0;
  }

  const keyBound = (codes: Iterable<string>): BoundInput[] => {
    const bound: BoundInput[] = [];
    for (const code of codes) bound.push(...(tables.keys.get(code) ?? []));
    return bound;
  };

  function press(codes: Iterable<string>, down: boolean, timestamp: number): boolean {
    return read(keyBound(codes), down ? 1 : null, timestamp, "keyboard");
  }

  /** The OS's repeat of held keys: each held button action they drive, to the listeners alone. */
  function repeatKeys(codes: Iterable<string>): void {
    const repeated: Slot[] = [];
    for (const b of keyBound(codes)) {
      if (!drives(b) || b.kind !== "button") continue;
      const slot = slotOf(b);
      if (slot.live.state.pressed && !repeated.includes(slot)) repeated.push(slot);
    }
    for (const slot of repeated) {
      slot.device = "keyboard";
      emit(slot, slot.live.state, true);
    }
  }

  /** Holds or lets go of the pointer buttons in `bits`, raising their bindings' actions. */
  function setButtons(bits: number, down: boolean, timestamp: number): void {
    const changed = down ? bits & ~buttonsHeld : bits & buttonsHeld;
    if (changed === 0) return;
    buttonsHeld = down ? buttonsHeld | changed : buttonsHeld & ~changed;
    for (const { name, bit } of POINTER_BUTTON) {
      if (changed & bit)
        read(tables.pointer?.get(name) ?? [], down ? 1 : null, timestamp, "pointer");
    }
  }

  function setControl(control: string, value: TouchControlValue, timestamp = 0): void {
    const reading =
      "down" in value
        ? value.down
          ? 1
          : null
        : value.x !== 0 || value.y !== 0
          ? { x: value.x, y: value.y }
          : null;
    read(tables.touch?.get(control) ?? [], reading, timestamp, "touch");
  }

  /** The bindings a pad change moves: by name and, where the pad names it, by raw index too. */
  function padBound(change: PadChange): readonly BoundInput[] {
    if (change.kind === "stick") return tables.padSticks?.get(change.stick) ?? [];
    const named =
      change.kind === "button"
        ? (tables.padButtons?.get(change.button) ?? [])
        : (tables.padAxes?.get(change.axis) ?? []);
    const key = change.kind === "button" ? change.button : change.axis;
    if (change.index === undefined || change.index === key) return named;
    const table = change.kind === "button" ? tables.padButtons : tables.padAxes;
    return [...named, ...(table?.get(change.index) ?? [])];
  }

  /** A poll's pad changes into one side of their slots: the tick poll's or the frame poll's. */
  function readPads(
    poll: GamepadPoll,
    reader: Pick<GamepadReader, "pads" | "reading">,
    timestamp: number,
    sides: "tick" | "live",
  ): void {
    const bound = new Map<BoundInput, number>();
    for (const change of poll.changes)
      for (const b of padBound(change)) if (!bound.has(b)) bound.set(b, change.pad);
    const pads = reader.pads();
    const touched: Slot[] = [];
    for (const [b, changedPad] of bound) {
      if (!drives(b)) continue;
      let best: number | Vec2 = 0;
      let bestMagnitude = 0;
      let bestPad = changedPad;
      for (const pad of pads) {
        const r = reader.reading(pad, b.binding as PadBinding);
        const m = typeof r === "number" ? Math.abs(r) : r.x * r.x + r.y * r.y;
        if (m > bestMagnitude) {
          best = r;
          bestMagnitude = m;
          bestPad = pad;
        }
      }
      const slot = slotOf(b);
      const side = slot[sides];
      if (bestMagnitude > 0) side.readings.set(b, best);
      else side.readings.delete(b);
      if (sides === "live") slot.device = `pad:${bestPad}`;
      if (!touched.includes(slot)) touched.push(slot);
    }
    // Every changed binding is read before any action settles, so one poll raises one action each.
    for (const slot of touched) settle(slot, timestamp, sides);
  }

  const setPads: InputSystem["setPads"] = (poll, reader, timestamp = 0) =>
    readPads(poll, reader, timestamp, "tick");
  const setFramePads: InputSystem["setFramePads"] = (poll, reader, timestamp = 0) =>
    readPads(poll, reader, timestamp, "live");

  type PointerEventOf = Extract<ToolEvent, { kind: "pointer" }>;

  function movePointer(e: PointerEventOf): void {
    mousePosition.x = e.screen.x;
    mousePosition.y = e.screen.y;
    pointerSeen = true;
    pointerOver = !e.left;
  }

  /** A mouse or pen: its buttons are pointer buttons, and every move moves the pointer. */
  function handleMouse(e: PointerEventOf): void {
    const timestamp = e.native.timeStamp;
    movePointer(e);
    const bit = POINTER_BUTTON[e.button]?.bit ?? 0;
    if (e.type === "down") {
      setButtons(bit, true, timestamp);
      capture(e);
    } else if (e.type === "up") {
      setButtons(bit, false, timestamp);
    } else if (bit !== 0 && !e.left) {
      // A button pressed or let go while another is held arrives as a move.
      const others = ~bit & BUTTON_BITS;
      if ((buttonsHeld & others) !== 0 || (e.native.buttons & others) !== 0)
        setButtons(bit, (e.native.buttons & bit) !== 0, timestamp);
    }
  }

  /** A touch: on a control it drives the control; the first other touch is the pointer. */
  function handleTouch(e: PointerEventOf): void {
    const id = e.pointerId ?? 0;
    const timestamp = e.native.timeStamp;
    const control = controlTouches.get(id);
    if (control !== undefined) {
      if (e.left) return;
      const phase = e.type === "up" ? "end" : "move";
      if (phase === "end") controlTouches.delete(id);
      controls?.drive?.(control, { phase, screen: e.screen, id });
      return;
    }
    if (e.type === "down") {
      const hit = controls?.controlAt(e.screen) ?? null;
      if (hit !== null) {
        controlTouches.set(id, hit);
        controls?.drive?.(hit, { phase: "start", screen: e.screen, id });
        capture(e);
        return;
      }
      if (pointerTouch !== null) return;
      pointerTouch = id;
      movePointer(e);
      setButtons(PRIMARY_BIT, true, timestamp);
      capture(e);
      return;
    }
    if (id !== pointerTouch) return;
    movePointer(e);
    if (e.type === "up") {
      pointerTouch = null;
      pointerOver = false;
      setButtons(PRIMARY_BIT, false, timestamp);
    }
  }

  /** Keeps a press's moves and release coming here after it leaves the target. */
  function capture(e: PointerEventOf): void {
    const target = e.native.target as { setPointerCapture?: (id: number) => void } | null;
    if (e.pointerId === undefined || typeof target?.setPointerCapture !== "function") return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (a synthetic or finished event).
    }
  }

  /** Forgets the pointer's buttons and every touch without raising releases. */
  function forgetPointer(): void {
    buttonsHeld = 0;
    controlTouches.clear();
    pointerTouch = null;
  }

  function handleKeyDown(e: KeyEvent): void {
    const codes = codesOf(e);
    if (e.native.repeat) return repeatKeys(codes);
    for (const code of codes) keysDown.add(code);
    // A bound key doesn't also scroll the page (arrows, space).
    if (press(codes, true, e.native.timeStamp)) e.native.preventDefault();
  }

  function handleKeyUp(e: KeyEvent): void {
    const codes = codesOf(e);
    for (const code of codes) keysDown.delete(code);
    press(codes, false, e.native.timeStamp);
  }

  const play: ToolConsumer = {
    id: "play",
    priority: TOOL_PRIORITY.play,
    accepts(e: ToolEvent) {
      if (e.kind === "pointer") {
        if (e.type === "wheel") return false;
        return e.type !== "down" || enabled;
      }
      if (e.type === "up") return true;
      return enabled && !e.outsideTarget && !isForeignKey(e.native);
    },
    handle(e: ToolEvent) {
      if (e.kind === "pointer") {
        if (e.pointerType === "touch") handleTouch(e);
        else handleMouse(e);
      } else if (e.type === "down") {
        handleKeyDown(e);
      } else {
        handleKeyUp(e);
      }
    },
  };

  function attach(target: HTMLElement | Window): void {
    detach();
    ownRouter = createToolRouter();
    ownRouter.register(play);
    ownRouter.attach(target);
  }

  function detach(): void {
    ownRouter?.destroy();
    ownRouter = null;
  }

  function releaseAll(timestamp = 0): void {
    press([...keysDown], false, timestamp);
    keysDown.clear();
    setButtons(BUTTON_BITS, false, timestamp);
    for (const [id, control] of controlTouches)
      controls?.drive?.(control, { phase: "end", screen: { ...mousePosition }, id });
    forgetPointer();
    for (const slot of slots.values()) {
      if (slot.tick.readings.size === 0 && slot.live.readings.size === 0) continue;
      slot.tick.readings.clear();
      slot.live.readings.clear();
      settle(slot, timestamp);
    }
  }

  function flush(): void {
    actionQueue.length = 0;
    keysDown.clear();
    slots.clear();
    forgetPointer();
  }

  function poll(tick: number): InputAction[] {
    const actions = actionQueue.splice(0);
    for (const action of actions) action.tick = tick;
    return actions;
  }

  function onAction(
    fn: (e: UiActionEvent) => void,
    o?: { actions?: readonly string[] },
  ): () => void {
    const listener: Listener = { fn, actions: o?.actions ? new Set(o.actions) : null };
    listeners.push(listener);
    return () => {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    };
  }

  function destroy(): void {
    detach();
    listeners.length = 0;
    actionQueue.length = 0;
    keysDown.clear();
    slots.clear();
    forgetPointer();
    controls = null;
  }

  return {
    attach,
    detach,
    poll,
    onAction,
    listening: () => listeners.length > 0,
    getMousePosition: () => ({ ...mousePosition }),
    hasPointer: () => pointerSeen,
    getPointer: () => ({ ...mousePosition, buttons: buttonsHeld, over: pointerOver }),
    setTouchControls: (target) => {
      controls = target;
      controlTouches.clear();
    },
    setPads,
    setFramePads,
    setControl,
    setEnabled: (next) => void (enabled = next),
    isKeyDown: (code) => keysDown.has(code),
    releaseAll,
    flush,
    consumer: () => play,
    destroy,
  };
}
