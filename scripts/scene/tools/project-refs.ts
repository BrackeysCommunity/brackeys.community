import {
  buildRefIndex,
  type AssetEntry,
  type AssetId,
  type KindEnv,
  type ProjectView,
  type Referrer,
  type RefIndex,
  type RefSite,
} from "@jams/engine/project";
import { closest, type SceneIssue } from "@jams/engine/scene";

import { failure, hostedOptions, inScope, issueLine, usage, type ToolResult } from "../context";
import { DEFAULT_PROJECT_URL, openLiveProject, readLiveValues } from "../project-client";
import { locateInProjects, type ProjectHandle } from "../projects";
import { loadProject, pickProject, isHandle } from "./project-show";
import {
  liveFailure,
  liveFlagsError,
  type LiveReadFlags,
  type LiveToolContext,
} from "./project-tree";

export type ProjectRefsInput = LiveReadFlags & {
  /** The asset whose references to report; omitted, the project's dangling references alone. */
  id?: string;
  project?: string;
};

type Indexed = { project: string; view: ProjectView; index: RefIndex };

/** A reference out of the asset, with what it resolves to; `target` is null when it dangles. */
type Target = RefSite & { target: Pick<AssetEntry, "id" | "kind" | "path"> | null };

const summary = (e: AssetEntry) => ({ id: e.id, kind: e.kind, path: e.path, key: e.key });

async function indexed(project: ProjectHandle): Promise<Indexed> {
  const loaded = await loadProject(project);
  return {
    project: project.file.id,
    view: loaded.view,
    index: buildRefIndex(loaded.view, loaded.values, project.kinds, loaded.env),
  };
}

const holds = (view: ProjectView, id: AssetId) =>
  view.byId.has(id) || view.deleted.some((e) => e.id === id);

/** Whether the project knows `id`: a live or trashed asset has it, or a reference names it. */
const knows = ({ view, index }: Indexed, id: AssetId) =>
  holds(view, id) || index.referrers(id).length > 0;

const touches = (issue: SceneIssue, id: AssetId) =>
  issue.entityIds.includes(id) || issue.got === id;

const hasErrors = (issues: readonly SceneIssue[]) => issues.some((i) => i.severity === "error");

function resolveTarget(view: ProjectView, site: RefSite): Target {
  const live = view.byId.get(site.id);
  const fits = live && (site.kinds.length === 0 || site.kinds.includes(live.kind));
  return {
    ...site,
    target: fits ? { id: live.id, kind: live.kind, path: live.path } : null,
  };
}

/** The project's dangling references, exit 1 when there are any. */
function danglingReport({ project, index }: Indexed, extra: Record<string, unknown>): ToolResult {
  const dangling = [...index.dangling()];
  return {
    exitCode: hasErrors(dangling) ? 1 : 0,
    data: { ok: true, project, ...extra, dangling },
    text:
      dangling.length > 0
        ? [`${project}: ${dangling.length} dangling`, ...dangling.map(issueLine)].join("\n")
        : `${project}: no dangling references`,
  };
}

function idReport(
  { project, view, index }: Indexed,
  id: AssetId,
  extra: Record<string, unknown>,
): ToolResult {
  const live = view.byId.get(id);
  const trashed = live ? undefined : view.deleted.find((e) => e.id === id);
  const entry = live ?? trashed;
  const targets = index.targets(id).map((site) => resolveTarget(view, site));
  const referrers: readonly Referrer[] = index.referrers(id);
  const dangling = index.dangling().filter((i) => touches(i, id));
  const data = {
    ok: true,
    project,
    ...extra,
    id,
    asset: entry ? { ...summary(entry), deleted: trashed !== undefined } : null,
    targets,
    referrers,
    dangling,
  };
  const head = entry
    ? `${id}  ${entry.kind}  ${entry.path}${trashed ? "  (in the trash)" : ""}`
    : `${id}  (no asset; named by references)`;
  const lines = [head];
  lines.push(targets.length > 0 ? "names:" : "names: nothing");
  for (const t of targets)
    lines.push(
      `  ${t.pointer || "/"} -> ${t.id}${t.target ? ` (${t.target.kind}, ${t.target.path})` : " (missing)"}`,
    );
  lines.push(referrers.length > 0 ? "named by:" : "named by: nothing");
  for (const r of referrers) lines.push(`  ${r.id} (${r.kind}) at ${r.pointer || "/"}`);
  if (dangling.length > 0) lines.push("dangling:", ...dangling.map(issueLine));
  return { exitCode: hasErrors(dangling) ? 1 : 0, data, text: lines.join("\n") };
}

const unknownId = (id: AssetId, ids: readonly AssetId[], message: string) => {
  const guess = closest(id, ids);
  return failure(`${message}${guess ? ` Did you mean "${guess}"?` : ""}`, { id });
};

/**
 * References in a project: with an id, what that asset names and who names
 * it, plus the dangling references from or to it; without one, every
 * dangling reference in the project. An id is looked up across projects,
 * `--project` picking one when several hold it. With `--live`, the docs
 * are the dev server's (or a hosted project's), unsaved edits included.
 */
export async function projectRefs(
  input: ProjectRefsInput,
  ctx: LiveToolContext,
): Promise<ToolResult> {
  const flagged = liveFlagsError(input);
  if (flagged) return flagged;
  if (input.live) return liveRefs(input, ctx);
  if (input.id === undefined) {
    const picked = pickProject(ctx, input.project, "refs");
    if (!isHandle(picked)) return picked;
    return danglingReport(await indexed(picked), {});
  }
  const id = input.id;
  const cache = new Map<ProjectHandle, Promise<Indexed>>();
  const indexOf = (p: ProjectHandle) => {
    let hit = cache.get(p);
    if (!hit) cache.set(p, (hit = indexed(p)));
    return hit;
  };
  const found = await locateInProjects(
    ctx.projects,
    id,
    async (p) => knows(await indexOf(p), id),
    input.project,
  );
  if (found.ok) return idReport(await indexOf(found.project), id, {});
  if (found.exitCode === 2) return usage(found.message);
  const ids = (
    await Promise.all([...cache.values()].map(async (i) => [...(await i).view.byId.keys()]))
  ).flat();
  return unknownId(id, ids, found.message);
}

/**
 * `projectRefs` on the server's docs. With several projects in scope, an id
 * picks the one whose registry holds it (live or trashed); one only named
 * by references needs `--project`.
 */
async function liveRefs(input: ProjectRefsInput, ctx: LiveToolContext): Promise<ToolResult> {
  const url = input.url ?? DEFAULT_PROJECT_URL;
  const id = input.id;
  const scoped = inScope({ ...ctx, project: input.project });
  let live;
  try {
    live = await openLiveProject({
      projects: ctx.projects,
      url,
      project: input.project,
      ...(id === undefined || scoped.length <= 1
        ? {}
        : { find: { id, what: "asset", test: (view: ProjectView) => holds(view, id) } }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...hostedOptions(ctx, input.token),
    });
  } catch (e) {
    return liveFailure(e, url);
  }
  const extra = { live: true, url };
  try {
    const { session } = live.client;
    const view = session.view();
    const env: KindEnv = { registry: session.registry, project: view };
    const at: Indexed = {
      project: live.project.file.id,
      view,
      index: buildRefIndex(view, await readLiveValues(session), session.kinds, env),
    };
    if (id === undefined) return danglingReport(at, extra);
    if (!knows(at, id))
      return unknownId(
        id,
        [...view.byId.keys()],
        `Project "${at.project}" on ${url} has no asset or reference ${JSON.stringify(id)}.`,
      );
    return idReport(at, id, extra);
  } finally {
    await live.client.close().catch(() => undefined);
  }
}
