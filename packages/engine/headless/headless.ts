import type { LibraryScene, SceneLibrary } from "../game/flow";
import type { GameCommand, GameDefinition, GameOutcome, PlayState, Registry } from "../game/types";
import { applyFlowRequest } from "../runtime/flow";
import { createLiveLayer, preparedVersion, type LiveLayer } from "../runtime/live";
import { playWorld } from "../runtime/play-session";
import { inputAction, probeConfigHash } from "../runtime/recorder";
import { createSceneRuntime, resolveGame, type ProjectOption } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type {
  RuntimeRequests,
  SceneRuntimeHandle,
  SceneRuntimeOptions,
  StepEvent,
  StepResult,
} from "../runtime/types";
import { closest } from "../scene/did-you-mean";
import { uiActionScriptProblem } from "../scene/input-script";
import { liveIssue } from "../scene/issues";
import type { PrefabLibrary } from "../scene/types";
import type { InputAction } from "../types";
import { legalCommands, startState } from "./legal";
import { listedSceneId, loadAs, runBlocked, runLibrary } from "./play-loop";
import type { PlaytestBlocked } from "./playtest-types";
import type {
  HeadlessLive,
  HeadlessRuntime,
  HeadlessRuntimeOptions,
  ProbeOptions,
  ProbeReport,
} from "./types";

export { inputAction, probeConfigHash };

const DEFAULT_MAX_EVENTS = 1000;

/**
 * The prefabs the game's `ctx.instantiate` places, and the persistent value
 * to share with other runtimes, as the scene runtime takes them.
 */
type RuntimeShareOptions = Pick<SceneRuntimeOptions, "prefabs" | "persist">;

/**
 * A runtime with no view: nothing is drawn and nothing touches the DOM. Its
 * persistent value lasts as long as it does, across every `load`, unless
 * `persist` hands it one that outlives it. With `flow`, a flow request is
 * applied after the `step` that made it, with no transition and no wall
 * time (`applyFlowRequest`; a refused one throws), and `scene` loads as the
 * library's id for it, while save requests still wait in `takeRequests` for
 * the caller (taken after the scene changed, so a save of one made in the
 * tick that left a scene holds the next); without, every request waits there.
 * With `fromSave` it starts where the save left off (`restoreSave`): its
 * scene from `flow`, else `scene`, which must be the save's; a save that
 * can't be restored throws. `save` captures it as `captureSave` does.
 * `live` stages versions and swaps them in after the step their timing
 * waits for (after its flow request), and a flow load of a scene uses the
 * version active for it.
 */
export function createHeadlessRuntime(
  opts: HeadlessRuntimeOptions & ProjectOption & RuntimeShareOptions,
): HeadlessRuntime & {
  save: NonNullable<HeadlessRuntime["save"]>;
  live: HeadlessLive;
} {
  const library = opts.flow ?? null;
  const { registry, game } = resolveGame(opts);
  let current: SceneRuntimeHandle | null = null;
  const layer = createLiveLayer({
    game,
    registry,
    runtime: () => current,
    release: (id) => library?.scenes.get(id) ?? null,
  });
  const runtime: SceneRuntimeHandle = createSceneRuntime({
    rapier: opts.rapier ?? null,
    view: null,
    game,
    registry,
    dev: opts.dev,
    project: opts.project,
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
    ...(opts.persist ? { persist: opts.persist } : {}),
    ...(library ? { scenes: () => liveLibrary(library, layer) } : {}),
    ...(opts.timing ? { timing: opts.timing } : {}),
    live: layer.hooks,
  });
  current = runtime;
  const handle = Object.assign(runtime, {
    save: (saveOpts: Parameters<NonNullable<HeadlessRuntime["save"]>>[0]) =>
      captureSave(runtime, saveOpts),
    live: headlessLive(runtime, layer, { registry, game, library }),
  });
  if (opts.scene) {
    const id = library ? listedSceneId(library, opts.scene) : null;
    const report = loadAs(
      handle,
      opts.scene,
      undefined,
      library && id !== null ? { scene: id, entry: null, library } : undefined,
    );
    if (!report.ok) {
      runtime.destroy();
      const where = report.entityId ? ` (${report.entityId})` : "";
      throw new Error(`scene failed to load${where}: ${report.error}`);
    }
  }
  if (opts.fromSave) {
    const restored = restoreSave(handle, opts.fromSave);
    if (!restored.ok) {
      runtime.destroy();
      throw new Error(`the save can't be restored: ${restored.issue.message}`);
    }
  }
  const step = runtime.step;
  if (library) {
    const take = runtime.takeRequests;
    const saves: RuntimeRequests["saves"] = [];
    runtime.step = (dtMs, input, commands) => {
      const result = step(dtMs, input, commands);
      const requests = take();
      saves.push(...requests.saves);
      if (requests.flow) {
        const applied = applyFlowRequest(runtime, requests.flow);
        if (!applied.ok) throw new Error(`flow request refused: ${applied.issue.message}`);
      }
      layer.afterTick({ paused: false, changing: false });
      return result;
    };
    runtime.takeRequests = () => {
      const pending = take();
      saves.push(...pending.saves);
      return { flow: pending.flow, saves: saves.splice(0) };
    };
  } else {
    runtime.step = (dtMs, input, commands) => {
      const result = step(dtMs, input, commands);
      layer.afterTick({ paused: false, changing: false });
      return result;
    };
  }
  return handle;
}

/** `base` with each listed scene's active live version in place of its own definition. */
function liveLibrary(base: SceneLibrary, layer: Pick<LiveLayer, "sceneFor">): SceneLibrary {
  let scenes: Map<string, LibraryScene> | null = null;
  for (const { scene } of base.list) {
    const active = layer.sceneFor(scene);
    if (!active) continue;
    scenes ??= new Map(base.scenes);
    scenes.set(scene, { def: active.def, prefabs: active.prefabs });
  }
  return scenes ? { list: base.list, scenes } : base;
}

/** `GameInstance.live`'s members over a headless runtime's layer: staging reads the version and keeps it, with nothing to preload. */
function headlessLive(
  runtime: SceneRuntimeHandle,
  layer: LiveLayer,
  run: { registry: Registry; game: GameDefinition | null; library: SceneLibrary | null },
): HeadlessLive {
  const { registry, game, library } = run;
  return {
    stage(v) {
      const scene = v.version.scene;
      const refused = (cause: string) => ({
        ok: false as const,
        issue: liveIssue({ code: "live-swap-failed", scene, cause, phase: "stage" }),
      });
      if (library && !library.list.some((e) => e.scene === scene))
        return refused(`${scene} isn't in the game's scene list`);
      const read = preparedVersion(v, registry, game, runtime.ctx.project?.engine);
      if (!read.ok) {
        const cause = read.issues.find((i) => i.severity === "error") ?? read.issues[0];
        return cause ? { ok: false, issue: cause } : refused("it didn't read");
      }
      return layer.stage(read.prepared);
    },
    activate: (scene, version, timing) => layer.activate(scene, version, timing),
    current: (scene) => layer.current(scene),
    pending: () => layer.pending(),
    pin: (versions) => layer.pin(versions),
    unpin: () => layer.unpin(),
  };
}

/** The probe's error for an action name the game doesn't declare, or null. */
export function unknownActionError(action: string, actionNames: readonly string[]): string | null {
  if (actionNames.includes(action)) return null;
  const guess = closest(action, actionNames);
  const known = actionNames.length > 0 ? actionNames.join(", ") : "none";
  return `unknown action ${JSON.stringify(action)}${guess ? `; did you mean "${guess}"?` : ""} (actions: ${known})`;
}

/**
 * The error for an action that scripted input can't drive, or null: one the
 * game doesn't declare (`unknownActionError`), or a UI-only one
 * (`uiActionScriptProblem`, `binding-unknown`). The one check every headless
 * input path (probe, step, fuzz macro, input script) applies.
 */
export function simActionError(registry: Registry, action: string): string | null {
  const unknown = unknownActionError(action, registry.actionNames);
  if (unknown) return unknown;
  const ui = uiActionScriptProblem(registry, action);
  return ui ? `${ui.message}; ${ui.hint}` : null;
}

/** The prefabs a probe's `ctx.instantiate` places: `library` when given, else `prefabs`. */
type LibraryOption = {
  prefabs?: PrefabLibrary;
  /** Every prefab the game's `ctx.instantiate` may place; default `prefabs`. */
  library?: PrefabLibrary;
};

/**
 * Load `scene`, play scripted input for `ticks` ticks on the runtime's clock,
 * and report what happened. Every tick is simulated whatever the time model,
 * as the shell's `step(n)` does. An `EngineError` out of a step ends the run
 * as `runPlaytest`'s does: `blocked` at stage `run` with the error's code,
 * the report covering the ticks before it. A game that lists its commands
 * gets `legal` after the last tick, else at the start (`legalCommands`), as
 * `runPlaytest` does; a blocked run has none. A UI-only action in `hold` or
 * `inputs` is refused (`simActionError`).
 */
export function runProbe<S = unknown>(opts: ProbeOptions<S> & LibraryOption): ProbeReport<S> {
  const { registry, game } = resolveGame(opts);
  for (const action of [...(opts.hold ?? []), ...(opts.inputs ?? []).map((e) => e[1])]) {
    const error = simActionError(registry, action);
    if (error) throw new Error(error);
  }
  const runtime = createSceneRuntime({
    rapier: opts.rapier ?? null,
    view: null,
    game,
    registry,
    project: opts.project,
    prefabs: runLibrary(opts),
    ...(opts.timing ? { timing: opts.timing } : {}),
  });
  try {
    const load = runtime.load(opts.scene);
    const events: StepEvent[] = [];
    let ticks = 0;
    let outcome: (GameOutcome & { tick: number }) | undefined;
    let blocked: PlaytestBlocked | undefined;
    let last: PlayState | undefined;
    const play = game?.play;
    const time = runtime.ctx.time;
    const world = playWorld(runtime.ctx);

    if (load.ok) {
      const byTick = new Map<number, InputAction[]>();
      for (const [tick, action, pressed] of opts.inputs ?? []) {
        const list = byTick.get(tick) ?? [];
        list.push(inputAction(action, pressed === 1, tick, time));
        byTick.set(tick, list);
      }
      const commandsAt = new Map<number, GameCommand[]>();
      for (const [tick, command] of opts.commands ?? []) {
        const list = commandsAt.get(tick) ?? [];
        list.push(command);
        commandsAt.set(tick, list);
      }

      for (let tick = 0; tick < opts.ticks; tick++) {
        const actions =
          tick === 0 ? (opts.hold ?? []).map((a) => inputAction(a, true, 0, time)) : [];
        actions.push(...(byTick.get(tick) ?? []));
        let result: StepResult;
        try {
          result = runtime.step(time.tickMs, actions, commandsAt.get(tick));
        } catch (err) {
          blocked = runBlocked(err, opts.scene.name, [], registry) ?? undefined;
          if (blocked) break;
          throw err;
        }
        events.push(...result.events);
        ticks++;
        last = {
          tick,
          snapshot: result.game,
          events: result.events,
          world,
          persist: runtime.ctx.persist.value,
        };
        if (play?.outcome && !outcome) {
          const verdict = play.outcome(last as PlayState<S>);
          if (verdict) outcome = { ...verdict, tick };
        }
      }
    }

    const final = runtime.snapshot() as S | null;
    const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
    const legal = load.ok && !blocked ? legalCommands(play, last ?? startState(runtime)) : null;
    const report: ProbeReport<S> = {
      configHash: probeConfigHash(game, time),
      tickRate: time.rate,
      ticks,
      load,
      events: events.slice(0, maxEvents),
      truncated: events.length > maxEvents,
      final,
      ...legal,
      stats: runtime.stats(),
    };
    if (outcome) report.outcome = outcome;
    if (blocked) report.blocked = blocked;
    return report;
  } finally {
    runtime.destroy();
  }
}
