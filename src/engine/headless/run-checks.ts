import type { CheckEnv, CheckVerdict, PlayState, Registry } from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import {
  gridMissingIssue,
  gridPlace,
  gridRoute,
  sceneGrid,
  type GridPlace,
  type RuntimeGrid,
} from "../runtime/grid";
import { parseBulkId } from "../scene/bulk-ref";
import {
  DEFAULT_BLOCKED_BY,
  DEFAULT_TOUCH_ROLLOUTS,
  DEFAULT_TOUCH_SEED,
  DEFAULT_TOUCH_TICKS,
  type CheckPlace,
  type ChecksFile,
  type ConnectedCheck,
  type ReachesCheck,
  type SceneCheck,
  type TouchesCheck,
  type ValidCheck,
} from "../scene/checks";
import { expandScene } from "../scene/expand";
import { formatScene } from "../scene/format";
import { inputScriptSchemasFor } from "../scene/input-script";
import { jsonPointer, lineAt, makeIssue } from "../scene/issues";
import { parseChildRef } from "../scene/resolve";
import type { PrefabLibrary, Ref, SceneDefinition, SceneIssue, Severity } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { fuzz } from "./fuzz";
import { runLibrary } from "./play-loop";
import { runPlaytest, untilHolds } from "./playtest";
import type { InputScript, PlaytestBlocked, UntilClause } from "./playtest-types";
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
  /** Needed for checks that load a scene running on Rapier; a scene without physics needs none. */
  rapier?: RapierModule | null;
  scene: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  /** Every prefab the game's `ctx.instantiate` may place in the checks that play; default `prefabs`. */
  library?: PrefabLibrary;
  registry: Registry;
  checks: ChecksFile;
  /** Reads a file a check names, relative to the checks file. */
  readFile: (path: string) => string;
  /** The project's `engine` block, which the scene's settings resolve through when validated. */
  engine?: Readonly<Record<string, unknown>>;
  /** The project's data, for the checks that play the scene (`reaches`, `touches`); its `engine` block stands in for `engine` when that is omitted. */
  project?: ProjectRuntimeView | null;
};

/** A check's env with the run's prefab library, for the checks that play the scene. */
type RunEnv = CheckEnv & { library?: PrefabLibrary };

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

function runValid(
  check: ValidCheck,
  env: RunEnv,
  engine: Readonly<Record<string, unknown>> | undefined,
): CheckVerdict {
  const issues = [
    ...validateScene(env.def, env.registry, {
      prefabs: env.prefabs,
      ...(engine ? { engine } : {}),
    }),
    ...(check.physical
      ? validatePhysical({
          rapier: env.rapier ?? null,
          scene: env.def,
          registry: env.registry,
          prefabs: runLibrary(env),
          ...(engine ? { engine } : {}),
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

/** `expect` parsed by the registry's `until` schema, keys in the order the check wrote them. */
function parseExpect(
  expect: UntilClause,
  registry: Registry,
): { ok: true; keys: [string, unknown][] } | { ok: false; message: string } {
  const parsed = inputScriptSchemasFor(registry).until.safeParse(expect);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path.length ? ` at expect.${issue.path.join(".")}` : "";
    return { ok: false, message: `bad expect${at}: ${issue?.message ?? "invalid"}` };
  }
  const data = parsed.data as Record<string, unknown>;
  return {
    ok: true,
    keys: Object.keys(expect)
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  };
}

/** The first of `keys` that doesn't hold on `state`, judged one key at a time as a step's `until` is. */
function firstFailing(
  keys: readonly [string, unknown][],
  state: PlayState,
  registry: Registry,
): [string, unknown] | null {
  return keys.find(([key, arg]) => !untilHolds({ [key]: arg }, state, registry)) ?? null;
}

function runReaches(
  check: ReachesCheck,
  env: RunEnv,
  project: ProjectRuntimeView | null,
): CheckVerdict {
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

  let expectKeys: [string, unknown][] | null = null;
  if (check.expect !== undefined) {
    const parsed = parseExpect(check.expect, env.registry);
    if (!parsed.ok) return { pass: false, message: parsed.message };
    expectKeys = parsed.keys;
  }
  let failed: [string, unknown] | null = null;
  let judged = false;

  const run = runPlaytest({
    rapier: env.rapier ?? null,
    registry: env.registry,
    scene: env.def,
    prefabs: runLibrary(env),
    script,
    project,
    ...(expectKeys && {
      onLastTick(state: PlayState) {
        judged = true;
        failed = firstFailing(expectKeys!, state, env.registry);
      },
    }),
  });
  if (run.blocked) return { pass: false, message: blockedMessage(run), detail: run };
  const { outcome } = run;
  const ended = `ended ${outcome.result} at t${outcome.tick}${outcome.cause ? ` (${outcome.cause})` : ""}`;
  const detail: Record<string, unknown> = { outcome, ticks: run.ticks, steps: run.steps };
  if (outcome.result !== check.result) {
    return { pass: false, message: `${ended}, not ${check.result}`, detail };
  }
  if (!expectKeys) return { pass: true, message: ended, detail };
  if (!judged) {
    return { pass: false, message: `${ended}, but no tick ran to judge expect on`, detail };
  }
  const miss = failed as [string, unknown] | null;
  if (miss) {
    detail.expect = { failed: miss[0] };
    return {
      pass: false,
      message: `${ended}, but expect.${miss[0]} (${JSON.stringify(miss[1])}) doesn't hold then`,
      detail,
    };
  }
  detail.expect = { failed: null };
  return {
    pass: true,
    message: `${ended}; expect holds (${expectKeys.map(([k]) => k).join(", ")})`,
    detail,
  };
}

function runTouches(
  check: TouchesCheck,
  env: RunEnv,
  project: ProjectRuntimeView | null,
): CheckVerdict {
  const rollouts = check.rollouts ?? DEFAULT_TOUCH_ROLLOUTS;
  const run = fuzz({
    rapier: env.rapier ?? null,
    registry: env.registry,
    scene: env.def,
    prefabs: runLibrary(env),
    seed: check.seed ?? DEFAULT_TOUCH_SEED,
    rollouts,
    ticks: check.ticks ?? DEFAULT_TOUCH_TICKS,
    project,
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

/** Where a ref sits in the document: its entity, bulk row, or the instance that holds it. */
function refPointer(def: SceneDefinition, ref: Ref): string | undefined {
  const bulk = parseBulkId(ref);
  if (bulk) return jsonPointer([bulk.key, bulk.index]);
  const child = parseChildRef(ref);
  if (child) {
    const i = (def.instances ?? []).findIndex((inst) => inst.id === child.instance);
    return i < 0 ? undefined : jsonPointer(["instances", i]);
  }
  const i = (def.entities ?? []).findIndex((e) => e.id === ref);
  return i < 0 ? undefined : jsonPointer(["entities", i]);
}

function runConnected(
  check: ConnectedCheck,
  env: CheckEnv,
  engine: Readonly<Record<string, unknown>> | undefined,
): CheckVerdict {
  const scene = expandScene(env.def, env.registry, {
    prefabs: env.prefabs,
    ...(engine ? { engine } : {}),
  });
  const { lines } = formatScene(env.def);
  const withLine = (issue: SceneIssue): SceneIssue => {
    const line = issue.path === undefined ? undefined : lineAt(lines, issue.path);
    return line === undefined ? issue : { ...issue, line };
  };
  const grid: RuntimeGrid | null = sceneGrid(
    scene,
    env.registry,
    check.blockedBy ?? DEFAULT_BLOCKED_BY,
  );
  if (!grid) {
    const issue = withLine(
      gridMissingIssue(env.def.name, `for check "${check.id}" to find paths on`),
    );
    return { pass: false, message: issue.message, detail: { issues: [issue] } };
  }

  const byId = new Map(scene.entities.map((e) => [e.id, e]));
  const place = (p: CheckPlace): GridPlace | string => {
    if (typeof p !== "string") return gridPlace(grid, env.registry, p);
    const e = byId.get(p);
    return e ? gridPlace(grid, env.registry, e) : `no loaded entity ${p} in ${env.def.name}`;
  };
  const from = place(check.from);
  if (typeof from === "string") return { pass: false, message: from };
  const targets = check.to.map(place);
  const missing = targets.find((t): t is string => typeof t === "string");
  if (missing !== undefined) return { pass: false, message: missing };

  const paths: { to: string; steps: number; cost: number }[] = [];
  const issues: SceneIssue[] = [];
  for (const to of targets as GridPlace[]) {
    const path = gridRoute(grid, from.cell, to.cell, check.diagonals ?? false);
    if (path) {
      paths.push({ to: to.label, steps: path.cells.length - 1, cost: path.cost });
      continue;
    }
    const pointer = to.ref === undefined ? undefined : refPointer(env.def, to.ref);
    issues.push(
      withLine(
        makeIssue("grid-unreachable", {
          message: `no path on the grid from ${from.label} to ${to.label}`,
          ...(pointer !== undefined ? { path: pointer } : {}),
          entityIds: to.ref === undefined ? [] : [to.ref],
          at: to.at,
          detail: { check: check.id, from: from.cell, to: to.cell },
        }),
      ),
    );
  }
  const n = targets.length;
  if (issues.length === 0) {
    return {
      pass: true,
      message: `${from.label} reaches ${plural(n, "target")} on the grid`,
      detail: { paths },
    };
  }
  return {
    pass: false,
    message: `${issues.length} of ${plural(n, "target")} unreachable from ${from.label}; first: ${issues[0]!.message}`,
    detail: { issues, paths },
  };
}

function runOne(
  check: SceneCheck,
  env: RunEnv,
  engine: Readonly<Record<string, unknown>> | undefined,
  project: ProjectRuntimeView | null,
): CheckVerdict {
  switch (check.kind) {
    case "valid":
      return runValid(check as ValidCheck, env, engine);
    case "reaches":
      return runReaches(check as ReachesCheck, env, project);
    case "touches":
      return runTouches(check as TouchesCheck, env, project);
    case "connected":
      return runConnected(check as ConnectedCheck, env, engine);
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
 * `validateScene`/`validatePhysical`, `runPlaytest`, `fuzz` and `findPath`
 * over the scene's grid, a game's through its `checks`. A check that throws fails with the error.
 */
export function runChecks(opts: RunChecksOptions): ChecksReport {
  const env: RunEnv = {
    def: opts.scene,
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
    ...(opts.library ? { library: opts.library } : {}),
    registry: opts.registry,
    rapier: opts.rapier ?? null,
    readFile: opts.readFile,
  };
  const engine = opts.engine ?? opts.project?.engine;
  const results = opts.checks.checks.map((check): CheckResult => {
    const { id, kind } = check;
    if (check.skip !== undefined)
      return { id, kind, pass: true, skipped: check.skip, message: `skipped: ${check.skip}` };
    let verdict: CheckVerdict;
    try {
      verdict = runOne(check, env, engine, opts.project ?? null);
    } catch (error) {
      verdict = { pass: false, message: error instanceof Error ? error.message : String(error) };
    }
    return { id, kind, ...verdict };
  });
  return { ok: results.every((r) => r.pass), results };
}
