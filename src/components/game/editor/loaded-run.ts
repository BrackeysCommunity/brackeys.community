import type { PlayOptions } from "@jams/engine";
import { parseRecording, type RunRecording, type SceneOverlay } from "@jams/engine/scene";
import { Store } from "@tanstack/store";

export type LoadedRun = {
  recording: RunRecording;
  /** The file name, "pasted", or "Last run" for the editor's own last Play. */
  name: string;
};

export function createLoadedRunStore(): Store<LoadedRun | null> {
  return new Store<LoadedRun | null>(null);
}

/** What the canvas layer draws for a loaded run: its trail, markers and outcome. */
export function runOverlay(run: LoadedRun): SceneOverlay {
  const { trail, markers, outcome } = run.recording;
  return {
    trail: trail?.pts ?? [],
    events: markers.map((m) => ({
      type: m.type,
      at: m.at,
      tick: m.tick,
      ...(m.entityId !== undefined ? { entityId: m.entityId } : {}),
    })),
    outcome: {
      result: outcome.result,
      at: outcome.at,
      tick: outcome.tick,
      ...(outcome.cause !== undefined ? { cause: outcome.cause } : {}),
    },
  };
}

/** How the run's play world started, for playing it live from the same start. */
export function runStart(run: LoadedRun): PlayOptions {
  const { at, timeOffsetMs, game } = run.recording.start;
  const opts: PlayOptions = {};
  if (at) opts.at = { x: at[0], y: at[1] };
  if (timeOffsetMs !== undefined) opts.timeOffsetMs = timeOffsetMs;
  if (game !== undefined) opts.game = game;
  return opts;
}

const STAGE_WHY: Record<string, string> = {
  script: "its input script didn't compile",
  scene: "the scene had errors",
  load: "the scene didn't load",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export type ParsedRun = { ok: true; run: LoadedRun } | { ok: false; error: string };

/**
 * A run recording, or a playtest report that carries one (as `scene
 * playtest --json` prints it), from a file or pasted. A blocked run never
 * played, so it has nothing to show: the error says why.
 */
export function parseRun(text: string, name: string): ParsedRun {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "That isn't JSON. Paste a recording or what `scene playtest --json` prints.",
    };
  }
  if (isRecord(json) && json.blocked === true) {
    const issues = [json.scriptIssues, json.issues].flatMap((list) =>
      Array.isArray(list) ? list.filter(isRecord) : [],
    );
    const first = issues.find((i) => typeof i.message === "string")?.message as string | undefined;
    const why = STAGE_WHY[String(json.stage)] ?? "it was blocked";
    return { ok: false, error: `That run never played: ${why}${first ? ` (${first})` : ""}.` };
  }
  const candidate = isRecord(json) && json.blocked === false ? json.recording : json;
  const parsed = parseRecording(candidate);
  if (!parsed.ok) {
    const issue = parsed.issues[0];
    const where = issue?.path ? ` at ${issue.path}` : "";
    return {
      ok: false,
      error: `That isn't a run recording${where}: ${issue?.message ?? "unexpected shape"}.`,
    };
  }
  return { ok: true, run: { recording: parsed.recording, name } };
}

/** Whether the run was recorded on a different version of the scene than `hash`. */
export function runIsStale(run: LoadedRun, hash: string): boolean {
  return run.recording.sceneHash !== hash;
}
