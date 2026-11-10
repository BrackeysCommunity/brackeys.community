import { replayRecording, type ReplayReport } from "@jams/engine/headless";

import {
  failure,
  gameFlag,
  isToolResult,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
} from "../context";
import { projectRuntime } from "../projects";
import { blockedText } from "./playtest";
import { rapierFor, rounded } from "./step";

export type ReplayInput = { scene?: string; run?: string; game?: string };

const USAGE = "replay <scene|file|-> --run <file|-> [--game id]";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function reportText(scene: string, r: ReplayReport): string {
  const o = r.recording.outcome;
  return [
    `${scene}: ${r.matches ? "replays" : "diverges"}: ${o.result} at t${o.tick} (${r.recording.ticks} ticks)${r.divergence ? `: ${r.divergence}` : ""}`,
    ...r.warnings.map((w) => `  warning ${w}`),
    `  final ${rounded(r.final)}`,
  ].join("\n");
}

/**
 * Replays a run recording (or the `recording` of a `playtest --json` report)
 * on a scene headless. Exit 1 when it doesn't end the way it was recorded;
 * a stale scene is a warning.
 */
export const replay: Tool<ReplayInput> = async (input, ctx) => {
  if (!input.run) return usage(`scene ${USAGE}`);
  if (input.scene === "-" && input.run === "-")
    return usage("only one of the scene and --run can be read from stdin");

  const under = input.game === undefined ? undefined : gameFlag(ctx, input.game);
  if (isToolResult(under)) return under;
  const loaded = await openScene(ctx, input.scene, USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;

  let json: unknown;
  try {
    json = JSON.parse(await readArg(ctx, input.run));
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.run}.`);
    return failure(`The run is not JSON: ${(e as Error).message}.`);
  }
  const recording = isRecord(json) && json.blocked === false ? json.recording : json;

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const run = replayRecording({
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    recording,
  });
  const game = registry.game?.id ?? null;
  if (run.blocked)
    return { exitCode: 1, data: { ok: false, game, ...run }, text: blockedText(run) };
  return {
    exitCode: run.matches ? 0 : 1,
    data: { game, ...run },
    text: reportText(loaded.def.name, run),
  };
};
