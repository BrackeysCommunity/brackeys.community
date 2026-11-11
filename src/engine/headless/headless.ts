import type { GameCommand, GameOutcome, PlayState } from "../game/types";
import { playWorld } from "../runtime/play-session";
import { inputAction, probeConfigHash } from "../runtime/recorder";
import { createSceneRuntime, resolveGame, type ProjectOption } from "../runtime/runtime";
import type {
  SceneRuntimeHandle,
  SceneRuntimeOptions,
  StepEvent,
  StepResult,
} from "../runtime/types";
import { closest } from "../scene/did-you-mean";
import type { PrefabLibrary } from "../scene/types";
import type { InputAction } from "../types";
import { legalCommands } from "./legal";
import { runBlocked, runLibrary } from "./play-loop";
import type { PlaytestBlocked } from "./playtest-types";
import type { HeadlessRuntimeOptions, ProbeOptions, ProbeReport } from "./types";

export { inputAction, probeConfigHash };

const DEFAULT_MAX_EVENTS = 1000;

/** The prefabs the game's `ctx.instantiate` places, as the scene runtime takes them. */
type PrefabsOption = Pick<SceneRuntimeOptions, "prefabs">;

/** A runtime with no view: nothing is drawn and nothing touches the DOM. */
export function createHeadlessRuntime(
  opts: HeadlessRuntimeOptions & ProjectOption & PrefabsOption,
): SceneRuntimeHandle {
  const runtime = createSceneRuntime({
    rapier: opts.rapier ?? null,
    view: null,
    game: opts.game,
    registry: opts.registry,
    dev: opts.dev,
    project: opts.project,
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
  });
  if (opts.scene) {
    const report = runtime.load(opts.scene);
    if (!report.ok) {
      runtime.destroy();
      const where = report.entityId ? ` (${report.entityId})` : "";
      throw new Error(`scene failed to load${where}: ${report.error}`);
    }
  }
  return runtime;
}

/** The probe's error for an action name the game doesn't declare, or null. */
export function unknownActionError(action: string, actionNames: readonly string[]): string | null {
  if (actionNames.includes(action)) return null;
  const guess = closest(action, actionNames);
  const known = actionNames.length > 0 ? actionNames.join(", ") : "none";
  return `unknown action ${JSON.stringify(action)}${guess ? `; did you mean "${guess}"?` : ""} (actions: ${known})`;
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
 * gets `legal` after the last tick (`legalCommands`); a blocked run has none.
 */
export function runProbe<S = unknown>(opts: ProbeOptions<S> & LibraryOption): ProbeReport<S> {
  const { registry, game } = resolveGame(opts);
  for (const action of [...(opts.hold ?? []), ...(opts.inputs ?? []).map((e) => e[1])]) {
    const error = unknownActionError(action, registry.actionNames);
    if (error) throw new Error(error);
  }
  const runtime = createSceneRuntime({
    rapier: opts.rapier ?? null,
    view: null,
    game,
    registry,
    project: opts.project,
    prefabs: runLibrary(opts),
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
        last = { tick, snapshot: result.game, events: result.events, world };
        if (play?.outcome && !outcome) {
          const verdict = play.outcome(last as PlayState<S>);
          if (verdict) outcome = { ...verdict, tick };
        }
      }
    }

    const final = runtime.snapshot() as S | null;
    const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
    const legal = last && !blocked ? legalCommands(play, last) : null;
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
