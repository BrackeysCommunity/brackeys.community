/**
 * The run loop `runPlaytest` and `fuzz` share: a play world started the way
 * the editor's Play starts one, stepped on the runtime's clock from a source
 * of held actions, ended by the game's outcome, `stuck`, `script-end` or
 * `timeout`. The input's slots stand in for wall time: a turns or event game
 * that nothing wakes skips the slot.
 */

import type { FlowRequest, LibraryScene, SceneLibrary } from "../game/flow";
import type { SaveFile } from "../game/save-file";
import type { ResolvedTime } from "../game/time";
import {
  EngineError,
  type GameCommand,
  type GameDefinition,
  type PlayerInfo,
  type PlayState,
  type Registry,
  type RunResult,
} from "../game/types";
import { qAxis, qPointer, qVector } from "../input/quantize";
import type { PointerState } from "../input/state";
import { mergeTick, qOffset, type SeatChange, type TickInput } from "../input/stream";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, Sha256 } from "../project/types";
import { flowLoaderOf, type FlowIdentity } from "../runtime/flow";
import {
  createLiveLayer,
  liveLibrary,
  type LiveLayer,
  type PreparedVersion,
} from "../runtime/live";
import { playWorld, preparePlay } from "../runtime/play-session";
import type { PresentRequest } from "../runtime/present";
import { inputAction } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import { restoreSave } from "../runtime/save-state";
import type { RunTiming } from "../runtime/timing";
import type { LoadReport, PersistCell, SceneRuntimeHandle } from "../runtime/types";
import { makeIssue } from "../scene/issues";
import type {
  ExpandedScene,
  IssueCode,
  PrefabLibrary,
  SceneDefinition,
  SceneIssue,
} from "../scene/types";
import type { InputAction, RapierModule, Vec2 } from "../types";
import { heldEdges } from "./compile-input-script";
import type { InputEdge, PlaytestBlocked, PlayOptions, ScriptIssue } from "./playtest-types";

/** Holding a movement action with the focus moving under `STUCK_METRES` over `STUCK_TICKS` ticks is `stuck`. */
export const STUCK_TICKS = 120;
export const STUCK_METRES = 0.04;

export function blockedRun(
  stage: PlaytestBlocked["stage"],
  scene: string,
  issues: SceneIssue[],
  scriptIssues: ScriptIssue[] = [],
  load?: LoadReport,
): PlaytestBlocked {
  const out: PlaytestBlocked = { blocked: true, stage, scene, issues, scriptIssues };
  if (load) out.load = load;
  return out;
}

/**
 * A run that an `EngineError` thrown out of a step ended: blocked at `run`,
 * with the scene's issues and the error as an issue carrying its code. Null
 * for any other error, which the caller rethrows.
 */
export function runBlocked(
  err: unknown,
  scene: string,
  issues: SceneIssue[],
  registry: Registry,
): PlaytestBlocked | null {
  if (!(err instanceof EngineError)) return null;
  const code = err.code as IssueCode;
  const fields = { message: err.message, entityIds: err.entityId ? [err.entityId] : [] };
  const issue: SceneIssue = registry.issueCodes[code]
    ? makeIssue(code, fields, registry.issueCodes)
    : { severity: "error", code, ...fields };
  return blockedRun("run", scene, [...issues, issue]);
}

export type PreparedRun =
  | { ok: true; scene: ExpandedScene; hash: string; runHash: string; issues: SceneIssue[] }
  | { ok: false; blocked: PlaytestBlocked };

/**
 * Play's first half (parse, validate, clone, freeze in dev, expand, hash);
 * errors block. `engine` is the project's `engine` block, which settings
 * resolve through; `run` names the project view and the prefab library the
 * run plays with, which `runHash` covers (its view's `engine` wins).
 */
export function prepareRun(
  doc: SceneDefinition,
  registry: Registry,
  dev = false,
  prefabs?: PrefabLibrary,
  engine?: Readonly<Record<string, unknown>>,
  run: { project?: ProjectRuntimeView | null; library?: PrefabLibrary } = {},
): PreparedRun {
  const prepared = preparePlay(doc, registry, {
    dev,
    prefabs,
    engine,
    project: run.project,
    library: run.library,
  });
  if (!prepared.ok) return { ok: false, blocked: blockedRun("scene", doc.name, prepared.issues) };
  return {
    ok: true,
    scene: prepared.scene,
    hash: prepared.hash,
    runHash: prepared.runHash,
    issues: prepared.issues,
  };
}

/**
 * The prefabs a run's `ctx.instantiate` places: `library` when given (a
 * loader's whole library), else `prefabs`. Hashing and validation read only
 * the prefabs the scene's instances name, so either may hold more, and a
 * prefab only `ctx.instantiate` places is outside the scene and config
 * hashes: a change to it shows on replay as a digest mismatch.
 */
export function runLibrary(opts: {
  prefabs?: PrefabLibrary;
  library?: PrefabLibrary;
}): PrefabLibrary | undefined {
  return opts.library ?? opts.prefabs;
}

export type StartOptions = {
  /** Needed only for a scene whose physics resolves to Rapier. */
  rapier?: RapierModule | null;
  game: GameDefinition | null;
  registry: Registry;
  scene: ExpandedScene;
  play: PlayOptions;
  dev?: boolean;
  /** The project's data the game reads as `EngineContext.project`; its `engine` block sets the clock. */
  project?: ProjectRuntimeView | null;
  /** Keep presentation requests in each `StepResult.present`; default false. */
  recordPresentation?: boolean;
  /** What `ctx.instantiate` places. */
  prefabs?: PrefabLibrary;
  /** The session's persistent value; default one of the run's own. */
  persist?: PersistCell;
  /** Which listed scene this is (`ctx.flow.scene`, `ctx.flow.entry`) and the library its run keeps. */
  flow?: FlowIdentity;
  /** Start where this save left off (`restoreSave`) instead of at the scene's fresh load. */
  fromSave?: SaveFile;
  /** Times each step's parts into this collector. */
  timing?: RunTiming;
  /** The live version `scene` was read from, active before the load so `ctx.live.version` names it. */
  version?: PreparedVersion;
  /** The release's own definition of a scene, which a swap back to it applies; default the flow library's. */
  release?: (id: AssetId) => LibraryScene | null;
  /**
   * Before the load, with the run's live layer: a replay activates the
   * versions the recorded load's sublevels used. An issue returned refuses
   * the load.
   */
  beforeLoad?(live: LiveLayer): SceneIssue | null;
};

/**
 * A save a run starts from, with the hash of the fixture's bytes, which
 * its recording names (`fromSave`) so a replay can find the same fixture.
 */
export type SaveStart = { file: SaveFile; sha256: Sha256 };

/**
 * Loads `scene` as the listed scene `flow` names, so the game reads its id
 * and entry from `ctx.flow`; without `flow`, a plain load.
 */
export function loadAs(
  runtime: SceneRuntimeHandle,
  scene: ExpandedScene,
  play: PlayOptions | undefined,
  flow: FlowIdentity | undefined,
): LoadReport {
  const loader = flow ? flowLoaderOf(runtime.ctx) : undefined;
  return loader ? loader.load(scene, play, flow!) : runtime.load(scene, play);
}

/**
 * A fresh headless play world for one run, with its live layer; the caller
 * destroys the runtime. With `fromSave` the save is restored over the load
 * (what the restore noted, such as a scene changed since the save, in
 * `issues`), and a save that can't be is a failed load carrying the refusal
 * as `issue`. With `version`, that version is the one the scene runs; each
 * listed scene loads and attaches its active version, as the shell's do.
 */
export function startRun(
  opts: StartOptions,
):
  | { ok: true; runtime: SceneRuntimeHandle; live: LiveLayer; issues?: SceneIssue[] }
  | { ok: false; load: LoadReport; issue?: SceneIssue } {
  let created: SceneRuntimeHandle | null = null;
  const library = opts.flow?.library;
  const live = createLiveLayer({
    game: opts.game,
    registry: opts.registry,
    runtime: () => created,
    release: opts.release ?? ((id) => library?.scenes.get(id) ?? null),
  });
  if (opts.version) {
    live.stage(opts.version);
    live.activate(opts.version.version.scene, opts.version.id, "next-load");
  }
  const refused = opts.beforeLoad?.(live) ?? null;
  if (refused) return { ok: false, load: { ok: false, error: refused.message }, issue: refused };
  const flow = opts.flow && { ...opts.flow, library: liveLibrary(opts.flow.library, live) };
  const runtime = createSceneRuntime({
    rapier: opts.rapier,
    view: null,
    game: opts.game,
    registry: opts.registry,
    dev: opts.dev,
    project: opts.project,
    ...(opts.recordPresentation ? { recordPresentation: true } : {}),
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
    ...(opts.persist ? { persist: opts.persist } : {}),
    ...(library ? { scenes: () => liveLibrary(library, live) } : {}),
    ...(opts.timing ? { timing: opts.timing } : {}),
    live: live.hooks,
  });
  created = runtime;
  const load = loadAs(runtime, opts.scene, opts.play, flow);
  if (!load.ok) {
    runtime.destroy();
    return { ok: false, load };
  }
  if (!opts.fromSave) return { ok: true, runtime, live };
  const restored = restoreSave(runtime, opts.fromSave);
  if (restored.ok) return { ok: true, runtime, live, issues: restored.issues };
  runtime.destroy();
  const { issue } = restored;
  const entityId = issue.entityIds[0];
  return {
    ok: false,
    load: {
      ok: false,
      error: `the save can't be restored: ${issue.message}`,
      ...(entityId !== undefined ? { entityId } : {}),
    },
    issue,
  };
}

/**
 * The listed id of `def` in `library`: the entry holding that very
 * definition, else one whose scene has its name, else its name when that is
 * a listed id; null when the library doesn't hold it.
 */
export function listedSceneId(
  library: SceneLibrary,
  def: Pick<SceneDefinition, "name">,
): AssetId | null {
  for (const [id, s] of library.scenes) if (s.def === def) return id;
  for (const [id, s] of library.scenes) if (s.def.name === def.name) return id;
  return library.list.some((e) => e.scene === def.name) ? def.name : null;
}

/**
 * What a later scene of a run starts with: the play options that aren't
 * about where the first scene began (`at`, `timeOffsetMs`), so the seed
 * and the game's options carry on.
 */
export function nextScenePlay(play: PlayOptions): PlayOptions {
  const next: PlayOptions = {};
  if (play.seed !== undefined) next.seed = play.seed;
  if (play.game !== undefined) next.game = play.game;
  return next;
}

/**
 * What a run plays, one slot at a time: a `TickInput` per slot, the actions
 * held, or the exact edges a recording stepped. A fixed game simulates every
 * slot; a turns or event game only the slots something wakes, so slot and
 * tick numbers can differ.
 */
export type InputSource = {
  /** True when the input has run out; the run ends as `script-end`. */
  done(): boolean;
  /** The slot's whole input (actions of every seat, pointers, seat changes, commands), instead of `held` or `edges`. */
  tick?(slot: number): TickInput;
  /** Every action held during `slot`; called once per slot, in order. */
  held?(slot: number): readonly string[];
  /** The edges to play in `slot`, in order, instead of `held`'s difference from the slot before. */
  edges?(slot: number): readonly InputEdge[];
  /** The commands to step on `slot`, in order, beside `held` or `edges`. A command wakes every model. */
  commands?(slot: number): readonly GameCommand[];
  /** After each simulated tick, with what it produced. */
  after?(state: PlayState): void;
  /** After a slot the clock skipped: nothing woke an idle turns or event game. */
  skipped?(slot: number): void;
};

export type RunEnd = {
  result: RunResult;
  /** The last tick simulated. */
  tick: number;
  /** Ticks simulated. */
  ticks: number;
  /** Input slots consumed, skipped ones included; equal to `ticks` for a fixed game. */
  slots: number;
  cause?: string;
  entityId?: string;
  /** With `result: "flow"`: the request game code made on the last tick. */
  request?: FlowRequest;
};

/**
 * What a run does between ticks for live versions: the one hook replays and
 * the swap check share. A `LiveLayer` is one.
 */
export type RunLoopLive = {
  /**
   * Before each simulated tick, with `ctx.tick` the tick about to step: a
   * replay applies the swaps recorded for it. A returned cause ends the run
   * there as `script-end`.
   */
  beforeTick?(): string | null | void;
  /** After each simulated tick the run goes on from on its scene, so a waiting swap may apply. */
  afterTick?(state: { paused: boolean; changing: boolean }): void;
};

export type RunLoopOptions = {
  runtime: SceneRuntimeHandle;
  game: GameDefinition | null;
  /** Simulated ticks before `timeout`. */
  maxTicks: number;
  /** Slots before `timeout`, simulated or skipped; default unbounded. */
  maxSlots?: number;
  input: InputSource;
  /** Every seat-0 button edge played is appended here, stamped with the tick that stepped it. */
  record?: InputEdge[];
  /** False skips `stuck`, for replaying a run that ended some other way. Default true. */
  stuck?: boolean;
  /** Simulate every slot whatever the time model, as a replay of recorded ticks does. */
  everySlot?: boolean;
  /**
   * Input standing from the scene before (`standingInput`), played with the
   * first simulated tick, before that slot's own.
   */
  carry?: TickInput | null;
  /** The run's live layer: swaps between ticks. */
  live?: RunLoopLive;
  /**
   * After each tick, before the run decides whether it is over: its state,
   * the focus, its seat-0 button edges and commands, the whole input it
   * stepped, and its presentation requests when the runtime records them.
   */
  onTick?(
    state: PlayState,
    focus: Vec2 | null,
    edges: readonly InputEdge[],
    commands: readonly GameCommand[],
    input: TickInput,
    present: readonly PresentRequest[] | undefined,
  ): void;
};

/**
 * Whether a slot's input wakes an idle game on `time`'s clock, by the rule
 * the shell's gate uses: a command wakes every model; an event game also
 * wakes on any action (a button edge or an analog change), a pointer whose
 * buttons differ from `pointers`' last (the pointer each seat last had),
 * and a pointer move only with `wakeOnPointerMove`. Seat changes wake
 * nothing; they ride the next simulated tick. A fixed clock never idles.
 */
export function tickWakes(
  time: Pick<ResolvedTime, "kind" | "wakeOnPointerMove">,
  input: Pick<TickInput, "actions" | "commands" | "pointers">,
  pointers: readonly (PointerState | null | undefined)[] = [],
): boolean {
  if (time.kind === "fixed" || input.commands.length > 0) return true;
  if (time.kind !== "event") return false;
  if (input.actions.length > 0) return true;
  return input.pointers.some((p, seat) => {
    if (!p) return false;
    const was = pointers[seat];
    if (p.buttons !== (was?.buttons ?? 0)) return true;
    return time.wakeOnPointerMove === true && (!was || was.x !== p.x || was.y !== p.y);
  });
}

/** `tickWakes` for 0.x's edges and commands: a seat-0 tick with no pointer. */
export function slotWakes(
  time: Pick<ResolvedTime, "kind">,
  edges: readonly InputEdge[],
  commands: readonly GameCommand[],
): boolean {
  if (time.kind === "fixed" || commands.length > 0) return true;
  return time.kind === "event" && edges.length > 0;
}

/** Tracks the focus while a movement action is held; true once it has moved under `STUCK_METRES` in `STUCK_TICKS` ticks. */
export function stuckDetector(): (moving: boolean, focus: Vec2 | null) => boolean {
  const window = STUCK_TICKS + 1;
  const xs = new Float64Array(window);
  const ys = new Float64Array(window);
  let streak = 0;
  return (moving, focus) => {
    if (!moving || !focus) {
      streak = 0;
      return false;
    }
    xs[streak % window] = focus.x;
    ys[streak % window] = focus.y;
    streak++;
    if (streak < window) return false;
    const then = streak % window;
    const dx = focus.x - xs[then]!;
    const dy = focus.y - ys[then]!;
    return Math.sqrt(dx * dx + dy * dy) < STUCK_METRES;
  };
}

/** A seat-0 action with no analog value: a button edge as 0.x's reports list it. */
const isSeat0Button = (a: InputAction): boolean =>
  (a.player ?? 0) === 0 && a.value === undefined && a.x === undefined && a.y === undefined;

/** The slot's input from whichever form the source gives, actions not yet stamped. */
function slotInput(
  input: InputSource,
  slot: number,
  held: readonly string[],
  time: ResolvedTime,
): { tick: TickInput; held: readonly string[] | null } {
  if (input.tick) return { tick: input.tick(slot), held: null };
  let edges: readonly InputEdge[];
  let next: readonly string[];
  if (input.edges) {
    edges = input.edges(slot);
    next = held;
  } else {
    next = input.held?.(slot) ?? [];
    edges = heldEdges(held, next, slot);
  }
  const actions = edges.map(([, action, pressed]) =>
    inputAction(action, pressed === 1, slot, time),
  );
  return {
    tick: {
      tick: slot,
      actions,
      commands: [...(input.commands?.(slot) ?? [])],
      pointers: [],
      joins: [],
    },
    held: input.edges ? null : next,
  };
}

/** `held` after the seat-0 actions of a step: one going down or non-zero adds it, one going up removes it. */
function applyActions(held: readonly string[], actions: readonly InputAction[]): string[] {
  const next = [...held];
  for (const a of actions) {
    if ((a.player ?? 0) !== 0) continue;
    const at = next.indexOf(a.action);
    if (a.pressed && at < 0) next.push(a.action);
    else if (!a.pressed && at >= 0) next.splice(at, 1);
  }
  return next;
}

/**
 * Steps `runtime` until the game's outcome, a flow request (`flow`, the
 * request on `RunEnd.request`; a tick whose outcome ends the run ends it
 * even with a request pending), `stuck`, the input running out, `maxTicks`
 * simulated ticks or `maxSlots` slots. A turns or event game
 * skips a slot nothing wakes (`tickWakes`) while it isn't busy; that slot's
 * actions and seat changes are played, in order, with the next simulated
 * tick, and its pointer stands until a later one replaces it. Each tick's
 * input is merged (system first, then seats in order) and its actions
 * stamped with the tick, as a replay of it is. `live` runs before each
 * simulated tick and after each one that neither ends the run nor requests
 * a scene, so a swap lands between ticks as the shell's does.
 */
export function runLoop(opts: RunLoopOptions): RunEnd {
  const { runtime, input, maxTicks } = opts;
  const maxSlots = opts.maxSlots ?? Infinity;
  const time = runtime.ctx.time;
  const play = opts.game?.play;
  const movement = play?.focus ? (play.movementActions ?? []) : [];
  const stuck = movement.length > 0 && opts.stuck !== false ? stuckDetector() : null;
  const subTick = opts.game?.input?.subTick === true;
  let carried: TickInput | null = opts.carry ?? null;
  let held: readonly string[] = carried ? applyActions([], carried.actions) : [];
  // A restored runtime already holds each seat's pointer: a slot repeating it wakes nothing.
  const sent: (PointerState | undefined)[] = [];
  for (const { index } of runtime.ctx.input.players())
    sent[index] = runtime.ctx.input.pointer(index) ?? undefined;
  let tick = 0;
  const world = playWorld(runtime.ctx);

  for (let slot = 0; ; slot++) {
    const last = { tick: tick - 1, ticks: tick, slots: slot };
    if (input.done()) return { result: "script-end", ...last };
    if (tick >= maxTicks || slot >= maxSlots) return { result: "timeout", ...last };

    const read = slotInput(input, slot, held, time);
    const slotTick = read.tick;
    if (read.held) held = read.held;
    if (!opts.everySlot && !tickWakes(time, slotTick, sent) && !runtime.busy()) {
      carried = carried ? joinTicks(carried, slotTick) : slotTick;
      input.skipped?.(slot);
      continue;
    }

    const merged = mergeTick(
      stamped(carried ? joinTicks(carried, slotTick) : slotTick, tick, time, subTick),
    );
    carried = null;
    merged.pointers.forEach((p, seat) => {
      if (p) sent[seat] = p;
    });
    if (!read.held) held = applyActions(held, merged.actions);
    const stopped = opts.live?.beforeTick?.();
    if (stopped) return { result: "script-end", ...last, cause: stopped };
    const edges: InputEdge[] = merged.actions
      .filter(isSeat0Button)
      .map((a) => [tick, a.action, a.pressed ? 1 : 0]);
    opts.record?.push(...edges);
    const result = runtime.step(time.tickMs, merged);

    const state: PlayState = {
      tick,
      snapshot: result.game,
      events: result.events,
      world,
      persist: runtime.ctx.persist.value,
    };
    const focus = play?.focus ? play.focus(result.game) : null;
    input.after?.(state);
    opts.onTick?.(state, focus, edges, merged.commands, merged, result.present);

    const ended = { tick, ticks: tick + 1, slots: slot + 1 };
    tick++;
    const verdict = play?.outcome?.(state);
    if (verdict) {
      const out: RunEnd = { result: verdict.result, ...ended };
      if (verdict.cause !== undefined) out.cause = verdict.cause;
      if (verdict.entityId !== undefined) out.entityId = verdict.entityId;
      return out;
    }
    const request = runtime.takeRequests().flow;
    if (request) return { result: "flow", ...ended, cause: `requested "${request.to}"`, request };
    opts.live?.afterTick?.({ paused: false, changing: false });
    if (
      stuck?.(
        held.some((a) => movement.includes(a)),
        focus,
      )
    ) {
      return {
        result: "stuck",
        ...ended,
        cause: `the focus moved under ${STUCK_METRES} m in ${STUCK_TICKS} ticks while holding ${held.filter((a) => movement.includes(a)).join(", ")}`,
      };
    }
  }
}

/** A skipped slot's input followed by the next one's: actions, seat changes and commands in order, the later pointer winning. */
function joinTicks(a: TickInput, b: TickInput): TickInput {
  const pointers: (PointerState | undefined)[] = [];
  for (let seat = 0; seat < Math.max(a.pointers.length, b.pointers.length); seat++) {
    pointers.push(b.pointers[seat] ?? a.pointers[seat]);
  }
  return {
    tick: b.tick,
    actions: [...a.actions, ...b.actions],
    commands: [...a.commands, ...b.commands],
    pointers,
    joins: [...a.joins, ...b.joins],
  };
}

/** An action as the runtime and a replay of it see it: values quantised, the offset kept only with `subTick`. */
function settled(a: InputAction, tick: number, tickMs: number, subTick: boolean): InputAction {
  const offset = subTick ? qOffset(a.offset ?? 0) : undefined;
  const timestamp = (tick + (offset ?? 0)) * tickMs;
  const analog = a.value !== undefined || a.x !== undefined || a.y !== undefined;
  if (!analog && a.tick === tick && a.timestamp === timestamp && a.offset === offset) return a;
  const out: InputAction = { ...a, tick, timestamp };
  if (offset === undefined) delete out.offset;
  else out.offset = offset;
  if (a.value !== undefined) out.value = qAxis(a.value);
  if (a.x !== undefined || a.y !== undefined) {
    const v = qVector({ x: a.x ?? 0, y: a.y ?? 0 });
    out.x = v.x;
    out.y = v.y;
  }
  return out;
}

/**
 * `input` as stepped on `tick`, in the form its replay rebuilds: each action
 * stamped at the tick (plus its offset, with `subTick`) on `time`'s clock,
 * analog values and pointers quantised.
 */
function stamped(
  input: TickInput,
  tick: number,
  time: Pick<ResolvedTime, "tickMs">,
  subTick: boolean,
): TickInput {
  return {
    ...input,
    tick,
    actions: input.actions.map((a) => settled(a, tick, time.tickMs, subTick)),
    pointers: input.pointers.map((p) =>
      p ? { x: qPointer(p.x), y: qPointer(p.y), buttons: p.buttons | 0, over: p.over } : undefined,
    ),
  };
}

/** What `standingInput` tracks; `carry` is what the next scene's fresh runtime must be told. */
export type StandingInput = {
  /** After each simulated tick, with the whole input it stepped. */
  step(input: TickInput): void;
  /**
   * The input still standing, as one tick for a runtime whose seats are
   * `players`: a press for every button held and the last non-zero value
   * of every axis and vector, each seat's last pointer, and the joins and
   * leaves that make its seats match; null when nothing stands.
   */
  carry(players: readonly PlayerInfo[]): TickInput | null;
};

const seatKey = (player: number, device: string) => `${player}\u0000${device}`;

/**
 * Tracks the input a run has standing, from `players` (the seats as the
 * first scene loaded) and every tick stepped since, so a scene change hands
 * a fresh runtime the keys still held, the pointers and the seats. A
 * scene's recording then starts from what its runtime was given and
 * replays alone.
 */
export function standingInput(players: readonly PlayerInfo[]): StandingInput {
  const actions = new Map<string, InputAction>();
  const pointers: (PointerState | undefined)[] = [];
  const seated = new Map<string, SeatChange>();
  for (const p of players)
    for (const device of p.devices)
      seated.set(seatKey(p.index, device), { player: p.index, device, joined: true });

  return {
    step(input) {
      for (const a of input.actions) {
        const key = seatKey(a.player ?? 0, a.action);
        actions.delete(key);
        if (a.pressed) actions.set(key, a);
      }
      input.pointers.forEach((p, seat) => {
        if (p) pointers[seat] = { ...p };
      });
      for (const change of input.joins) {
        const key = seatKey(change.player, change.device);
        if (change.joined) seated.set(key, { ...change });
        else seated.delete(key);
      }
    },
    carry(next) {
      const joins: SeatChange[] = [];
      const there = new Set<string>();
      for (const p of next)
        for (const device of p.devices) {
          const key = seatKey(p.index, device);
          there.add(key);
          if (!seated.has(key)) joins.push({ player: p.index, device, joined: false });
        }
      for (const [key, change] of seated) if (!there.has(key)) joins.push({ ...change });
      joins.sort((a, b) => Number(a.joined) - Number(b.joined));
      const held = [...actions.values()].map((a) => {
        const out: InputAction = { ...a, tick: 0, timestamp: 0 };
        delete out.offset;
        return out;
      });
      const standing = pointers.map((p) => (p ? { ...p } : undefined));
      if (held.length === 0 && joins.length === 0 && !standing.some(Boolean)) return null;
      return { tick: 0, actions: held, commands: [], pointers: standing, joins };
    },
  };
}
