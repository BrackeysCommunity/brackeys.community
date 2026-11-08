import type { GameOutcome } from "../game/types";
import { TICK_RATE } from "../physics";
import { inputAction, probeConfigHash } from "../runtime/recorder";
import { createSceneRuntime, resolveGame, type ProjectOption } from "../runtime/runtime";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { closest } from "../scene/did-you-mean";
import type { InputAction } from "../types";
import type { HeadlessRuntimeOptions, ProbeOptions, ProbeReport } from "./types";

export { inputAction, probeConfigHash };

const TICK_MS = 1000 / TICK_RATE;
const DEFAULT_MAX_EVENTS = 1000;

/** A runtime with no view: nothing is drawn and nothing touches the DOM. */
export function createHeadlessRuntime(
  opts: HeadlessRuntimeOptions & ProjectOption,
): SceneRuntimeHandle {
  const runtime = createSceneRuntime({
    rapier: opts.rapier,
    view: null,
    game: opts.game,
    registry: opts.registry,
    dev: opts.dev,
    project: opts.project,
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

/** Load `scene`, play scripted input for `ticks` ticks, and report what happened. */
export function runProbe<S = unknown>(opts: ProbeOptions<S>): ProbeReport<S> {
  const { registry, game } = resolveGame(opts);
  for (const action of [...(opts.hold ?? []), ...(opts.inputs ?? []).map((e) => e[1])]) {
    const error = unknownActionError(action, registry.actionNames);
    if (error) throw new Error(error);
  }
  const runtime = createSceneRuntime({ rapier: opts.rapier, view: null, game, registry });
  try {
    const load = runtime.load(opts.scene);
    const events: StepEvent[] = [];
    let ticks = 0;
    let outcome: (GameOutcome & { tick: number }) | undefined;
    const play = game?.play;

    if (load.ok) {
      const byTick = new Map<number, InputAction[]>();
      for (const [tick, action, pressed] of opts.inputs ?? []) {
        const list = byTick.get(tick) ?? [];
        list.push(inputAction(action, pressed === 1, tick));
        byTick.set(tick, list);
      }

      for (let tick = 0; tick < opts.ticks; tick++) {
        const actions = tick === 0 ? (opts.hold ?? []).map((a) => inputAction(a, true, 0)) : [];
        actions.push(...(byTick.get(tick) ?? []));
        const result = runtime.step(TICK_MS, actions);
        events.push(...result.events);
        ticks++;
        if (play?.outcome && !outcome) {
          const verdict = play.outcome({ tick, snapshot: result.game as S, events: result.events });
          if (verdict) outcome = { ...verdict, tick };
        }
      }
    }

    const final = runtime.snapshot() as S | null;
    const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
    const report: ProbeReport<S> = {
      configHash: probeConfigHash(game),
      tickRate: TICK_RATE,
      ticks,
      load,
      events: events.slice(0, maxEvents),
      truncated: events.length > maxEvents,
      final,
      stats: runtime.stats(),
    };
    if (outcome) report.outcome = outcome;
    return report;
  } finally {
    runtime.destroy();
  }
}
