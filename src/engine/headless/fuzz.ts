import { POINTER_BUTTONS, type PointerButton } from "../game/input-codes";
import { isRuntimeId } from "../game/runtime-ids";
import { resolveTime, type ResolvedTime } from "../game/time";
import type { ActionKind, GameDefinition, Macro, MacroRandom } from "../game/types";
import {
  actionValueChanged,
  combineAction,
  resolveBindings,
  type ActionValue,
  type BoundInput,
} from "../input/bindings";
import { qAxis, qPointer, qVector } from "../input/quantize";
import type { PointerState } from "../input/state";
import { inputAction } from "../runtime/recorder";
import { resolveGame } from "../runtime/runtime";
import type { ScriptPointer } from "../scene/input-script";
import type { Bounds, EntityTypeName, Pt, Ref } from "../scene/types";
import { Rng } from "../sim-kit/rng";
import type { InputAction } from "../types";
import { heldEdges } from "./compile-input-script";
import { probeConfigHash, unknownActionError } from "./headless";
import {
  blockedRun,
  prepareRun,
  runBlocked,
  runLibrary,
  runLoop,
  startRun,
  type InputSource,
} from "./play-loop";
import type { FuzzOptions, FuzzRun, FuzzTouch } from "./playtest-types";

const DEFAULT_ROLLOUTS = 100;
const DEFAULT_TICKS = 600;

/** What the default macro may drive beyond buttons: the game's analog actions and its pointer. */
export type FuzzMacroInputs = {
  /** Axis actions it sets to a value in −1…1. */
  axes?: readonly string[];
  /** Vector actions it sets to a point in the unit disc. */
  vectors?: readonly string[];
  /**
   * The pointer buttons an action is bound to, the actions bound to them
   * (clicked with the pointer rather than held), and the area the pointer
   * moves in.
   */
  pointer?: {
    buttons: readonly PointerButton[];
    actions?: readonly string[];
    bounds: Bounds;
  } | null;
};

/** −1…1 in thousandths. */
const unit = (rng: MacroRandom) => rng.range(-1000, 1000) / 1000;

/** A point in `bounds`, to the pointer's step. */
function spot(rng: MacroRandom, [minX, minY, maxX, maxY]: Bounds): Pt {
  const at = (lo: number, hi: number) => qPointer(lo + (rng.below(10_001) / 10_000) * (hi - lo));
  return [at(minX, maxX), at(minY, maxY)];
}

/**
 * The macro fuzz uses when the game has none: one or two distinct button
 * actions held for 4–60 ticks (not the analog or pointer-bound ones
 * `inputs` names). With `inputs`' axis or vector actions, most
 * macros also set one of them to a random value; with pointer buttons, half
 * of them move the pointer to a random point in `bounds`, and half of those
 * click or drag a bound button (pressed on the first tick, released on the
 * last). Without analog actions or pointer buttons it draws exactly as it
 * does with no `inputs`, so a button-only game's rollouts stay the same.
 */
export function defaultFuzzMacro(
  rng: MacroRandom,
  actions: readonly string[],
  inputs: FuzzMacroInputs = {},
): Macro {
  const axes = inputs.axes ?? [];
  const skip = [...axes, ...(inputs.vectors ?? [])];
  const analog = [...skip];
  if (inputs.pointer && inputs.pointer.buttons.length > 0)
    skip.push(...(inputs.pointer.actions ?? []));
  const buttons = skip.length > 0 ? actions.filter((a) => !skip.includes(a)) : actions;
  const hold: string[] = [];
  if (buttons.length > 0) {
    const first = rng.pick(buttons);
    hold.push(first);
    if (buttons.length > 1 && rng.range(1, 2) === 2) {
      hold.push(rng.pick(buttons.filter((a) => a !== first)));
    }
  }
  const macro: Macro = { hold, ticks: rng.range(4, 60) };
  if (analog.length > 0 && rng.below(4) > 0) {
    const name = rng.pick(analog);
    macro.set = { [name]: axes.includes(name) ? unit(rng) : [unit(rng), unit(rng)] };
  }
  const pointer = inputs.pointer;
  if (pointer && pointer.buttons.length > 0 && rng.below(2) === 0) {
    const move: ScriptPointer = { at: spot(rng, pointer.bounds) };
    if (rng.below(2) === 0) {
      const button = rng.pick(pointer.buttons);
      move.press = button;
      move.release = button;
      if (rng.below(2) === 0) move.drag = spot(rng, pointer.bounds);
    }
    macro.pointer = move;
  }
  return macro;
}

const bitOf = (button: PointerButton) => 1 << POINTER_BUTTONS.indexOf(button);

const isPair = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** A macro's `set` value as its action's state, or why it doesn't fit the action. */
function analogValue(kind: ActionKind, v: number | Pt): ActionValue | string {
  if (kind === "axis") {
    if (typeof v !== "number" || !Number.isFinite(v)) return "an axis takes a number in −1…1";
    const value = qAxis(v);
    return { pressed: value !== 0, value };
  }
  if (kind === "vector") {
    if (!isPair(v)) return "a vector takes an [x, y] pair";
    const { x, y } = qVector({ x: v[0], y: v[1] });
    return { pressed: x !== 0 || y !== 0, x, y };
  }
  return "it is a button; hold it instead";
}

const neutral = (kind: ActionKind): ActionValue => combineAction(kind, []);

function actionOf(name: string, state: ActionValue, slot: number, time: ResolvedTime): InputAction {
  const a = inputAction(name, state.pressed, slot, time);
  if (state.value !== undefined) a.value = state.value;
  if (state.x !== undefined) a.x = state.x;
  if (state.y !== undefined) a.y = state.y;
  return a;
}

/** How a macro source reads the game's actions. */
type MacroContext = {
  actions: readonly string[];
  kindOf: (action: string) => ActionKind;
  /** Seat 0's bindings on each pointer button. */
  pointerBindings: (button: PointerButton) => readonly BoundInput[];
  time: ResolvedTime;
};

/** One pointer macro under way: its path, the buttons it presses and releases, and how far along it is. */
type PointerRun = { move: ScriptPointer; ticks: number; at: number };

/**
 * Draws macros back to back for one rollout; it never runs out. Each slot
 * plays the hold edges first (as a button-only rollout always has), then the
 * analog values that changed, then the pointer and the actions bound to the
 * buttons it presses or releases.
 */
function macroInput(
  rng: MacroRandom,
  macro: (rng: MacroRandom, actions: readonly string[]) => Macro,
  ctx: MacroContext,
): InputSource {
  const { actions, kindOf, time } = ctx;
  let hold: readonly string[] = [];
  let left = 0;
  const analog = new Map<string, ActionValue>();
  let pointer: PointerState | null = null;
  let path: PointerRun | null = null;
  const fail = (message: string): never => {
    throw new Error(`fuzz macro: ${message}`);
  };

  function draw(slot: number, out: InputAction[]): void {
    const next = macro(rng, actions);
    if (!Number.isInteger(next.ticks) || next.ticks < 1) {
      throw new RangeError(
        `fuzz macro returned ${next.ticks} ticks; it needs a whole number of at least 1`,
      );
    }
    for (const a of next.hold) {
      const error = unknownActionError(a, actions);
      if (error) fail(error);
    }
    const set = new Map<string, ActionValue>();
    for (const [name, v] of Object.entries(next.set ?? {})) {
      const error = unknownActionError(name, actions);
      if (error) fail(`set: ${error}`);
      const state = analogValue(kindOf(name), v);
      if (typeof state === "string") fail(`set.${name}: ${state}`);
      else set.set(name, state);
    }
    if (next.pointer) {
      const { at, drag, press, release } = next.pointer;
      if (!isPair(at) || (drag !== undefined && !isPair(drag))) {
        fail("pointer.at and pointer.drag take [x, y] pairs");
      }
      for (const b of [press, release]) {
        if (b !== undefined && !POINTER_BUTTONS.includes(b)) {
          fail(`unknown pointer button ${JSON.stringify(b)} (${POINTER_BUTTONS.join(", ")})`);
        }
      }
      if (press !== undefined && press === release && next.ticks < 2) {
        throw new RangeError(
          "a fuzz macro that presses and releases a pointer button needs at least 2 ticks",
        );
      }
    }

    const nextHold = [...new Set(next.hold)];
    for (const [, a, pressed] of heldEdges(hold, nextHold, slot)) {
      out.push(inputAction(a, pressed === 1, slot, time));
    }
    hold = nextHold;
    for (const [name, was] of analog) {
      if (set.has(name)) continue;
      const zero = neutral(kindOf(name));
      if (actionValueChanged(was, zero)) out.push(actionOf(name, zero, slot, time));
      analog.delete(name);
    }
    for (const [name, state] of set) {
      const was = analog.get(name) ?? neutral(kindOf(name));
      if (actionValueChanged(was, state)) out.push(actionOf(name, state, slot, time));
      analog.set(name, state);
    }
    path = next.pointer ? { move: next.pointer, ticks: next.ticks, at: 0 } : null;
    left = next.ticks;
  }

  /** Raises the actions bound to `button`, except those a hold or set already drives. */
  function buttonActions(button: PointerButton, down: boolean, slot: number, out: InputAction[]) {
    const seen = new Set<string>();
    for (const bound of ctx.pointerBindings(button)) {
      if (seen.has(bound.action) || hold.includes(bound.action) || analog.has(bound.action)) {
        continue;
      }
      seen.add(bound.action);
      const state = down
        ? combineAction(bound.kind, [{ binding: bound.binding, reading: 1 }])
        : neutral(bound.kind);
      out.push(actionOf(bound.action, state, slot, time));
    }
  }

  /** The pointer this slot when it changed: along the path, its press on the first tick and its release on the last. */
  function pointerStep(slot: number, out: InputAction[]): PointerState | undefined {
    if (!path) return undefined;
    const { move, ticks } = path;
    const i = path.at++;
    const t = !move.drag ? 0 : ticks === 1 ? 1 : i / (ticks - 1);
    const end = move.drag ?? move.at;
    const x = qPointer(move.at[0] + (end[0] - move.at[0]) * t);
    const y = qPointer(move.at[1] + (end[1] - move.at[1]) * t);
    let buttons = pointer?.buttons ?? 0;
    if (i === 0 && move.press !== undefined && !(buttons & bitOf(move.press))) {
      buttons |= bitOf(move.press);
      buttonActions(move.press, true, slot, out);
    }
    if (i === ticks - 1 && move.release !== undefined && buttons & bitOf(move.release)) {
      buttons &= ~bitOf(move.release);
      buttonActions(move.release, false, slot, out);
    }
    if (i === ticks - 1) path = null;
    if (pointer && pointer.x === x && pointer.y === y && pointer.buttons === buttons) {
      return undefined;
    }
    pointer = { x, y, buttons, over: true };
    return pointer;
  }

  return {
    done: () => false,
    tick(slot) {
      const out: InputAction[] = [];
      if (left === 0) draw(slot, out);
      left--;
      const moved = pointerStep(slot, out);
      return { tick: slot, actions: out, commands: [], pointers: moved ? [moved] : [], joins: [] };
    },
  };
}

const positiveInt = (name: string, v: number) => {
  if (!Number.isInteger(v) || v < 1)
    throw new RangeError(`fuzz ${name} must be a whole number of at least 1, got ${v}`);
  return v;
};

const byRef = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Seeded random rollouts of a scene: each starts the way the editor's Play
 * does and plays macros (the game's `play.macro`, else `defaultFuzzMacro`,
 * which also sets the game's axis and vector actions and moves and clicks
 * the pointer when an action is bound to it; a macro's `set` and `pointer`
 * drive seat 0) drawn from `@jams/engine/sim-kit`'s `Rng`, until the game's outcome,
 * `stuck` or `ticks` slots (an idle turns or event game skips slots, so its
 * rollouts still end). Reports which scene entities the rollouts' events
 * named (never a runtime `#` id), how many rollouts reached each and how
 * early, the ones never touched, and how the rollouts ended. Rollout `i` draws from its own fork of the seed,
 * so the first rollouts of a longer fuzz are the same as a shorter one's.
 */
export function fuzz<S = unknown, G = unknown>(opts: FuzzOptions<S, G>): FuzzRun {
  const { registry, game } = resolveGame({
    game: opts.game as GameDefinition | null | undefined,
    registry: opts.registry,
  });
  const name = opts.scene.name;
  const rollouts = positiveInt("rollouts", opts.rollouts ?? DEFAULT_ROLLOUTS);
  const ticksPerRollout = positiveInt("ticks", opts.ticks ?? DEFAULT_TICKS);

  const prepared = prepareRun(opts.scene, registry, opts.dev, opts.prefabs, opts.project?.engine);
  if (!prepared.ok) return prepared.blocked;
  const types = new Map<Ref, EntityTypeName>(
    prepared.scene.entities.filter((e) => !isRuntimeId(e.id)).map((e) => [e.id, e.type]),
  );

  const root = Rng.from(opts.seed);
  const play = game?.play;
  const bindings = resolveBindings({ game: registry.actions, map: opts.project?.inputMap });
  const pointerBindings = (button: PointerButton) =>
    (bindings.tables.pointer.get(button) ?? []).filter((b) => b.player === 0);
  const actions = registry.actionNames;
  const ofKind = (kind: ActionKind) => actions.filter((a) => bindings.kindOf(a) === kind);
  const pointerButtons = POINTER_BUTTONS.filter((b) => pointerBindings(b).length > 0);
  const inputs: FuzzMacroInputs = {
    axes: ofKind("axis"),
    vectors: ofKind("vector"),
    pointer:
      pointerButtons.length > 0
        ? {
            buttons: pointerButtons,
            actions: [
              ...new Set(pointerButtons.flatMap((b) => pointerBindings(b).map((p) => p.action))),
            ],
            bounds: prepared.scene.bounds,
          }
        : null,
  };
  const macro = play?.macro
    ? (rng: MacroRandom, names: readonly string[]) => play.macro!(rng, names)
    : (rng: MacroRandom, names: readonly string[]) => defaultFuzzMacro(rng, names, inputs);
  const touched = new Map<Ref, Omit<FuzzTouch, "ref" | "type">>();
  const results: Record<string, number> = Object.fromEntries(
    registry.runResults.map((r) => [r, 0]),
  );
  let ticks = 0;
  const startedAt = performance.now();
  let time = resolveTime({ project: opts.project?.engine, game: registry.time });

  for (let rollout = 0; rollout < rollouts; rollout++) {
    const started = startRun({
      rapier: opts.rapier ?? null,
      game,
      registry,
      scene: prepared.scene,
      play: opts.play ?? {},
      dev: opts.dev,
      project: opts.project,
      prefabs: runLibrary(opts),
    });
    if (!started.ok) return blockedRun("load", name, prepared.issues, [], started.load);
    time = started.runtime.ctx.time;
    const seen = new Set<Ref>();
    const touch = (id: string | undefined, tick: number) => {
      if (id === undefined || isRuntimeId(id) || seen.has(id) || !types.has(id)) return;
      seen.add(id);
      const entry = touched.get(id);
      if (!entry) touched.set(id, { reached: 1, firstTick: tick, firstRollout: rollout });
      else {
        entry.reached++;
        if (tick < entry.firstTick) {
          entry.firstTick = tick;
          entry.firstRollout = rollout;
        }
      }
    };
    try {
      const end = runLoop({
        runtime: started.runtime,
        game,
        maxTicks: ticksPerRollout,
        maxSlots: ticksPerRollout,
        input: macroInput(root.fork(`rollout:${rollout}`), macro, {
          actions,
          kindOf: bindings.kindOf,
          pointerBindings,
          time: started.runtime.ctx.time,
        }),
        onTick(state) {
          for (const e of state.events) {
            touch(e.entityId, state.tick);
            touch(e.other, state.tick);
          }
        },
      });
      results[end.result] = (results[end.result] ?? 0) + 1;
      ticks += end.ticks;
    } catch (err) {
      const blocked = runBlocked(err, name, prepared.issues, registry);
      if (blocked) return blocked;
      throw err;
    } finally {
      started.runtime.destroy();
    }
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    blocked: false,
    scene: name,
    sceneHash: prepared.hash,
    configHash: probeConfigHash(game, time),
    seed: opts.seed,
    rollouts,
    ticksPerRollout,
    ticks,
    touched: [...touched]
      .map(([ref, t]) => ({ ref, type: types.get(ref)!, ...t }))
      .sort((a, b) => byRef(a.ref, b.ref)),
    untouched: [...types.keys()].filter((ref) => !touched.has(ref)).sort(byRef),
    results,
    timing: {
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      ticksPerSecond: elapsedMs > 0 ? Math.round((ticks * 1000) / elapsedMs) : 0,
    },
  };
}
