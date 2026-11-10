import { writeFile } from "node:fs/promises";

import {
  runPlaytest,
  type InputScript,
  type PlaytestBlocked,
  type PlaytestReport,
} from "@jams/engine/headless";

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
import { projectRuntime } from "../projects";
import { rapierFor, rounded } from "./step";

export type PlaytestInput = {
  scene?: string;
  script?: string;
  at?: string;
  game?: string;
  /** Writes the run's recording here, for `replay` and the editor's Load run. */
  record?: string;
};

const USAGE = "playtest <scene|file|-> --script <file|-> [--at x,y] [--game id] [--record file]";

/** `x,y` as two finite numbers, or null. */
export function parsePoint(text: string): [number, number] | null {
  const parts = text.split(",").map((p) => (p.trim() === "" ? Number.NaN : Number(p)));
  return parts.length === 2 && parts.every(Number.isFinite) ? (parts as [number, number]) : null;
}

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

function reportText(r: PlaytestReport, runs: string): string {
  const o = r.outcome;
  return [
    `${r.scene} ${r.sceneHash} ${runs} config ${r.configHash}: ${o.result} at t${o.tick} (${r.ticks} ticks)${o.cause ? `: ${o.cause}` : ""}`,
    ...(o.at ? [`  at ${rounded([o.at.x, o.at.y])}`] : []),
    ...r.steps.map((s) => `  step ${s.index} t${s.start} +${s.ticks} ${s.end}`),
    `  final ${rounded(r.final)}`,
    ...r.events.map(
      (e) =>
        `  t${e.tick} ${e.type}${e.entityId ? ` ${e.entityId}` : ""}${e.other ? ` (${e.other})` : ""}`,
    ),
    ...(r.truncated ? ["  (events truncated)"] : []),
  ].join("\n");
}

/** Plays an input script on a scene headless and reports how the run ended. */
export const playtest: Tool<PlaytestInput> = async (input, ctx) => {
  if (!input.script) return usage(`scene ${USAGE}`);
  if (input.scene === "-" && input.script === "-")
    return usage("only one of the scene and --script can be read from stdin");
  let at: [number, number] | undefined;
  if (input.at !== undefined) {
    const point = parsePoint(input.at);
    if (!point) return usage("--at takes x,y in world pixels, e.g. --at 640,900");
    at = point;
  }

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
  });
  const game = registry.game?.id ?? null;
  if (run.blocked) return blockedResult(run, game);
  if (input.record) await writeFile(input.record, `${JSON.stringify(run.recording)}\n`, "utf8");
  const runs = game ? `game ${game}` : "no game";
  return { exitCode: 0, data: { game, ...run }, text: reportText(run, runs) };
};

function blockedResult(run: PlaytestBlocked, game: string | null): ToolResult {
  return { exitCode: 1, data: { ok: false, game, ...run }, text: blockedText(run) };
}
