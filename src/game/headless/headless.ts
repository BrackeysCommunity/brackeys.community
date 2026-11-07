import { GRAPPLE_RANGE } from "../entities/grapple-anchor";
import { MOVEMENT_CONFIG, PLAYER_HEIGHT, PLAYER_WIDTH } from "../entities/player";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntime, StepEvent } from "../runtime/types";
import { closest } from "../scene/did-you-mean";
import { hashText } from "../scene/hash";
import { DEFAULT_BINDINGS, type InputAction } from "../types";
import { ENGINE_VERSION } from "../version";
import type { HeadlessRuntimeOptions, ProbeOptions, ProbeReport } from "./types";

/** The input actions the player responds to. */
export const PROBE_ACTIONS: readonly string[] = DEFAULT_BINDINGS.map((b) => b.action);

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const DEFAULT_MAX_EVENTS = 1000;

/** A runtime with no view: nothing is drawn and nothing touches the DOM. */
export function createHeadlessRuntime(opts: HeadlessRuntimeOptions): SceneRuntime {
  const runtime = createSceneRuntime({ rapier: opts.rapier, view: null, dev: opts.dev });
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

/**
 * Hashes what a probe's outcome depends on besides the scene, so a report
 * from older movement tuning or another engine version can be told apart.
 */
export const CONFIG_HASH = hashText(
  JSON.stringify({
    engine: ENGINE_VERSION,
    tickRate: TICK_RATE,
    movement: MOVEMENT_CONFIG,
    grappleRange: GRAPPLE_RANGE,
    player: [PLAYER_WIDTH, PLAYER_HEIGHT],
  }),
);

/** The probe's error for an action name the player doesn't know, or null. */
export function unknownActionError(action: string): string | null {
  if (PROBE_ACTIONS.includes(action)) return null;
  const guess = closest(action, PROBE_ACTIONS);
  return `unknown action ${JSON.stringify(action)}${guess ? `; did you mean "${guess}"?` : ""} (actions: ${PROBE_ACTIONS.join(", ")})`;
}

function edge(action: string, pressed: boolean, tick: number): InputAction {
  return { action, pressed, tick, timestamp: tick * TICK_MS };
}

/** Load `scene`, play scripted input for `ticks` ticks, and report what happened. */
export function runProbe(opts: ProbeOptions): ProbeReport {
  for (const action of [...(opts.hold ?? []), ...(opts.inputs ?? []).map((e) => e[1])]) {
    const error = unknownActionError(action);
    if (error) throw new Error(error);
  }
  const runtime = createSceneRuntime({ rapier: opts.rapier, view: null });
  try {
    const load = runtime.load(opts.scene);
    const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
    const events: StepEvent[] = [];
    const landings: ProbeReport["landings"] = [];
    let truncated = false;
    let ticks = 0;

    if (load.ok) {
      const byTick = new Map<number, InputAction[]>();
      for (const [tick, action, pressed] of opts.inputs ?? []) {
        const list = byTick.get(tick) ?? [];
        list.push(edge(action, pressed === 1, tick));
        byTick.set(tick, list);
      }

      for (let tick = 0; tick < opts.ticks; tick++) {
        const actions = tick === 0 ? (opts.hold ?? []).map((a) => edge(a, true, 0)) : [];
        actions.push(...(byTick.get(tick) ?? []));

        const result = runtime.step(TICK_MS, actions);
        ticks++;
        for (const e of result.events) {
          if (e.type === "landed") landings.push({ tick: e.tick, on: e.entityId ?? "", at: e.at });
          if (events.length < maxEvents) events.push(e);
          else truncated = true;
        }
      }
    }

    return {
      configHash: CONFIG_HASH,
      tickRate: TICK_RATE,
      ticks,
      load,
      events,
      truncated,
      landings,
      final: runtime.playerState(),
      stats: runtime.stats(),
    };
  } finally {
    runtime.destroy();
  }
}
