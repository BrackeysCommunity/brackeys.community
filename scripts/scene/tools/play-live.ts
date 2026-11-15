import type { LiveErrorCode, LiveResponse } from "@jams/engine/collab";
import { makeIssue, type SceneIssue } from "@jams/engine/scene";

import {
  failure,
  hostedOptions,
  issueLine,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import {
  DEFAULT_PROJECT_URL,
  liveRequest,
  ProjectClientError,
  type LiveAsk,
} from "../project-client";

export const PLAY_LIVE_ACTIONS = ["play", "pause", "resume", "step", "stop", "state"] as const;
export type PlayLiveAction = (typeof PLAY_LIVE_ACTIONS)[number];

export type PlayLiveInput = {
  scene?: string;
  live: boolean;
  /** One of `PLAY_LIVE_ACTIONS`, unchecked. */
  action?: string;
  ticks?: string;
  url?: string;
  token?: string;
  /** How long the editor has to answer; default `LIVE_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
};

export const PLAY_LIVE_USAGE = `play <scene> --live ${PLAY_LIVE_ACTIONS.join("|")} [--ticks n] [--url ws://…|https://site [--token t]]`;

const MAX_STEP_TICKS = 60 * 60 * 10;

/** A live request's outcome: the editor's answer, or why none came, as an issue. */
export type LiveOutcome =
  | { ok: true; response: LiveResponse & { ok: true }; project: string }
  | { ok: false; issue: SceneIssue; result?: ToolResult };

/**
 * Asks the editor that has `scene` open. A server that can't be reached
 * counts as no editor answering; a usage error (`--project`, a site URL
 * over http) comes back as `result`.
 */
export async function askEditor(
  ctx: ToolContext,
  input: { scene: string; url?: string; token?: string; timeoutMs?: number },
  ask: LiveAsk,
): Promise<LiveOutcome> {
  const url = input.url ?? DEFAULT_PROJECT_URL;
  try {
    const { response, project } = await liveRequest({
      projects: ctx.projects,
      url,
      project: ctx.project,
      scene: input.scene,
      ask,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...hostedOptions(ctx, input.token),
    });
    if (response.ok) return { ok: true, response, project };
    return { ok: false, issue: liveIssue(response.code, response.message) };
  } catch (e) {
    if (!(e instanceof ProjectClientError)) throw e;
    if (e.exitCode === 2)
      return { ok: false, issue: liveIssue("live-no-editor", e.message), result: usage(e.message) };
    return { ok: false, issue: liveIssue("live-no-editor", e.message) };
  }
}

export const liveIssue = (code: LiveErrorCode, message: string): SceneIssue =>
  makeIssue(code, { message });

/** A live call that got no answer it could use: exit 1, with the issue. */
export function liveFailure(scene: string, issue: SceneIssue): ToolResult {
  return {
    exitCode: 1,
    data: { ok: false, scene, error: issue.message, issues: [issue] },
    text: [`${scene}: ${issue.code}`, issueLine(issue)].join("\n"),
  };
}

function parseTicks(text: string): number | null {
  const n = Number(text);
  return /^\d+$/.test(text) && n >= 1 && n <= MAX_STEP_TICKS ? n : null;
}

function stateText(scene: string, r: LiveResponse & { t: "state"; ok: true }): string {
  const s = r.store;
  const lines = [
    `${scene}: ${s ? `${s.mode} ${s.phase} at t${s.tick}` : "state"}`,
    ...(r.entities ? [`  entities ${r.entities.length}`] : []),
    ...(r.events ? [`  events ${r.events.length}`] : []),
  ];
  const t = r.timings;
  if (t) {
    lines.push(`  timings over ${t.ticks} ticks (mean / worst ms)`);
    for (const [phase, stat] of Object.entries(t.phases))
      lines.push(`    ${phase} ${stat.mean} / ${stat.max}`);
  } else if (r.timings === null) lines.push("  timings off");
  return lines.join("\n");
}

/** Drives the open editor's Play over the scene's live channel, or reads its state. */
export const playLive: Tool<PlayLiveInput> = async (input, ctx) => {
  if (!input.scene || !input.action) return usage(`scene ${PLAY_LIVE_USAGE}`);
  if (!input.live)
    return usage(
      "scene play drives the open editor's Play and needs --live; run a scene headless with scene step or playtest",
    );
  const action = input.action as PlayLiveAction;
  if (!PLAY_LIVE_ACTIONS.includes(action))
    return usage(`unknown play action "${input.action}": one of ${PLAY_LIVE_ACTIONS.join(", ")}`);
  let ticks: number | undefined;
  if (input.ticks !== undefined) {
    if (action !== "step") return usage("--ticks goes with step");
    const n = parseTicks(input.ticks);
    if (n === null)
      return usage(`--ticks takes a whole number from 1 to ${MAX_STEP_TICKS}: ${input.ticks}`);
    ticks = n;
  }
  const scene = input.scene;
  const ask: LiveAsk =
    action === "state"
      ? { t: "state", select: ["store", "entities", "events", "timings"] }
      : { t: "play", action, ...(ticks === undefined ? {} : { ticks }) };
  const asked = await askEditor(ctx, { ...input, scene }, ask);
  if (!asked.ok) return asked.result ?? liveFailure(scene, asked.issue);
  const { response, project } = asked;
  if (response.t === "state") {
    return {
      exitCode: 0,
      data: { ok: true, scene, project, action, ...stripEnvelope(response) },
      text: stateText(scene, response),
    };
  }
  if (response.t !== "play") return failure(`The editor answered a ${response.t} request.`);
  return {
    exitCode: 0,
    data: { ok: true, scene, project, action, ...stripEnvelope(response) },
    text: `${scene}: ${action}${ticks === undefined ? "" : ` ${ticks}`}: ${response.phase} at t${response.tick}${response.outcome ? ` (${JSON.stringify(response.outcome)})` : ""}`,
  };
};

function stripEnvelope<R extends { t: string; id: string; ok: boolean }>(
  r: R,
): Omit<R, "t" | "id" | "ok"> {
  const { t: _t, id: _id, ok: _ok, ...rest } = r;
  return rest;
}
