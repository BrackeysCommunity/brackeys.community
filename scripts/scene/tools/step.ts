import { pxPerMetreOf, type GameCommand, type PlayersDef } from "@jams/engine/game";
import {
  compileInputScript,
  ENTITY_DESTROYED,
  ENTITY_SPAWNED,
  runProbe,
  simActionError,
  type ProbeInput,
  type RapierModule,
  type StepEvent,
} from "@jams/engine/headless";
import {
  expandScene,
  INPUT_SCRIPT_VERSION,
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
import { blockedText } from "./playtest";

export type StepInput = {
  scene?: string;
  ticks?: string;
  hold?: string;
  inputs?: string;
  game?: string;
  /** `<tick>[@<seat>]:<name>[=<json>]`: a game command from a seat (default 0) stepped on that tick, in flag order. */
  command?: string | readonly string[];
  /** `<tick>:<ms>`: time away, stepped as `@elapsed` on that tick before its commands. */
  elapse?: string | readonly string[];
  /** `type,…`: print only events of these types. */
  events?: string;
  /** Print the commands legal after the last tick, for a game that lists them. */
  legal?: boolean;
};

export const STEP_FLAGS =
  "[--ticks N] [--hold a,b] [--inputs file] [--command tick[@seat]:name[=json]]… [--elapse tick:ms]… [--events type,…] [--game id] [--legal]";
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

type Queued = {
  flag: "command" | "elapse";
  value: string;
  tick: number;
  /** The seat a command comes from; `@elapsed` has none. */
  player: number;
  step: object;
};

const listOf = (v: string | readonly string[] | undefined): readonly string[] =>
  v === undefined ? [] : typeof v === "string" ? [v] : v;

const isWhole = (text: string) =>
  text.trim() !== "" && Number.isInteger(Number(text)) && Number(text) >= 0;

/**
 * `<tick>[@<seat>]:<rest>` with a whole tick from 0 to `ticks - 1` and, for
 * a command, a whole seat (default 0), or the usage error. The seat is
 * judged against the run's seats when the commands compile.
 */
function tickOf(
  flag: Queued["flag"],
  value: string,
  ticks: number,
): [tick: number, player: number, rest: string] | string {
  const colon = value.indexOf(":");
  const head = colon < 0 ? "" : value.slice(0, colon);
  const at = flag === "command" ? head.indexOf("@") : -1;
  const tickText = at < 0 ? head : head.slice(0, at);
  const seatText = at < 0 ? "0" : head.slice(at + 1);
  if (!isWhole(tickText) || !isWhole(seatText)) {
    return `--${flag} ${value}: expected ${flag === "command" ? "tick:name[=json]" : "tick:ms"} with a whole tick${flag === "command" ? " (and tick@seat with a whole seat)" : ""}`;
  }
  const tick = Number(tickText);
  if (tick >= ticks)
    return `--${flag} ${value}: tick ${tick} is past the run's last (${ticks - 1})`;
  return [tick, Number(seatText), value.slice(colon + 1)];
}

/** One `--command` or `--elapse` as the input-script step that sends it, or the usage error. */
function queued(flag: Queued["flag"], value: string, ticks: number): Queued | string {
  const parsed = tickOf(flag, value, ticks);
  if (typeof parsed === "string") return parsed;
  const [tick, player, rest] = parsed;
  if (flag === "elapse") {
    const ms = rest.trim() === "" ? NaN : Number(rest);
    return { flag, value, tick, player, step: { elapse: ms } };
  }
  const eq = rest.indexOf("=");
  const name = eq < 0 ? rest : rest.slice(0, eq);
  if (eq < 0) return { flag, value, tick, player, step: { command: name } };
  try {
    const args: unknown = JSON.parse(rest.slice(eq + 1));
    return { flag, value, tick, player, step: { command: name, args } };
  } catch (e) {
    return `--command ${value}: args are not JSON: ${(e as Error).message}`;
  }
}

/**
 * The `--elapse` and `--command` flags as commands on their ticks: each
 * tick's `@elapsed` first, then its commands in flag order. They are
 * checked as an input script's `elapse` and `command` steps are, one track
 * per seat over the seats `players` (the project input map's) or the game
 * gives, so a bad name, args or seat gets the same message `playtest` gives.
 */
function commandsOf(
  input: StepInput,
  ticks: number,
  registry: Registry,
  players: PlayersDef | null | undefined,
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
  const seats = [...new Set(all.map((q) => q.player))].sort((a, b) => a - b);
  const bySeat = seats.map((player) => all.filter((q) => q.player === player));
  const script =
    seats.length === 1 && seats[0] === 0
      ? { v: INPUT_SCRIPT_VERSION, steps: all.map((q) => q.step) }
      : {
          v: INPUT_SCRIPT_VERSION,
          tracks: seats.map((player, t) => ({ player, steps: bySeat[t]!.map((q) => q.step) })),
        };
  const compiled = compileInputScript(script, registry, undefined, players);
  if (!compiled.ok) {
    const issue = compiled.issues[0]!;
    const stepAt = /^\/steps\/(\d+)/.exec(issue.path);
    const track = /^\/tracks\/(\d+)(?:\/steps\/(\d+))?/.exec(issue.path);
    const q = stepAt
      ? all[Number(stepAt[1])]
      : track
        ? bySeat[Number(track[1])]?.[track[2] === undefined ? 0 : Number(track[2])]
        : undefined;
    return q ? `--${q.flag} ${q.value}: ${issue.message}` : issue.message;
  }
  const { steps, tracks } = compiled.script as {
    steps: { commands?: GameCommand[] }[];
    tracks?: { steps: { commands?: GameCommand[] }[] }[];
  };
  const sent = tracks ? tracks.flatMap((t) => t.steps) : steps;
  const queuedInOrder = tracks ? bySeat.flat() : all;
  const commands = sent.map((s, i) => {
    const q = queuedInOrder[i]!;
    const command = s.commands![0]!;
    const sentBy = q.player === 0 ? command : { ...command, player: q.player };
    return { q, at: all.indexOf(q), entry: [q.tick, sentBy] as [number, GameCommand] };
  });
  return commands.sort((a, b) => a.q.tick - b.q.tick || a.at - b.at).map((c) => c.entry);
}

const firstError = (actions: readonly string[], registry: Registry) =>
  actions.map((a) => simActionError(registry, a)).find((e) => e !== null);

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

/**
 * Numbers to four decimals, for the text report only: a ten-thousandth of
 * a metre, 1/100 world px at the default 100 px per metre.
 */
export const rounded = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "number" ? Math.round(v * 1e4) / 1e4 + 0 : v,
  );

/** `lengths in m (100 px/m)`: how a report's positions and speeds read. */
export const unitsNote = (registry: Registry) =>
  `lengths in m, speeds in m/s (${pxPerMetreOf(registry)} px/m)`;

/** `--events a,b` as the set of types to keep; undefined keeps every event. */
export function eventTypes(flag: string | undefined): ReadonlySet<string> | undefined | string {
  if (flag === undefined) return undefined;
  const types = flag
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (types.length === 0)
    return "--events takes a comma list of event types, e.g. entity:spawned,contact:start";
  return new Set(types);
}

export const keepEvents = <E extends { type: string }>(
  events: readonly E[],
  types: ReadonlySet<string> | undefined,
): E[] => (types ? events.filter((e) => types.has(e.type)) : [...events]);

export const eventLine = (e: StepEvent) =>
  `  t${e.tick} ${e.type}${e.entityId ? ` ${e.entityId}` : ""}${e.other ? ` (${e.other})` : ""}`;

export type LifecycleCounts = Record<string, { spawned: number; destroyed: number }>;

/** Spawns and destroys per entity type, read from the lifecycle events' `data.type`, in first-seen order. */
export function lifecycleCounts(events: readonly StepEvent[]): LifecycleCounts {
  const counts: LifecycleCounts = {};
  for (const e of events) {
    const key =
      e.type === ENTITY_SPAWNED ? "spawned" : e.type === ENTITY_DESTROYED ? "destroyed" : null;
    if (!key) continue;
    const type = (e.data as { type?: unknown } | undefined)?.type;
    const name = typeof type === "string" ? type : "?";
    const row = (counts[name] ??= { spawned: 0, destroyed: 0 });
    row[key]++;
  }
  return counts;
}

/** One `spawned bullet ×212, destroyed ×212` line per type; counted from the reported events when they were truncated. */
export function lifecycleLines(counts: LifecycleCounts, truncated: boolean): string[] {
  return Object.entries(counts).map(([type, { spawned, destroyed }]) => {
    const parts = [
      ...(spawned ? [`spawned ${type} ×${spawned}`] : []),
      ...(destroyed
        ? [spawned ? `destroyed ×${destroyed}` : `destroyed ${type} ×${destroyed}`]
        : []),
    ];
    return `  ${parts.join(", ")}${truncated ? " (of the reported events)" : ""}`;
  });
}

/** The events the report prints and the per-type lifecycle summary, both added to `data`. */
export function eventsReport(
  events: readonly StepEvent[],
  truncated: boolean,
  types: ReadonlySet<string> | undefined,
): { events: StepEvent[]; lifecycle?: LifecycleCounts; lines: string[] } {
  const counts = lifecycleCounts(events);
  const kept = keepEvents(events, types);
  const summary = Object.keys(counts).length > 0;
  return {
    events: kept,
    ...(summary ? { lifecycle: counts } : {}),
    lines: [...(summary ? lifecycleLines(counts, truncated) : []), ...kept.map(eventLine)],
  };
}

/** `@2 name {args}`: a command as the report prints it, its seat when not 0. */
const commandText = (c: GameCommand) =>
  `${c.player ? `@${c.player} ` : ""}${c.name}${c.args === undefined ? "" : ` ${JSON.stringify(c.args)}`}`;

/** The `--legal` lines: each legal command after the last tick (with its seat, when not 0), or why there are none. */
function legalLines(
  registry: Registry,
  legal: readonly GameCommand[] | undefined,
  truncated: boolean,
): string[] {
  if (!registry.game?.play?.commands) return ["  legal: the game lists no commands"];
  if (legal === undefined) return ["  legal: none (run blocked)"];
  if (legal.length === 0) return ["  legal: none"];
  return [
    `  legal (${legal.length}${truncated ? ", truncated" : ""}):`,
    ...legal.map((c) => `    ${commandText(c)}`),
  ];
}

export const step: Tool<StepInput> = async (input, ctx) => {
  const ticks = input.ticks === undefined ? DEFAULT_TICKS : Number(input.ticks);
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
    return usage(`--ticks must be an integer from 1 to ${MAX_TICKS}`);
  }
  const types = eventTypes(input.events);
  if (typeof types === "string") return usage(types);
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

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const commands = commandsOf(input, ticks, registry, project?.inputMap?.players);
  if (typeof commands === "string") return usage(commands);

  const engine = project?.engine;
  const report = runProbe({
    rapier: await rapierFor(ctx, loaded.def, registry, engine),
    game: registry.game,
    registry,
    project,
    scene: expandScene(loaded.def, registry, { prefabs: loaded.prefabs, engine }),
    library: loaded.prefabs,
    ticks,
    hold,
    inputs,
    commands,
  });
  const hash = sceneHashWith(loaded.def, loaded.prefabs);
  const printed = eventsReport(report.events, report.truncated, types);
  const data = {
    scene: loaded.name,
    game: registry.game?.id ?? null,
    sceneHash: hash,
    pxPerMetre: pxPerMetreOf(registry),
    ...report,
    events: printed.events,
    ...(printed.lifecycle ? { lifecycle: printed.lifecycle } : {}),
    commands: commands.map(([tick, c]) =>
      c.player
        ? [tick, c.name, c.args ?? null, c.player]
        : c.args === undefined
          ? [tick, c.name]
          : [tick, c.name, c.args],
    ),
  };

  if (!report.load.ok) {
    return {
      exitCode: 1,
      data,
      text: `${loaded.name}: failed to load: ${report.load.error}${report.load.entityId ? ` (${report.load.entityId})` : ""}`,
    };
  }
  if (report.blocked) {
    return {
      exitCode: 1,
      data: { ok: false, ...data, ...report.blocked },
      text: [
        `${blockedText(report.blocked)}\n  after ${report.ticks} ticks`,
        ...(input.legal ? legalLines(registry, report.legal, false) : []),
      ].join("\n"),
    };
  }
  const lines = [
    `${loaded.name} ${hash} ${runs} config ${report.configHash}: ${report.ticks} ticks at ${report.tickRate}Hz; ${unitsNote(registry)}`,
    `  final ${rounded(report.final)}`,
    ...commands.map(([tick, c]) => `  t${tick} command ${commandText(c)}`),
    ...printed.lines,
    ...(report.truncated ? ["  (events truncated)"] : []),
    ...(input.legal ? legalLines(registry, report.legal, report.legalTruncated === true) : []),
    ...(report.outcome
      ? [
          `  outcome t${report.outcome.tick} ${report.outcome.result}${report.outcome.cause ? `: ${report.outcome.cause}` : ""}`,
        ]
      : []),
  ];
  return { exitCode: 0, data, text: lines.join("\n") };
};
