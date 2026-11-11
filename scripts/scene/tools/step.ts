import type { GameCommand } from "@jams/engine/game";
import {
  compileInputScript,
  runProbe,
  unknownActionError,
  type ProbeInput,
  type RapierModule,
} from "@jams/engine/headless";
import {
  expandScene,
  sceneHashWith,
  scenePhysics,
  type Registry,
  type SceneDefinition,
} from "@jams/engine/scene";

import {
  failure,
  gameFlag,
  isToolResult,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
  type ToolContext,
} from "../context";
import { projectRuntime, type ProjectHandle } from "../projects";

export type StepInput = {
  scene?: string;
  ticks?: string;
  hold?: string;
  inputs?: string;
  game?: string;
  /** `<tick>:<name>[=<json>]`: a game command stepped on that tick, in flag order. */
  command?: string | readonly string[];
  /** `<tick>:<ms>`: time away, stepped as `@elapsed` on that tick before its commands. */
  elapse?: string | readonly string[];
};

export const STEP_FLAGS =
  "[--ticks N] [--hold a,b] [--inputs file] [--command tick:name[=json]]… [--elapse tick:ms]… [--game id]";
const STEP_USAGE = `step ${STEP_FLAGS}`;

const DEFAULT_TICKS = 120;
const MAX_TICKS = 60 * 60 * 10;

type Edge = NonNullable<ProbeInput["inputs"]>[number];

function isEdge(v: unknown): v is Edge {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isInteger(v[0]) &&
    v[0] >= 0 &&
    typeof v[1] === "string" &&
    (v[2] === 0 || v[2] === 1)
  );
}

type Queued = { flag: "command" | "elapse"; value: string; tick: number; step: object };

const listOf = (v: string | readonly string[] | undefined): readonly string[] =>
  v === undefined ? [] : typeof v === "string" ? [v] : v;

/** `<tick>:<rest>` with a whole tick from 0 to `ticks - 1`, or the usage error. */
function tickOf(flag: string, value: string, ticks: number): [number, string] | string {
  const colon = value.indexOf(":");
  const tick = colon < 0 ? NaN : Number(value.slice(0, colon));
  if (!Number.isInteger(tick) || tick < 0 || value.slice(0, colon).trim() === "") {
    return `--${flag} ${value}: expected ${flag === "command" ? "tick:name[=json]" : "tick:ms"} with a whole tick`;
  }
  if (tick >= ticks)
    return `--${flag} ${value}: tick ${tick} is past the run's last (${ticks - 1})`;
  return [tick, value.slice(colon + 1)];
}

/** One `--command` or `--elapse` as the input-script step that sends it, or the usage error. */
function queued(flag: Queued["flag"], value: string, ticks: number): Queued | string {
  const parsed = tickOf(flag, value, ticks);
  if (typeof parsed === "string") return parsed;
  const [tick, rest] = parsed;
  if (flag === "elapse") {
    const ms = rest.trim() === "" ? NaN : Number(rest);
    return { flag, value, tick, step: { elapse: ms } };
  }
  const eq = rest.indexOf("=");
  const name = eq < 0 ? rest : rest.slice(0, eq);
  if (eq < 0) return { flag, value, tick, step: { command: name } };
  try {
    return { flag, value, tick, step: { command: name, args: JSON.parse(rest.slice(eq + 1)) } };
  } catch (e) {
    return `--command ${value}: args are not JSON: ${(e as Error).message}`;
  }
}

/**
 * The `--elapse` and `--command` flags as commands on their ticks: each
 * tick's `@elapsed` first, then its commands in flag order. They are
 * checked as an input script's `elapse` and `command` steps are, so a bad
 * name or args gets the same message `playtest` gives.
 */
function commandsOf(
  input: StepInput,
  ticks: number,
  registry: Registry,
): [tick: number, command: GameCommand][] | string {
  const all: Queued[] = [];
  for (const [flag, values] of [
    ["elapse", listOf(input.elapse)],
    ["command", listOf(input.command)],
  ] as const) {
    for (const value of values) {
      const q = queued(flag, value, ticks);
      if (typeof q === "string") return q;
      all.push(q);
    }
  }
  if (all.length === 0) return [];
  const compiled = compileInputScript({ v: 1, steps: all.map((q) => q.step) }, registry);
  if (!compiled.ok) {
    const issue = compiled.issues[0]!;
    const index = Number(/^\/steps\/(\d+)/.exec(issue.path)?.[1]);
    const q = all[index];
    return q ? `--${q.flag} ${q.value}: ${issue.message}` : issue.message;
  }
  const commands = compiled.script.steps.map((s, i): [number, GameCommand] => [
    all[i]!.tick,
    s.commands![0]!,
  ]);
  return commands.sort((a, b) => a[0] - b[0]);
}

const firstError = (actions: readonly string[], registry: Registry) =>
  actions.map((a) => unknownActionError(a, registry.actionNames)).find((e) => e !== null);

type Engine = Readonly<Record<string, unknown>>;

/** The `engine` block of the game-settings of `project` as its files hold it now; undefined outside a project. */
export async function projectEngine(
  project: ProjectHandle | null,
  registry: Registry,
): Promise<Engine | undefined> {
  return project ? (await projectRuntime(project, registry)).engine : undefined;
}

/**
 * Rapier when `def` resolves to it under `engine` (the project's block, as
 * the run resolves it), else null: a physics-free scene never loads the wasm.
 */
export async function rapierFor(
  ctx: ToolContext,
  def: SceneDefinition,
  registry: Registry,
  engine?: Engine,
): Promise<RapierModule | null> {
  return scenePhysics(def, registry, engine) === "rapier" ? ctx.loadRapier() : null;
}

/** Numbers to two decimals, for the text report only. */
export const rounded = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "number" ? Math.round(v * 100) / 100 : v,
  );

export const step: Tool<StepInput> = async (input, ctx) => {
  const ticks = input.ticks === undefined ? DEFAULT_TICKS : Number(input.ticks);
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
    return usage(`--ticks must be an integer from 1 to ${MAX_TICKS}`);
  }
  let under: Registry | undefined;
  if (input.game !== undefined) {
    const picked = gameFlag(ctx, input.game);
    if (isToolResult(picked)) return picked;
    under = picked;
  }

  const loaded = await openScene(ctx, input.scene, STEP_USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;
  const runs = registry.game ? `game ${registry.id}` : "no game";

  const hold = input.hold ? input.hold.split(",").filter(Boolean) : [];
  const badHold = firstError(hold, registry);
  if (badHold) return usage(`--hold: ${badHold}`);

  let inputs: Edge[] = [];
  if (input.inputs) {
    try {
      const raw: unknown = JSON.parse(await readArg(ctx, input.inputs));
      if (!Array.isArray(raw) || !raw.every(isEdge)) {
        return usage("--inputs must be a JSON array of [tick, action, 0|1]");
      }
      const badInput = firstError(
        raw.map((e) => e[1]),
        registry,
      );
      if (badInput) return usage(`--inputs: ${badInput}`);
      inputs = raw;
    } catch (e) {
      if (e instanceof UsageError) return usage(e.message);
      if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.inputs}.`);
      return usage(`--inputs is not JSON: ${(e as Error).message}`);
    }
  }

  const commands = commandsOf(input, ticks, registry);
  if (typeof commands === "string") return usage(commands);

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const engine = project?.engine;
  const report = runProbe({
    rapier: await rapierFor(ctx, loaded.def, registry, engine),
    game: registry.game,
    registry,
    project,
    scene: expandScene(loaded.def, registry, { prefabs: loaded.prefabs, engine }),
    ticks,
    hold,
    inputs,
    commands,
  });
  const hash = sceneHashWith(loaded.def, loaded.prefabs);
  const data = {
    scene: loaded.name,
    game: registry.game?.id ?? null,
    sceneHash: hash,
    ...report,
    commands: commands.map(([tick, c]) =>
      c.args === undefined ? [tick, c.name] : [tick, c.name, c.args],
    ),
  };

  if (!report.load.ok) {
    return {
      exitCode: 1,
      data,
      text: `${loaded.name}: failed to load: ${report.load.error}${report.load.entityId ? ` (${report.load.entityId})` : ""}`,
    };
  }
  const lines = [
    `${loaded.name} ${hash} ${runs} config ${report.configHash}: ${report.ticks} ticks at ${report.tickRate}Hz`,
    `  final ${rounded(report.final)}`,
    ...commands.map(
      ([tick, c]) =>
        `  t${tick} command ${c.name}${c.args === undefined ? "" : ` ${JSON.stringify(c.args)}`}`,
    ),
    ...report.events.map(
      (e) =>
        `  t${e.tick} ${e.type}${e.entityId ? ` ${e.entityId}` : ""}${e.other ? ` (${e.other})` : ""}`,
    ),
    ...(report.truncated ? ["  (events truncated)"] : []),
    ...(report.outcome
      ? [
          `  outcome t${report.outcome.tick} ${report.outcome.result}${report.outcome.cause ? `: ${report.outcome.cause}` : ""}`,
        ]
      : []),
  ];
  return { exitCode: 0, data, text: lines.join("\n") };
};
