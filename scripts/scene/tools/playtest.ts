import { writeFile } from "node:fs/promises";

import {
  runPlaytest,
  type InputScript,
  type PlaytestBlocked,
  type PlaytestReport,
} from "@jams/engine/headless";
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
  type ToolResult,
} from "../context";
import { projectRuntime, type ProjectHandle } from "../projects";
import { eventsReport, eventTypes, rapierFor, rounded } from "./step";

export type PlaytestInput = {
  scene?: string;
  script?: string;
  at?: string;
  game?: string;
  /** Writes the run's recording here, for `replay` and the editor's Load run. */
  record?: string;
  /** `type,…`: print only events of these types. */
  events?: string;
};

const USAGE =
  "playtest <scene|file|-> --script <file|-> [--at x,y] [--events type,…] [--game id] [--record file]";

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

/**
 * Plays an input script, v1 or v2 (one seat's steps or a track per seat,
 * with analog values, pointer moves and seat changes), on a scene headless
 * and reports how the run ended; a v1 script is migrated first and says so.
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

  let script: unknown;
  try {
    script = JSON.parse(await readArg(ctx, input.script));
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.script}.`);
    const blocked: PlaytestBlocked = {
      blocked: true,
      stage: "script",
      scene: loaded.def.name,
      issues: [],
      scriptIssues: [{ path: "", message: `the script is not JSON: ${(e as Error).message}` }],
    };
    return blockedResult(blocked, registry.game?.id ?? null);
  }
  // Migrated before `--at` lands, so a v1 script's px never rescale a point given in metres.
  const lifted = migrateInputScript(script, registry);
  if (!lifted.ok)
    return blockedResult(
      {
        blocked: true,
        stage: "script",
        scene: loaded.def.name,
        issues: [],
        scriptIssues: [lifted.issue],
      },
      registry.game?.id ?? null,
    );
  const migratedFrom = lifted.from < INPUT_SCRIPT_VERSION ? lifted.from : undefined;
  script = lifted.script;
  if (at && script !== null && typeof script === "object" && !Array.isArray(script))
    script = { ...script, at };

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const run = runPlaytest({
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    script: script as InputScript,
    projectRef: projectRef(loaded.project),
    ...(ctx.rapierFlavour ? { platform: { flavour: ctx.rapierFlavour } } : {}),
  });
  const game = registry.game?.id ?? null;
  if (run.blocked) return blockedResult(run, game);
  if (input.record) await writeFile(input.record, `${JSON.stringify(run.recording)}\n`, "utf8");
  const runs = game ? `game ${game}` : "no game";
  const printed = eventsReport(run.events, run.truncated, types);
  return {
    exitCode: 0,
    data: {
      game,
      ...run,
      events: printed.events,
      ...(printed.lifecycle ? { lifecycle: printed.lifecycle } : {}),
      ...(migratedFrom === undefined ? {} : { scriptMigratedFrom: migratedFrom }),
    },
    text: reportText(run, runs, printed.lines, migratedFrom),
  };
};

function blockedResult(run: PlaytestBlocked, game: string | null): ToolResult {
  return { exitCode: 1, data: { ok: false, game, ...run }, text: blockedText(run) };
}
