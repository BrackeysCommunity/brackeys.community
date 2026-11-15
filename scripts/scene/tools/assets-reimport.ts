import { docNameOf } from "@jams/engine/project";
import { createProjectFileAdapter, type ProjectFileAdapter } from "@jams/engine/vite";
import * as Y from "yjs";

import {
  failure,
  inScope,
  issueLine,
  plural,
  scopeError,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { locateInProjects, type ProjectHandle } from "../projects";
import { fileProjectView, type WriterFlags } from "./assets-apply";
import { loadProject } from "./project-show";

export type AssetsReimportInput = WriterFlags & { ids?: readonly string[]; all?: boolean };

const USAGE = "scene assets reimport <id...> | --all [--dry-run] [--project id]";

type Reinspected = Awaited<ReturnType<ProjectFileAdapter["reinspectSidecars"]>>[number];

/** The projects the ids are in, each with its ids in the order given. */
async function projectsOf(
  ctx: ToolContext,
  ids: readonly string[],
): Promise<Map<ProjectHandle, string[]> | ToolResult> {
  const out = new Map<ProjectHandle, string[]>();
  for (const id of ids) {
    const found = await locateInProjects(
      ctx.projects,
      id,
      async (p) => {
        const entry = (await fileProjectView(p)).byId.get(id);
        return entry !== undefined && p.kinds.get(entry.kind)?.storage === "blob";
      },
      ctx.project,
    );
    if (!found.ok) {
      if (found.exitCode === 2) return usage(found.message);
      return failure(
        `No project has a binary asset ${JSON.stringify(id)}; only binaries have meta.`,
        {
          id,
        },
      );
    }
    const held = out.get(found.project) ?? [];
    if (!held.includes(id)) held.push(id);
    out.set(found.project, held);
  }
  return out;
}

/** Runs `reinspectSidecars` over one project's files, then keeps the dev cache's registry in step. */
async function reimportIn(
  project: ProjectHandle,
  ids: readonly string[] | undefined,
  dryRun: boolean,
): Promise<Reinspected[]> {
  const loaded = await loadProject(project);
  const adapter = createProjectFileAdapter({ ...project, registry: loaded.registry });
  const doc = new Y.Doc();
  try {
    await adapter.loadProject(doc);
    const done = await adapter.reinspectSidecars(doc, { ...(ids ? { ids } : {}), dryRun });
    if (!dryRun && done.some((r) => r.meta || r.sidecar))
      await adapter.persist(docNameOf({ kind: "project", project: project.file.id }), doc);
    return done;
  } finally {
    doc.destroy();
  }
}

function line(project: string, r: Reinspected, dryRun: boolean): string {
  if (r.issue) return `${project}: ${r.id} (${r.path}) can't be inspected\n  ${issueLine(r.issue)}`;
  const moved = r.meta || r.sidecar;
  const verb = moved ? (dryRun ? "would rewrite" : "rewrote") : "already current:";
  const version = r.from === r.to ? `meta v${r.to}` : `meta v${r.from} → v${r.to}`;
  return `${project}: ${verb} ${r.id} (${r.path}, ${version})`;
}

/**
 * Inspects binary assets' bytes again and rewrites only their sidecars' meta
 * and meta version, the way the dev watcher does: the ids given, or with
 * `--all` every one whose sidecar records an older meta version than its
 * kind's. Writes the project's files; `--dry-run` writes nothing.
 */
export const assetsReimport: Tool<AssetsReimportInput> = async (input, ctx) => {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const ids = input.ids ?? [];
  if (ids.length === 0 && !input.all) return usage(USAGE);
  if (ids.length > 0 && input.all) return usage(`give ids or --all, not both (${USAGE})`);
  if (input.live || input.url !== undefined || input.token !== undefined)
    return usage(
      "reimport writes the project's files; a running dev server re-inspects stale sidecars itself",
    );
  const unused = (["base", "agent", "onBehalfOf"] as const).find((f) => input[f] !== undefined);
  if (unused)
    return usage(`reimport takes no --${unused === "onBehalfOf" ? "on-behalf-of" : unused}`);
  const dryRun = input.dryRun === true;

  let targets: Map<ProjectHandle, string[] | undefined>;
  if (ids.length > 0) {
    const located = await projectsOf(ctx, ids);
    if (!(located instanceof Map)) return located;
    targets = located;
  } else targets = new Map(inScope(ctx).map((p) => [p, undefined]));

  const projects: { project: string; reinspected: Reinspected[] }[] = [];
  const lines: string[] = [];
  for (const [project, named] of targets) {
    const reinspected = await reimportIn(project, named, dryRun);
    projects.push({ project: project.file.id, reinspected });
    if (reinspected.length === 0) lines.push(`${project.file.id}: every sidecar's meta is current`);
    for (const r of reinspected) lines.push(line(project.file.id, r, dryRun));
  }
  const failed = projects.flatMap((p) => p.reinspected).filter((r) => r.issue);
  const rewritten = projects.flatMap((p) => p.reinspected).filter((r) => r.meta || r.sidecar);
  if (projects.length > 1 || rewritten.length > 1)
    lines.push(
      `${dryRun ? "would rewrite" : "rewrote"} ${plural(rewritten.length, "sidecar")}` +
        (failed.length > 0 ? `; ${plural(failed.length, "asset")} failed` : ""),
    );
  return {
    exitCode: failed.length > 0 ? 1 : 0,
    data: { ok: failed.length === 0, dryRun, written: !dryRun && rewritten.length > 0, projects },
    text: lines.join("\n"),
  };
};
