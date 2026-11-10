import type { GameDefinition, Macro, MacroRandom } from "../game/types";
import { resolveGame } from "../runtime/runtime";
import type { EntityTypeName, Ref } from "../scene/types";
import { Rng } from "../sim-kit/rng";
import { probeConfigHash, unknownActionError } from "./headless";
import { blockedRun, prepareRun, runLoop, startRun, type InputSource } from "./play-loop";
import type { FuzzOptions, FuzzRun, FuzzTouch } from "./playtest-types";

const DEFAULT_ROLLOUTS = 100;
const DEFAULT_TICKS = 600;

/** The macro fuzz uses when the game has none: one or two distinct actions held for 4–60 ticks. */
export function defaultFuzzMacro(rng: MacroRandom, actions: readonly string[]): Macro {
  const hold: string[] = [];
  if (actions.length > 0) {
    const first = rng.pick(actions);
    hold.push(first);
    if (actions.length > 1 && rng.range(1, 2) === 2) {
      hold.push(rng.pick(actions.filter((a) => a !== first)));
    }
  }
  return { hold, ticks: rng.range(4, 60) };
}

/** Draws macros back to back for one rollout; it never runs out. */
function macroInput(
  rng: MacroRandom,
  macro: (rng: MacroRandom, actions: readonly string[]) => Macro,
  actions: readonly string[],
): InputSource {
  let hold: readonly string[] = [];
  let left = 0;
  return {
    done: () => false,
    held() {
      if (left === 0) {
        const next = macro(rng, actions);
        if (!Number.isInteger(next.ticks) || next.ticks < 1) {
          throw new RangeError(
            `fuzz macro returned ${next.ticks} ticks; it needs a whole number of at least 1`,
          );
        }
        for (const a of next.hold) {
          const error = unknownActionError(a, actions);
          if (error) throw new Error(`fuzz macro: ${error}`);
        }
        hold = [...new Set(next.hold)];
        left = next.ticks;
      }
      left--;
      return hold;
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
 * does and plays macros (the game's `play.macro`, else `defaultFuzzMacro`)
 * drawn from `@jams/engine/sim-kit`'s `Rng`, until the game's outcome,
 * `stuck` or `ticks` slots (an idle turns or event game skips slots, so its
 * rollouts still end). Reports which entities the rollouts' events named,
 * how many rollouts reached each and how early, the ones never touched, and
 * how the rollouts ended. Rollout `i` draws from its own fork of the seed,
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
  const types = new Map<Ref, EntityTypeName>(prepared.scene.entities.map((e) => [e.id, e.type]));

  const root = Rng.from(opts.seed);
  const play = game?.play;
  const macro = play?.macro
    ? (rng: MacroRandom, actions: readonly string[]) => play.macro!(rng, actions)
    : defaultFuzzMacro;
  const touched = new Map<Ref, Omit<FuzzTouch, "ref" | "type">>();
  const results: Record<string, number> = Object.fromEntries(
    registry.runResults.map((r) => [r, 0]),
  );
  let ticks = 0;
  const startedAt = performance.now();

  for (let rollout = 0; rollout < rollouts; rollout++) {
    const started = startRun({
      rapier: opts.rapier ?? null,
      game,
      registry,
      scene: prepared.scene,
      play: opts.play ?? {},
      dev: opts.dev,
      project: opts.project,
    });
    if (!started.ok) return blockedRun("load", name, prepared.issues, [], started.load);
    const seen = new Set<Ref>();
    const touch = (id: string | undefined, tick: number) => {
      if (id === undefined || seen.has(id) || !types.has(id)) return;
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
        input: macroInput(root.fork(`rollout:${rollout}`), macro, registry.actionNames),
        onTick(state) {
          for (const e of state.events) {
            touch(e.entityId, state.tick);
            touch(e.other, state.tick);
          }
        },
      });
      results[end.result] = (results[end.result] ?? 0) + 1;
      ticks += end.ticks;
    } finally {
      started.runtime.destroy();
    }
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    blocked: false,
    scene: name,
    sceneHash: prepared.hash,
    configHash: probeConfigHash(game),
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
