import type { AssetEntry, ProjectView } from "@jams/engine/project";

import {
  failure,
  hostedOptions,
  inScope,
  scopeError,
  usage,
  type Tool,
  type ToolResult,
} from "../context";
import { DEFAULT_PROJECT_URL, openLiveProject, ProjectClientError } from "../project-client";
import { fileProjectView } from "./assets-apply";

export type AssetsListInput = {
  kind?: string;
  /** List the trash instead of the live assets. */
  trash?: boolean;
  live?: boolean;
  url?: string;
  /** A hosted project's agent token; `JAMS_AGENT_TOKEN` when left out. */
  token?: string;
  timeoutMs?: number;
};

type Row = {
  project: string;
  id: string;
  kind: string;
  path: string;
  key: string;
  name?: string;
  bytes?: number;
  sha256?: string;
  deleted?: AssetEntry["deleted"];
};

function rows(project: string, view: ProjectView, input: AssetsListInput): Row[] {
  const entries = input.trash ? view.deleted : [...view.byId.values()];
  return entries
    .filter((e) => input.kind === undefined || e.kind === input.kind)
    .map((e) => ({
      project,
      id: e.id,
      kind: e.kind,
      path: e.path,
      key: e.key,
      ...(e.name === undefined ? {} : { name: e.name }),
      ...(e.bytes === undefined ? {} : { bytes: e.bytes }),
      ...(e.sha256 === undefined ? {} : { sha256: e.sha256 }),
      ...(e.deleted === undefined ? {} : { deleted: e.deleted }),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function listed(all: Row[], input: AssetsListInput, extra: Record<string, unknown>): ToolResult {
  const lines = all.map(
    (r) =>
      `${r.project}  ${r.path}  ${r.kind} ${r.id}${r.name !== undefined ? ` "${r.name}"` : ""}${r.bytes !== undefined ? `  ${r.bytes} B` : ""}`,
  );
  return {
    exitCode: 0,
    data: { ok: true, ...extra, trash: input.trash === true, assets: all },
    text: lines.join("\n") || (input.trash ? "the trash is empty" : "no assets"),
  };
}

/**
 * Every live asset (or with `--trash`, every trashed one) of the projects in
 * scope, by path, from their files or with `--live` from the dev server.
 */
export const assetsList: Tool<AssetsListInput> = async (input, ctx) => {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  if (!input.live) {
    if (input.url !== undefined) return usage("--url needs --live");
    if (input.token !== undefined) return usage("--token needs --live");
    const views = await Promise.all(
      inScope(ctx).map(async (p) => rows(p.file.id, await fileProjectView(p), input)),
    );
    return listed(views.flat(), input, {});
  }
  const url = input.url ?? DEFAULT_PROJECT_URL;
  let live;
  try {
    live = await openLiveProject({
      projects: ctx.projects,
      url,
      project: ctx.project,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...hostedOptions(ctx, input.token),
    });
  } catch (e) {
    if (e instanceof ProjectClientError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message, { url });
    throw e;
  }
  try {
    return listed(rows(live.project.file.id, live.client.session.view(), input), input, {
      live: true,
      url,
    });
  } finally {
    await live.client.close().catch(() => undefined);
  }
};
