import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Registry } from "@jams/engine/game";
import {
  dataTableIssues,
  formatAssetDoc,
  inputMapEntries,
  kindInputMap,
  parseAssetDoc,
  projectUsage,
  projectView,
  sceneListIssues,
  type AssetEntry,
  type AssetId,
  type AssetKey,
  type AssetKindName,
  type CodeModuleInfo,
  type KindEnv,
  type ProjectState,
  type ProjectUsage,
  type ProjectView,
} from "@jams/engine/project";
import { closest, type SceneIssue } from "@jams/engine/scene";
import {
  codeModules as fileCodeModules,
  type ProjectProblem as FileProblem,
} from "@jams/engine/vite";

import { issueLine, prefabLookup, prefabsOf, usage, type ToolResult } from "../context";
import { overlayMaterials, projectById, scanProject, type ProjectHandle } from "../projects";

/** What the project tools read: the discovered projects. */
export type ProjectToolContext = { projects: readonly ProjectHandle[] };

/** A project read from its files, the way the dev server's adapter reads them. */
export type LoadedProject = {
  project: ProjectHandle;
  /** The scan's state, with the code modules the project file's `code` globs name. */
  state: ProjectState;
  /** Files that don't parse, sidecars without an asset, ids a file can't give. */
  problems: FileProblem[];
  view: ProjectView;
  /** The project's registry with its material assets overlaid. */
  registry: Registry;
  env: KindEnv;
  /** Each live doc asset's parsed value, by id; a doc that doesn't parse is absent. */
  values: Map<AssetId, unknown>;
  /** Each live doc asset's canonical text, by id; absent where `values` is. */
  texts: Map<AssetId, string>;
  /** Each doc asset's file size in bytes, by key. */
  fileBytes: Map<AssetKey, number>;
};

/**
 * The project's code modules: files under its directory matching the
 * project file's `code` globs (`!` globs and `ignore` exclude), by
 * project-relative path, as the dev server lists them.
 */
export function codeModules(project: ProjectHandle): Promise<Record<string, CodeModuleInfo>> {
  return fileCodeModules(project);
}

/**
 * Reads a project from its files: the adapter's scan, then each live doc
 * asset parsed and formatted. The material assets on disk now are
 * overlaid onto the registry first, so scenes naming them parse.
 */
export async function loadProject(project: ProjectHandle): Promise<LoadedProject> {
  let scan = await scanProject(project);
  const registry = await overlayMaterials(project, project.registry, scan);
  if (registry !== project.registry) scan = await scanProject(project, registry);

  const state: ProjectState = { ...scan.state, code: await codeModules(project) };
  const view = projectView(state, project.kinds);
  const env: KindEnv = {
    registry,
    project: view,
    prefab: prefabLookup(await prefabsOf({ project }, registry, scan)),
  };
  const values = new Map<AssetId, unknown>();
  const texts = new Map<AssetId, string>();
  const fileBytes = new Map<AssetKey, number>();
  const read = async (entry: AssetEntry) => {
    const def = project.kinds.get(entry.kind);
    if (entry.deleted !== undefined || def?.storage !== "doc") return;
    let text: string;
    try {
      text = await readFile(join(project.dir, entry.path), "utf8");
    } catch {
      return;
    }
    fileBytes.set(entry.key, Buffer.byteLength(text, "utf8"));
    if (view.byId.get(entry.id)?.key !== entry.key) return;
    const parsed = parseAssetDoc(def, text, env);
    if (!parsed.ok) return;
    values.set(entry.id, parsed.value);
    texts.set(entry.id, formatAssetDoc(def, parsed.value));
  };
  // Input scripts are judged against the map's seats, so the map is read first.
  const [mapEntry] = inputMapEntries(view);
  if (mapEntry) await read(mapEntry);
  env.inputMap = kindInputMap(view, (id) => values.get(id), registry);
  for (const entry of view.byKey.values()) {
    if (entry !== mapEntry) await read(entry);
  }
  return { project, state, problems: scan.problems, view, registry, env, values, texts, fileBytes };
}

const projectIds = (ctx: ProjectToolContext) => ctx.projects.map((p) => p.file.id);

/** The project `id` names, or the only one when `id` is omitted; else a usage error naming the projects. */
export function pickProject(
  ctx: ProjectToolContext,
  id: string | undefined,
  cmd: string,
): ProjectHandle | ToolResult {
  const known = projectIds(ctx);
  const list = `(projects: ${known.join(", ") || "none"})`;
  if (id === undefined) {
    const [only, ...rest] = ctx.projects;
    if (only && rest.length === 0) return only;
    return usage(`project ${cmd} <project> ${list}`);
  }
  const found = projectById(ctx.projects, id);
  if (found) return found;
  const guess = closest(id, known);
  return usage(
    `project ${cmd}: no project ${JSON.stringify(id)}${guess ? `; did you mean "${guess}"?` : ""} ${list}`,
  );
}

export const isHandle = (v: ProjectHandle | ToolResult): v is ProjectHandle => "file" in v;

/** Live assets per kind, kinds sorted. */
export function countByKind(entries: Iterable<AssetEntry>): Record<AssetKindName, number> {
  const counts: Record<AssetKindName, number> = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Live entries: every entry not in the trash, duplicated ids included. */
export const liveEntries = (view: ProjectView): AssetEntry[] =>
  Object.values(view.state.assets).filter((e) => e.deleted === undefined);

export function problemLines(problems: readonly FileProblem[], issues: readonly SceneIssue[]) {
  return [
    ...problems.flatMap((p) => [`  ${p.path}`, ...p.issues.map((i) => `  ${issueLine(i)}`)]),
    ...issues.map(issueLine),
  ];
}

export type ProjectShowInput = { project?: string };

/**
 * A project's summary: its id, name and game, live assets by kind, code
 * modules, what its files fail on, and its storage usage. Doc bytes are
 * the files' sizes, the closest a checkout has to stored doc state.
 */
export async function projectShow(
  input: ProjectShowInput,
  ctx: ProjectToolContext,
): Promise<ToolResult> {
  const picked = pickProject(ctx, input.project, "show");
  if (!isHandle(picked)) return picked;
  const loaded = await loadProject(picked);
  const { view, problems, project } = loaded;
  const live = liveEntries(view);
  const usageReport: ProjectUsage = projectUsage(view, loaded.fileBytes);
  const issues = [
    ...view.issues,
    ...dataTableIssues(view, loaded.values),
    ...sceneListIssues(view, loaded.values),
  ];
  const counts = countByKind(live);
  const code = Object.keys(view.state.code).length;
  const data = {
    ok: true,
    project: project.file.id,
    name: project.file.name,
    game: project.game?.id ?? null,
    dir: project.dir,
    assets: live.length,
    counts,
    deleted: view.deleted.length,
    code,
    problems,
    issues,
    usage: usageReport,
  };
  const u = usageReport;
  const kinds = Object.entries(counts)
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
  const found = problemLines(problems, issues);
  const lines = [
    `${data.project}  ${data.name}  game ${data.game ?? "(none)"}  ${project.dir}`,
    `assets ${live.length}${kinds ? `  ${kinds}` : ""}${view.deleted.length ? `  trashed ${view.deleted.length}` : ""}`,
    `code ${code} module${code === 1 ? "" : "s"}`,
    `usage docs ${u.docs} (${u.docBytes} B)  blobs ${u.blobs} (${u.blobBytes} B)  trash ${u.trashBytes} B`,
    found.length > 0 ? "problems:" : "problems: none",
    ...found,
  ];
  return { exitCode: 0, data, text: lines.join("\n") };
}
