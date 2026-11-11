import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LibraryScene, SceneLibrary } from "@jams/engine/game";
import {
  buildRefIndex,
  SCENE_LIST_KIND,
  SCENE_LIST_VERSION,
  sceneBundle,
  sceneListEntries,
  sceneListFlow,
  sceneListIssues,
  parseAssetDoc,
  type AssetEntry,
  type AssetId,
  type DocKindDef,
  type SceneListEntry,
} from "@jams/engine/project";
import { expandScene, scenePhysics, type SceneIssue } from "@jams/engine/scene";

import { inScope, issueLine, openScene, scopeError, type ToolContext, type Tool } from "../context";
import { projectRuntime, type ProjectHandle } from "../projects";
import { liveEntries, loadProject, type LoadedProject } from "./project-show";

type Opened = Extract<Awaited<ReturnType<typeof openScene>>, { ok: true }>;

/** A listed scene opened in its project, or null when the project has no scene that opens under its id. */
type ListedScene = { entry: SceneListEntry; opened: Opened | null };

type ListRead = {
  asset: AssetEntry | null;
  start: AssetId | null;
  scenes: readonly SceneListEntry[];
  /** What the kind says of the file: its schema, repeated entries and start (`parseAssetDoc`). */
  issues: SceneIssue[];
};

/**
 * The project's scene list in effect, read from its file: its start and
 * entries leniently (`sceneListFlow`), so a list its kind refuses still
 * shows what it names, beside the kind's issues.
 */
async function listOf(loaded: LoadedProject): Promise<ListRead> {
  const [asset] = sceneListEntries(loaded.view);
  const def = loaded.project.kinds.get(SCENE_LIST_KIND) as DocKindDef | undefined;
  if (!asset || !def) return { asset: null, start: null, scenes: [], issues: [] };
  let text: string;
  try {
    text = await readFile(join(loaded.project.dir, asset.path), "utf8");
  } catch {
    return { asset, start: null, scenes: [], issues: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = parseAssetDoc(def, text, loaded.env);
  return { asset, ...sceneListFlow(raw), issues: parsed.issues };
}

/** Each listed scene opened in `project` as `scene show` opens it: by its id, with its game's registry and its prefabs. */
async function openListed(
  ctx: ToolContext,
  project: ProjectHandle,
  scenes: readonly SceneListEntry[],
): Promise<ListedScene[]> {
  const inProject: ToolContext = { ...ctx, project: project.file.id };
  const out: ListedScene[] = [];
  for (const entry of scenes) {
    const opened = await openScene(inProject, entry.scene, "flow");
    out.push({ entry, opened: opened.ok ? opened : null });
  }
  return out;
}

/**
 * The scenes a run in `project` may load or attach, as a headless run's
 * `flow` takes them: the scene list in effect and every listed scene that
 * opens. A listed scene that doesn't open is left out, so a request for it
 * is refused as the run reaches it. Null when the project has no scene list.
 */
export async function projectSceneLibrary(
  ctx: ToolContext,
  project: ProjectHandle,
): Promise<SceneLibrary | null> {
  const list = await listOf(await loadProject(project));
  if (!list.asset) return null;
  const scenes = new Map<AssetId, LibraryScene>();
  for (const { entry, opened } of await openListed(ctx, project, list.scenes))
    if (opened) scenes.set(entry.scene, { def: opened.def, prefabs: opened.prefabs });
  return { list: list.scenes, scenes };
}

type SceneRow = {
  scene: AssetId;
  title?: string;
  sublevel?: true;
  start: boolean;
  /** The physics backend the scene resolves to; null when it doesn't open. */
  physics: "rapier" | "none" | null;
  /** The blobs it loads before it draws (`sceneBundle`); null when it doesn't open. */
  bundle: { blobs: number; bytes: number } | null;
};

type ProjectFlow = {
  project: string;
  /** The scene list in effect; null without one. */
  list: { id: AssetId; path: string } | null;
  start: AssetId | null;
  scenes: SceneRow[];
  /** The project's scenes the list doesn't name. */
  unlisted: AssetId[];
  /** The list's own issues (its start, entries naming no scene), the listed scenes' bundle issues, and every check naming a scene flow can't go to. */
  issues: SceneIssue[];
};

async function projectFlow(ctx: ToolContext, project: ProjectHandle): Promise<ProjectFlow> {
  const loaded = await loadProject(project);
  const list = await listOf(loaded);
  const sceneIds = liveEntries(loaded.view)
    .filter((e) => e.kind === "scene")
    .map((e) => e.id)
    .sort();
  const listed = new Set(list.scenes.map((e) => e.scene));
  const unlisted = sceneIds.filter((id) => !listed.has(id));
  if (!list.asset)
    return { project: project.file.id, list: null, start: null, scenes: [], unlisted, issues: [] };

  // Judged as read, so a list the kind refuses still has its references and checks judged.
  const listId = list.asset.id;
  const values = new Map(loaded.values).set(listId, {
    kind: SCENE_LIST_KIND,
    v: SCENE_LIST_VERSION,
    start: list.start,
    scenes: list.scenes,
  });
  const issues: SceneIssue[] = [
    ...list.issues,
    ...buildRefIndex(loaded.view, values, project.kinds, loaded.env)
      .dangling()
      .filter((i) => i.entityIds[0] === listId),
  ];

  const engine = (await projectRuntime(project, loaded.registry)).engine;
  const rows: SceneRow[] = [];
  for (const { entry, opened } of await openListed(ctx, project, list.scenes)) {
    const row: SceneRow = {
      scene: entry.scene,
      ...(entry.title !== undefined ? { title: entry.title } : {}),
      ...(entry.sublevel ? { sublevel: true as const } : {}),
      start: entry.scene === list.start,
      physics: null,
      bundle: null,
    };
    if (opened) {
      const { def: scene, registry, prefabs } = opened;
      row.physics = scenePhysics(scene, registry, engine);
      const expanded = expandScene(scene, registry, { prefabs });
      const built = sceneBundle(expanded, scene, prefabs, loaded.view, project.kinds, registry);
      row.bundle = { blobs: built.bundle.entries.length, bytes: built.bundle.bytes };
      issues.push(...built.issues);
    }
    rows.push(row);
  }
  issues.push(...sceneListIssues(loaded.view, values));
  return {
    project: project.file.id,
    list: { id: list.asset.id, path: list.asset.path },
    start: list.start,
    scenes: rows,
    unlisted,
    issues,
  };
}

function rowLine(row: SceneRow): string {
  const tags = [row.start ? "start" : null, row.sublevel ? "sublevel" : null].filter(Boolean);
  const body =
    row.bundle === null
      ? "doesn't open"
      : `physics ${row.physics}  bundle ${row.bundle.blobs} ${row.bundle.blobs === 1 ? "blob" : "blobs"} ${row.bundle.bytes} B`;
  return [
    `  ${row.scene}`,
    ...(tags.length > 0 ? [tags.join(" ")] : []),
    body,
    ...(row.title !== undefined ? [JSON.stringify(row.title)] : []),
  ].join("  ");
}

function flowText(f: ProjectFlow): string[] {
  if (!f.list) return [`${f.project}: no scene list`];
  return [
    `${f.project}: scene list ${f.list.path}, start ${f.start ?? "(none)"}, ${f.scenes.length} listed`,
    ...f.scenes.map(rowLine),
    ...(f.unlisted.length > 0 ? [`  not listed: ${f.unlisted.join(", ")}`] : []),
    ...f.issues.map(issueLine),
  ];
}

/**
 * The scene list of each project in scope: its start, each listed scene's
 * physics (`scenePhysics`) and bundle bytes (`sceneBundle`), the scenes it
 * leaves out, and its issues: the list's own (`start-scene-missing`, an
 * entry naming no scene) and every check that names a scene flow can't go
 * to (`scene-unlisted`, through `flowIssue`). Exit 1 on an error.
 */
export const flow: Tool<Record<string, never>> = async (_input, ctx) => {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const projects: ProjectFlow[] = [];
  for (const project of inScope(ctx)) projects.push(await projectFlow(ctx, project));
  const errors = projects.some((p) => p.issues.some((i) => i.severity === "error"));
  return {
    exitCode: errors ? 1 : 0,
    data: { ok: !errors, projects },
    text: projects.flatMap(flowText).join("\n"),
  };
};
