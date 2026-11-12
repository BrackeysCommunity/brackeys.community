import {
  parseRecording,
  replayRecording,
  type RecordingPlatform,
  type ReplayReport,
  type RunRecording,
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
} from "../context";
import { projectRuntime } from "../projects";
import { blockedText, projectRef } from "./playtest";
import { projectSaveFixtures } from "./save";
import { rapierFor, rounded } from "./step";

export type ReplayInput = { scene?: string; run?: string; game?: string };

const USAGE = "replay <scene|file|-> --run <file|-> [--game id] [--releases <dir>]";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Where and on what a recording was made, as its file says. */
export type Recorded = Pick<RunRecording, "engine" | "platform">;

/** `arm64, node 22.1.0, rapier2d-compat`; a platform a v1 recording never named reads `unknown`. */
const platformText = (p: RecordingPlatform) =>
  p.arch === "unknown" && p.runtime === "unknown"
    ? "unknown"
    : [p.arch, p.runtime, ...(p.flavour ? [p.flavour] : [])].join(", ");

/** A replay's text: how it ended, what it was recorded on, its warnings and issues. */
export function replayText(scene: string, r: ReplayReport, recorded: Recorded | null): string {
  const o = r.recording.outcome;
  return [
    `${scene}: ${r.matches ? "replays" : "diverges"}: ${o.result} at t${o.tick} (${r.recording.ticks} ticks)${r.divergence ? `: ${r.divergence}` : ""}`,
    ...(recorded
      ? [
          `  recorded on engine ${recorded.engine.version}, physics ${recorded.engine.physics ?? "none"}${r.migratedFrom === undefined ? "" : `; migratedFrom ${r.migratedFrom}`}`,
          `  platform recorded ${platformText(recorded.platform)}; replayed ${platformText(r.recording.platform)}`,
        ]
      : []),
    ...r.warnings.map((w) => `  warning ${w}`),
    ...r.issues.map(issueLine),
    `  final ${rounded(r.final)}`,
  ].join("\n");
}

/**
 * Replays a run recording, v1 or v2 (or the `recording` of a `playtest
 * --json` report), on a scene headless, and says what it was recorded on:
 * the engine version and physics, the platform beside this one, and the
 * format a v1 file was migrated from. Exit 1 when it doesn't end the way it
 * was recorded; a stale scene or another platform is a warning.
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
  const saves = loaded.project ? await projectSaveFixtures(loaded.project) : undefined;
  const run = replayRecording({
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    recording,
    projectRef: projectRef(loaded.project),
    ...(saves ? { saves } : {}),
    ...(ctx.rapierFlavour ? { platform: { flavour: ctx.rapierFlavour } } : {}),
  });
  const game = registry.game?.id ?? null;
  if (run.blocked)
    return { exitCode: 1, data: { ok: false, game, ...run }, text: blockedText(run) };
  const read = parseRecording(recording, registry);
  const recorded: Recorded | null = read.ok
    ? { engine: read.recording.engine, platform: read.recording.platform }
    : null;
  return {
    exitCode: run.matches ? 0 : 1,
    data: { game, ...run, ...(recorded ? { recorded } : {}) },
    text: replayText(loaded.def.name, run, recorded),
  };
};
