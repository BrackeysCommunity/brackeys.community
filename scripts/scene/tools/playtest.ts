import { readFile, writeFile } from "node:fs/promises";

import { parseSaveFile, type Registry, type SaveFile } from "@jams/engine/game";
import {
  runPlaytest,
  type InputScript,
  type PlaytestBlocked,
  type PlaytestReport,
  type PresentedRequest,
} from "@jams/engine/headless";
import { sha256, type Sha256 } from "@jams/engine/project";
import { INPUT_SCRIPT_VERSION, migrateInputScript } from "@jams/engine/scene";

import {
  failure,
  gameFlag,
  isToolResult,
  issueLine,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { projectRuntime, type ProjectHandle } from "../projects";
import { projectSceneLibrary } from "./flow";
import { eventsReport, eventTypes, rapierFor, rounded } from "./step";
import { timingGroups, timingLines, wallTiming } from "./timing";

export type PlaytestInput = {
  scene?: string;
  script?: string;
  at?: string;
  game?: string;
  /** Writes the run's recording here, for `replay` and the editor's Load run. */
  record?: string;
  /** `type,…`: print only events of these types. */
  events?: string;
  /** Follow flow requests through the project's scene list instead of ending the run at the first. */
  flow?: boolean;
  /** A save fixture (`.save.json`) to start from instead of the scene's fresh load. */
  fromSave?: string;
  /** Time each tick's parts on the wall clock: `timing` beside the report, and a block in the text. */
  timing?: boolean;
  /** Keep the run's presentation requests (`PlaytestReport.present`) and list them. */
  present?: boolean;
};

const USAGE =
  "playtest <scene|file|-> --script <file|-> [--at x,y] [--events type,…] [--game id] [--record file] [--flow] [--from-save file] [--timing] [--present]";

/** `x,y` as two finite numbers, or null. */
export function parsePoint(text: string): [number, number] | null {
  const parts = text.split(",").map((p) => (p.trim() === "" ? Number.NaN : Number(p)));
  return parts.length === 2 && parts.every(Number.isFinite) ? (parts as [number, number]) : null;
}

/** The project a run plays in, as a recording names it; the CLI has no snapshot hash. */
export const projectRef = (project: ProjectHandle | null | undefined) =>
  project ? { id: project.file.id, snapshot: null } : null;

/** A blocked run's text: where it stopped and every issue. */
export function blockedText(run: PlaytestBlocked): string {
  const lines = [`${run.scene}: blocked at ${run.stage}`];
  for (const i of run.scriptIssues) {
    lines.push(`  error ${i.path || "/"} ${i.message}${i.hint ? `\n    hint: ${i.hint}` : ""}`);
  }
  for (const i of run.issues)
    if (run.stage === "scene" || i.severity === "error") lines.push(issueLine(i));
  if (run.load && !run.load.ok) {
    lines.push(
      `  load ${run.load.reason ?? "failed"}: ${run.load.error}${run.load.entityId ? ` (${run.load.entityId})` : ""}`,
    );
  }
  return lines.join("\n");
}

/** How many commands a game listed as legal after the last tick, for a game that lists them. */
export function legalCount(legal: readonly unknown[], truncated: boolean): string {
  if (truncated) return `legal ${legal.length}+ commands (truncated)`;
  return `legal ${legal.length} command${legal.length === 1 ? "" : "s"}`;
}

function reportText(
  r: PlaytestReport,
  runs: string,
  events: readonly string[],
  migratedFrom: number | undefined,
): string {
  const o = r.outcome;
  return [
    `${r.scene} ${r.sceneHash} ${runs} config ${r.configHash}: ${o.result} at t${o.tick} (${r.ticks} ticks)${o.cause ? `: ${o.cause}` : ""}`,
    ...(migratedFrom === undefined ? [] : [`  script migratedFrom ${migratedFrom}`]),
    ...(o.at ? [`  at ${rounded([o.at.x, o.at.y])}`] : []),
    ...r.steps.map(
      (s) =>
        `  step ${s.player === undefined ? "" : `p${s.player}/`}${s.index} t${s.start} +${s.ticks} ${s.end}`,
    ),
    `  final ${rounded(r.final)}`,
    ...(r.legal === undefined ? [] : [`  ${legalCount(r.legal, r.legalTruncated === true)}`]),
    ...events,
    ...(r.truncated ? ["  (events truncated)"] : []),
  ].join("\n");
}

/** `t12 camera shake {"trauma":0.5}`: a request's fields beside its kind and op, numbers as `rounded` gives them. */
export function presentLine(r: PresentedRequest): string {
  const { op, ...fields } = r.op;
  const rest = Object.keys(fields).length > 0 ? ` ${rounded(fields)}` : "";
  return `    t${r.tick} ${r.kind} ${op}${rest}`;
}

/** The `--present` block: every request in the order the run made them, or that it made none. */
export function presentLines(present: readonly PresentedRequest[]): string[] {
  if (present.length === 0) return ["  present: none"];
  return [`  present (${present.length}, points in metres):`, ...present.map(presentLine)];
}

/** A save fixture as a run starts from it: parsed (and migrated) for `registry`'s game, with the hash of its bytes. */
export type SaveFixture = { file: SaveFile; sha256: Sha256; path: string };

/**
 * The save fixture at `path`, read for `registry`'s game: `parseSaveFile`
 * with the game's migrations, and the SHA-256 of its bytes, which a
 * recording names. A missing or malformed file is a failure.
 */
export async function readSaveFixture(
  path: string,
  registry: Registry,
): Promise<SaveFixture | ToolResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT" || code === "EISDIR") return failure(`Not found: ${path}.`);
    throw e;
  }
  const parsed = parseSaveFile(new TextDecoder().decode(bytes), registry.game ?? undefined);
  if (!parsed.ok)
    return {
      exitCode: 1,
      data: { ok: false, save: path, issues: parsed.issues },
      text: [`${path}: not a save this game can load`, ...parsed.issues.map(issueLine)].join("\n"),
    };
  return { file: parsed.file, sha256: await sha256(bytes), path };
}

type ScriptRead =
  | { ok: true; script: InputScript; migratedFrom: number | undefined }
  | { ok: false; result: ToolResult };

/**
 * The input script `arg` names, migrated to the current version for
 * `registry` (before `at` lands, so a v1 script's px never rescale a point
 * given in metres), with `at` set on it when given; a script that isn't
 * JSON or doesn't migrate blocks at `script`.
 */
export async function readPlaytestScript(
  ctx: ToolContext,
  arg: string,
  scene: string,
  registry: Registry,
  at?: [number, number],
): Promise<ScriptRead> {
  const game = registry.game?.id ?? null;
  const blockedAt = (issue: PlaytestBlocked["scriptIssues"][number]): ScriptRead => ({
    ok: false,
    result: blockedResult(
      { blocked: true, stage: "script", scene, issues: [], scriptIssues: [issue] },
      game,
    ),
  });
  let script: unknown;
  try {
    script = JSON.parse(await readArg(ctx, arg));
  } catch (e) {
    if (e instanceof UsageError) return { ok: false, result: usage(e.message) };
    if ((e as { code?: string }).code === "ENOENT")
      return { ok: false, result: failure(`Not found: ${arg}.`) };
    return blockedAt({ path: "", message: `the script is not JSON: ${(e as Error).message}` });
  }
  const lifted = migrateInputScript(script, registry);
  if (!lifted.ok) return blockedAt(lifted.issue);
  const migratedFrom = lifted.from < INPUT_SCRIPT_VERSION ? lifted.from : undefined;
  script = lifted.script;
  if (at && script !== null && typeof script === "object" && !Array.isArray(script))
    script = { ...script, at };
  return { ok: true, script: script as InputScript, migratedFrom };
}

/** The run's start and each scene it went through, for a run that followed flow or began from a save. */
function flowLines(r: PlaytestReport, save: SaveFixture | undefined): string[] {
  const lines: string[] = [];
  if (save) lines.push(`  from save ${save.path} (slot ${save.file.slot}, ${save.file.depth})`);
  for (const s of r.segments ?? []) {
    const to =
      s.end.to === undefined ? "" : ` -> ${s.end.to}${s.end.entry ? `@${s.end.entry}` : ""}`;
    lines.push(`  scene ${s.scene} +${s.ticks} ${s.end.result}${to}`);
  }
  return lines;
}

/**
 * Plays an input script, v1 or v2 (one seat's steps or a track per seat,
 * with analog values, pointer moves and seat changes), on a scene headless
 * and reports how the run ended; a v1 script is migrated first and says so.
 * With `flow` the run follows flow requests through its project's scene
 * list; with `fromSave` it starts from a save fixture of the scene.
 */
export const playtest: Tool<PlaytestInput> = async (input, ctx) => {
  if (!input.script) return usage(`scene ${USAGE}`);
  if (input.scene === "-" && input.script === "-")
    return usage("only one of the scene and --script can be read from stdin");
  let at: [number, number] | undefined;
  if (input.at !== undefined) {
    const point = parsePoint(input.at);
    if (!point) return usage("--at takes x,y in metres, e.g. --at 6.4,9");
    at = point;
  }
  const types = eventTypes(input.events);
  if (typeof types === "string") return usage(types);

  const under = input.game === undefined ? undefined : gameFlag(ctx, input.game);
  if (isToolResult(under)) return under;
  const loaded = await openScene(ctx, input.scene, USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;

  const read = await readPlaytestScript(ctx, input.script, loaded.def.name, registry, at);
  if (!read.ok) return read.result;
  const { script, migratedFrom } = read;

  let flow;
  if (input.flow) {
    if (!loaded.project)
      return usage("--flow follows the scene list of the scene's project; this scene is in none");
    const library = await projectSceneLibrary(ctx, loaded.project);
    if (!library)
      return failure(`project "${loaded.project.file.id}" has no scene list for --flow to follow`);
    flow = library;
  }
  let save: SaveFixture | undefined;
  if (input.fromSave !== undefined) {
    const fixture = await readSaveFixture(input.fromSave, registry);
    if (isToolResult(fixture)) return fixture;
    save = fixture;
  }

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const timing = input.timing ? wallTiming() : null;
  const run = runPlaytest({
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    script,
    projectRef: projectRef(loaded.project),
    ...(ctx.rapierFlavour ? { platform: { flavour: ctx.rapierFlavour } } : {}),
    ...(flow ? { flow } : {}),
    ...(save ? { fromSave: { file: save.file, sha256: save.sha256 } } : {}),
    ...(timing ? { timing } : {}),
    ...(input.present ? { recordPresentation: true } : {}),
  });
  const game = registry.game?.id ?? null;
  if (run.blocked) return blockedResult(run, game);
  if (input.record) await writeFile(input.record, `${JSON.stringify(run.recording)}\n`, "utf8");
  const runs = game ? `game ${game}` : "no game";
  const printed = eventsReport(run.events, run.truncated, types);
  const timed = timing?.report();
  return {
    exitCode: 0,
    data: {
      game,
      ...run,
      ...(timed ? { timing: { ...timed, groups: timingGroups(timed) } } : {}),
      events: printed.events,
      ...(printed.lifecycle ? { lifecycle: printed.lifecycle } : {}),
      ...(migratedFrom === undefined ? {} : { scriptMigratedFrom: migratedFrom }),
      ...(save ? { fromSave: { path: save.path, slot: save.file.slot, sha256: save.sha256 } } : {}),
    },
    text: [
      reportText(run, runs, [...flowLines(run, save), ...printed.lines], migratedFrom),
      ...(input.present ? presentLines(run.present ?? []) : []),
      ...(timed ? timingLines(timed) : []),
    ].join("\n"),
  };
};

/** A blocked run's result: exit 1, its stage and issues. */
export function blockedResult(run: PlaytestBlocked, game: string | null): ToolResult {
  return { exitCode: 1, data: { ok: false, game, ...run }, text: blockedText(run) };
}
