import type { CheckEnv, CheckVerdict, Registry } from "../game/types";
import {
  DEFAULT_TOUCH_ROLLOUTS,
  DEFAULT_TOUCH_SEED,
  DEFAULT_TOUCH_TICKS,
  type ChecksFile,
  type ReachesCheck,
  type SceneCheck,
  type TouchesCheck,
  type ValidCheck,
} from "../scene/checks";
import type { PrefabLibrary, SceneDefinition, SceneIssue, Severity } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { fuzz } from "./fuzz";
import { runPlaytest } from "./playtest";
import type { InputScript, PlaytestBlocked } from "./playtest-types";
import { validatePhysical } from "./validate-physical";

export type CheckResult = {
  id: string;
  kind: string;
  pass: boolean;
  /** Why the check didn't run; a skipped check passes. */
  skipped?: string;
  message: string;
  detail?: unknown;
};

export type ChecksReport = {
  /** Every check passed or was skipped. */
  ok: boolean;
  results: CheckResult[];
};

export type RunChecksOptions = {
  rapier: RapierModule;
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  registry: Registry;
  checks: ChecksFile;
  /** Reads a file a check names, relative to the checks file. */
  readFile: (path: string) => string;
};

/** The fields every check has; a game kind's `arg` gets the rest. */
const HEAD_KEYS: readonly string[] = ["id", "kind", "skip"];
const RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function tally(issues: readonly SceneIssue[]): string {
  const n = (s: Severity) => issues.filter((i) => i.severity === s).length;
  return `${plural(n("error"), "error")}, ${plural(n("warn"), "warning")}, ${n("info")} info`;
}

function blockedMessage(run: PlaytestBlocked): string {
  const first =
    run.scriptIssues[0]?.message ??
    run.issues.find((i) => i.severity === "error")?.message ??
    (run.load && !run.load.ok ? run.load.error : undefined);
  return `blocked at ${run.stage}${first ? `: ${first}` : ""}`;
}

function runValid(check: ValidCheck, env: CheckEnv): CheckVerdict {
  const issues = [
    ...validateScene(env.def, env.registry, { prefabs: env.prefabs }),
    ...(check.physical
      ? validatePhysical({
          rapier: env.rapier,
          scene: env.def,
          registry: env.registry,
          prefabs: env.prefabs,
        })
      : []),
  ];
  const max = check.max ?? "error";
  const failing = issues.filter((i) => RANK[i.severity] >= RANK[max]);
  const what = check.physical ? "structural and physical" : "structural";
  return failing.length === 0
    ? {
        pass: true,
        message: `no ${max === "error" ? "errors" : "warnings or errors"} (${what}: ${tally(issues)})`,
      }
    : {
        pass: false,
        message: `${tally(issues)}; first: ${failing[0]!.code} ${failing[0]!.message}`,
        detail: { issues: failing },
      };
}

function runReaches(check: ReachesCheck, env: CheckEnv): CheckVerdict {
  let script: InputScript;
  if (typeof check.script === "string") {
    try {
      script = JSON.parse(env.readFile(check.script)) as InputScript;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { pass: false, message: `can't read script ${check.script}: ${message}` };
    }
  } else script = check.script;
  if (check.at) script = { ...script, at: check.at };

  const run = runPlaytest({
    rapier: env.rapier,
    registry: env.registry,
    scene: env.def,
    prefabs: env.prefabs,
    script,
  });
  if (run.blocked) return { pass: false, message: blockedMessage(run), detail: run };
  const { outcome } = run;
  const ended = `ended ${outcome.result} at t${outcome.tick}${outcome.cause ? ` (${outcome.cause})` : ""}`;
  const detail = { outcome, ticks: run.ticks, steps: run.steps };
  return outcome.result === check.result
    ? { pass: true, message: ended, detail }
    : { pass: false, message: `${ended}, not ${check.result}`, detail };
}

function runTouches(check: TouchesCheck, env: CheckEnv): CheckVerdict {
  const rollouts = check.rollouts ?? DEFAULT_TOUCH_ROLLOUTS;
  const run = fuzz({
    rapier: env.rapier,
    registry: env.registry,
    scene: env.def,
    prefabs: env.prefabs,
    seed: check.seed ?? DEFAULT_TOUCH_SEED,
    rollouts,
    ticks: check.ticks ?? DEFAULT_TOUCH_TICKS,
  });
  if (run.blocked) return { pass: false, message: blockedMessage(run), detail: run };
  const touch = run.touched.find((t) => t.ref === check.entity);
  if (!touch && !run.untouched.includes(check.entity)) {
    return { pass: false, message: `no loaded entity ${check.entity} in ${run.scene}` };
  }
  const reached = touch?.reached ?? 0;
  const detail = { reached, rollouts, seed: run.seed, firstTick: touch?.firstTick ?? null };
  const message = `${check.entity} touched in ${reached} of ${rollouts} rollouts${touch ? `, first at t${touch.firstTick}` : ""}`;
  return reached >= check.atLeast
    ? { pass: true, message, detail }
    : { pass: false, message: `${message}; needs ${check.atLeast}`, detail };
}

function runOne(check: SceneCheck, env: CheckEnv): CheckVerdict {
  switch (check.kind) {
    case "valid":
      return runValid(check as ValidCheck, env);
    case "reaches":
      return runReaches(check as ReachesCheck, env);
    case "touches":
      return runTouches(check as TouchesCheck, env);
  }
  const def = env.registry.game?.checks?.[check.kind];
  if (!def) return { pass: false, message: `unknown check kind ${JSON.stringify(check.kind)}` };
  const fields = Object.fromEntries(
    Object.entries(check).filter(([key]) => !HEAD_KEYS.includes(key)),
  );
  const arg = def.arg.safeParse(fields);
  if (!arg.success) return { pass: false, message: `bad fields: ${arg.error.issues[0]?.message}` };
  return def.run(arg.data, env);
}

/**
 * Runs a scene's checks in order: the engine's kinds through
 * `validateScene`/`validatePhysical`, `runPlaytest` and `fuzz`, a game's
 * through its `checks`. A check that throws fails with the error.
 */
export function runChecks(opts: RunChecksOptions): ChecksReport {
  const env: CheckEnv = {
    def: opts.scene,
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
    registry: opts.registry,
    rapier: opts.rapier,
    readFile: opts.readFile,
  };
  const results = opts.checks.checks.map((check): CheckResult => {
    const { id, kind } = check;
    if (check.skip !== undefined)
      return { id, kind, pass: true, skipped: check.skip, message: `skipped: ${check.skip}` };
    let verdict: CheckVerdict;
    try {
      verdict = runOne(check, env);
    } catch (error) {
      verdict = { pass: false, message: error instanceof Error ? error.message : String(error) };
    }
    return { id, kind, ...verdict };
  });
  return { ok: results.every((r) => r.pass), results };
}
