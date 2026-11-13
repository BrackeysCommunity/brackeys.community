import type { SceneLibrary } from "../game/flow";
import {
  LIVE_CHECK_AGAIN_TICKS,
  LIVE_DEFAULTS,
  swapStrategyFor,
  type LiveDeclaration,
  type SwapStrategy,
} from "../game/live";
import type { GameDefinition, Registry } from "../game/types";
import { stableJson } from "../project/canonical";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import { preparedVersion, type LiveLayer, type PreparedVersion } from "../runtime/live";
import { gamePersistCell } from "../runtime/persist";
import { resolveGame } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { ChecksFile } from "../scene/checks";
import { diffExpanded } from "../scene/expanded-diff";
import { liveIssue, makeIssue } from "../scene/issues";
import type { ExpandedScene, PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import type { RapierModule, StagedVersion } from "../types";
import { scriptSource } from "./compile-input-script";
import { prepareRun, runBlocked, runLoop, startRun, type InputSource } from "./play-loop";
import { compilePlaytestScript, scriptSceneIssue, untilHolds } from "./playtest";
import type {
  CompiledInputScript,
  InputScript,
  InputScriptV2,
  ScriptIssue,
} from "./playtest-types";
import { runChecks, type ChecksReport } from "./run-checks";

export type SwapCheckOptions = {
  game: GameDefinition;
  /** Built from `game` when omitted. */
  registry?: Registry;
  /** The version players have now: a staged version, or the release's scene (def and prefabs). */
  from: StagedVersion | { def: SceneDefinition; prefabs: PrefabLibrary };
  to: StagedVersion;
  /** The scene's input scripts, each named as the report names its runs. */
  scripts: readonly { name: string; script: InputScript | InputScriptV2 }[];
  /** The scene's checks file, run once against `to`; the report's `checks`. */
  checks?: { file: ChecksFile; readFile: (path: string) => string };
  /** Fractions of each script's run to swap at; default `LIVE_DEFAULTS.checkAt`. */
  at?: readonly number[];
  /** Ticks to step after each swap; default `LIVE_DEFAULTS.checkTicks`. */
  afterTicks?: number;
  /** Needed when either version's scene runs on Rapier. */
  rapier?: RapierModule | null;
  project?: ProjectRuntimeView | null;
};

export type SwapCheckRun = {
  script: string;
  /** The fraction of the run asked for. */
  at: number;
  /** The tick the swap ran before: `round(at · N)` of the run's N ticks, at most its last. */
  tick: number;
  /** What the swap did, or would have done when it failed. */
  strategy: SwapStrategy;
  issues: readonly SceneIssue[];
};

export type SwapCheckReport = {
  /** No error among the runs' issues and `issues`, and every check passed. */
  ok: boolean;
  runs: readonly SwapCheckRun[];
  /** What kept a version or a script from being played at all, the script's name leading the message. */
  issues: readonly SceneIssue[];
  /** `checks` run against `to`, when given. */
  checks?: ChecksReport;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isError = (issues: readonly SceneIssue[]) => issues.some((i) => i.severity === "error");

type Played = { ok: true; ticks: number } | { ok: false; issues: SceneIssue[] };

/** One script's run from the start; the swap waits for `swap.tick`. */
type PlayOnce = (swap: SwapAt | null) => Played;

type SwapAt = {
  tick: number;
  afterTicks: number;
  /** Called with the issues found and the strategy the swap used. */
  done(strategy: SwapStrategy | null, issues: SceneIssue[]): void;
};

/**
 * Plays each script on `from`, swaps `to` in at each fraction of its run
 * through the live layer's own apply path (timing `now`, strategy auto),
 * steps `afterTicks` more, and runs the game's `live.check` right after the
 * swap and 60 ticks later. A swap that fails (`onSwap` threw, or a swap step
 * refused) and a step that throws after it are issues; `checks` runs once
 * against `to`. Deterministic, as playtests are.
 */
export function swapCheck(opts: SwapCheckOptions): SwapCheckReport {
  const { registry, game } = resolveGame({ game: opts.game, registry: opts.registry });
  const engine = opts.project?.engine;
  const at = opts.at ?? LIVE_DEFAULTS.checkAt;
  const afterTicks = opts.afterTicks ?? LIVE_DEFAULTS.checkTicks;
  const scene = opts.to.version.scene;
  const issues: SceneIssue[] = [];
  const runs: SwapCheckRun[] = [];
  const report = (checks?: ChecksReport): SwapCheckReport => ({
    ok: !isError(issues) && runs.every((r) => !isError(r.issues)) && checks?.ok !== false,
    runs,
    issues,
    ...(checks ? { checks } : {}),
  });

  const target = preparedVersion(opts.to, registry, game, engine);
  if (!target.ok) {
    issues.push(...target.issues);
    return report();
  }
  const to = target.prepared;

  let fromVersion: PreparedVersion | undefined;
  let fromDef: SceneDefinition;
  let fromPrefabs: PrefabLibrary;
  if ("def" in opts.from) {
    fromDef = opts.from.def;
    fromPrefabs = opts.from.prefabs;
  } else {
    if (opts.from.version.scene !== scene) {
      issues.push(
        liveIssue({
          code: "live-swap-failed",
          scene,
          cause: `the version swapped from is of ${opts.from.version.scene}, not ${scene}`,
          phase: "stage",
        }),
      );
      return report();
    }
    const read = preparedVersion(opts.from, registry, game, engine);
    if (!read.ok) {
      issues.push(...read.issues);
      return report();
    }
    fromVersion = read.prepared;
    fromDef = fromVersion.def;
    fromPrefabs = fromVersion.prefabs;
  }

  const prepared = prepareRun(fromDef, registry, false, fromPrefabs, engine, {
    project: opts.project,
    library: fromPrefabs,
  });
  if (!prepared.ok) {
    issues.push(...prepared.blocked.issues);
    return report();
  }
  const planned = swapStrategyFor(diffExpanded(prepared.scene, to.scene));

  for (const { name, script } of opts.scripts) {
    const compiled = compilePlaytestScript(script, registry, opts.project);
    if (!compiled.ok) {
      for (const s of compiled.issues) issues.push(scriptProblem(name, s));
      continue;
    }
    const otherScene = scriptSceneIssue(compiled.script, fromDef.name);
    if (otherScene) {
      issues.push(scriptProblem(name, otherScene));
      continue;
    }
    const play = playScript({
      game,
      registry,
      scene,
      def: fromDef,
      prefabs: fromPrefabs,
      expanded: prepared.scene,
      version: fromVersion,
      to,
      script: compiled.script,
      rapier: opts.rapier,
      project: opts.project,
    });
    const baseline = play(null);
    if (!baseline.ok) {
      issues.push(...baseline.issues.map((i) => ({ ...i, message: `${name}: ${i.message}` })));
      continue;
    }
    const last = Math.max(0, baseline.ticks - 1);
    for (const fraction of at) {
      const tick = Math.min(Math.max(0, Math.round(fraction * baseline.ticks)), last);
      let found: SceneIssue[] = [];
      let strategy: SwapStrategy = planned;
      const run = play({
        tick,
        afterTicks,
        done(used, swapIssues) {
          if (used) strategy = used;
          found = swapIssues;
        },
      });
      if (!run.ok) found = [...found, ...run.issues];
      runs.push({ script: name, at: fraction, tick, strategy, issues: found });
    }
  }

  const checks = opts.checks
    ? runChecks({
        rapier: opts.rapier ?? null,
        scene: to.def,
        prefabs: to.prefabs,
        library: to.prefabs,
        registry,
        checks: opts.checks.file,
        readFile: opts.checks.readFile,
        ...(engine ? { engine } : {}),
        project: opts.project ?? null,
      })
    : undefined;
  return report(checks);
}

/** A script that can't be played on the scene, as a `schema` issue naming the script. */
function scriptProblem(name: string, s: ScriptIssue): SceneIssue {
  return makeIssue("schema", {
    message: `${name}: ${s.message}`,
    path: s.path,
    ...(s.expected !== undefined ? { expected: s.expected } : {}),
    ...(s.got !== undefined ? { got: s.got } : {}),
    ...(s.hint !== undefined ? { hint: s.hint } : {}),
  });
}

/**
 * The issue for an error thrown out of a step or a `live.check`: an
 * `EngineError` keeps its code, as a blocked playtest reports it; anything
 * else is the swap failing.
 */
function thrownIssue(
  err: unknown,
  what: string,
  scene: AssetId,
  name: string,
  registry: Registry,
): SceneIssue {
  const blocked = runBlocked(err, name, [], registry);
  const issue = blocked?.issues[0];
  if (issue) return { ...issue, message: `${what}: ${issue.message}` };
  return liveIssue({ code: "live-swap-failed", scene, cause: `${what}: ${errorText(err)}` });
}

type PlayScriptOptions = {
  game: GameDefinition | null;
  registry: Registry;
  scene: AssetId;
  def: SceneDefinition;
  prefabs: PrefabLibrary;
  expanded: ExpandedScene;
  version: PreparedVersion | undefined;
  to: PreparedVersion;
  script: CompiledInputScript;
  rapier: RapierModule | null | undefined;
  project: ProjectRuntimeView | null | undefined;
};

/**
 * Runs of one script on the old version, each started fresh the way a
 * playtest starts one, as the scene `scene` so the swap finds it playing.
 * Without a swap the run ends as the playtest does; with one, the script's
 * input stands once it runs out, so the run goes on `afterTicks` past the swap.
 */
function playScript(o: PlayScriptOptions): PlayOnce {
  const library: SceneLibrary = { list: [], scenes: new Map() };
  const release = (id: AssetId) => (id === o.scene ? { def: o.def, prefabs: o.prefabs } : null);
  const declared = o.game?.live;

  return (swap) => {
    const started = startRun({
      rapier: o.rapier,
      game: o.game,
      registry: o.registry,
      scene: o.expanded,
      play: o.script.play,
      project: o.project,
      prefabs: o.prefabs,
      persist: gamePersistCell(o.game, true),
      flow: { scene: o.scene, entry: null, library },
      ...(o.version ? { version: o.version } : {}),
      release,
    });
    if (!started.ok) {
      const failed = started.load.ok ? "the scene didn't load" : started.load.error;
      return {
        ok: false,
        issues: started.issue
          ? [started.issue]
          : [
              liveIssue({
                code: "live-swap-failed",
                scene: o.scene,
                cause: failed,
                phase: "stage",
              }),
            ],
      };
    }
    const { runtime, live } = started;
    try {
      return swap ? swapRun(o, runtime, live, swap, declared) : plainRun(o, runtime);
    } finally {
      runtime.destroy();
    }
  };
}

function scriptInput(o: PlayScriptOptions, runtime: SceneRuntimeHandle) {
  return scriptSource(
    o.script,
    (until, state) => untilHolds(until, state, o.registry, o.scene),
    runtime.ctx.time,
  );
}

function plainRun(o: PlayScriptOptions, runtime: SceneRuntimeHandle): Played {
  try {
    const end = runLoop({
      runtime,
      game: o.game,
      maxTicks: o.script.maxTicks,
      input: scriptInput(o, runtime),
      live: {},
    });
    return { ok: true, ticks: end.ticks };
  } catch (err) {
    const blocked = runBlocked(err, o.def.name, [], o.registry);
    if (blocked) return { ok: false, issues: blocked.issues };
    throw err;
  }
}

function swapRun(
  o: PlayScriptOptions,
  runtime: SceneRuntimeHandle,
  live: LiveLayer,
  swap: SwapAt,
  declared: LiveDeclaration | undefined,
): Played {
  const source = scriptInput(o, runtime);
  let idle = 0;
  const input: InputSource = {
    done: () => source.done() && idle >= swap.afterTicks,
    tick(slot) {
      if (!source.done()) return source.tick(slot);
      idle++;
      return { tick: slot, actions: [], commands: [], pointers: [], joins: [] };
    },
    after: (state) => source.after?.(state),
    skipped: (slot) => source.skipped?.(slot),
  };

  const issues: SceneIssue[] = [];
  const seen = new Set<string>();
  const add = (found: readonly SceneIssue[]) => {
    for (const issue of found) {
      const key = stableJson(issue);
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
    }
  };
  const runCheck = (when: string) => {
    if (!declared?.check) return;
    try {
      add(declared.check(runtime.ctx));
    } catch (err) {
      add([thrownIssue(err, `live.check threw ${when}`, o.scene, o.def.name, o.registry)]);
    }
  };

  let strategy: SwapStrategy | null = null;
  let swapped = false;
  let secondDone = false;
  // The second check runs at the run's end when that comes sooner.
  const secondAt = swap.tick + Math.min(LIVE_CHECK_AGAIN_TICKS, swap.afterTicks);
  const beforeTick = (): string | null => {
    const now = runtime.ctx.tick;
    if (!swapped && now === swap.tick) {
      swapped = true;
      const applied = live.apply(o.scene, o.to, { timing: "now" });
      if (!applied.ok) {
        add([applied.issue]);
        return "the swap failed";
      }
      strategy = applied.swap.strategy;
      runCheck("right after the swap");
    } else if (swapped && !secondDone && now === secondAt) {
      secondDone = true;
      runCheck(`${now - swap.tick} ticks after the swap`);
    }
    return null;
  };

  try {
    runLoop({
      runtime,
      game: o.game,
      maxTicks: swap.tick + swap.afterTicks,
      input,
      stuck: false,
      live: { beforeTick, afterTick: (state) => live.afterTick(state) },
    });
  } catch (err) {
    add([
      thrownIssue(err, `a step threw at tick ${runtime.ctx.tick}`, o.scene, o.def.name, o.registry),
    ]);
    swap.done(strategy, issues);
    return { ok: true, ticks: runtime.ctx.tick };
  }
  if (!swapped)
    add([
      liveIssue({
        code: "live-swap-failed",
        scene: o.scene,
        cause: `the run ended before tick ${swap.tick}, where the swap was due`,
        phase: "swap",
      }),
    ]);
  else if (strategy && !secondDone && runtime.ctx.tick > swap.tick)
    runCheck(`at the run's end, ${runtime.ctx.tick - swap.tick} ticks after the swap`);
  swap.done(strategy, issues);
  return { ok: true, ticks: runtime.ctx.tick };
}
