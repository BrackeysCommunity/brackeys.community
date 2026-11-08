import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  formatAssetDoc,
  parseAssetDoc,
  type AssetEntry,
  type DocKindDef,
  type KindEnv,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";

import {
  failure,
  inScope,
  issueLine,
  scopeError,
  usage,
  writeSceneText,
  type Tool,
  type ToolResult,
} from "../context";
import { locateInProjects, scanProject, type ProjectHandle } from "../projects";

export type FmtInput = { scene?: string; check?: boolean };

type DocAsset = { project: ProjectHandle; entry: AssetEntry; def: DocKindDef; file: string };

type Formatted =
  | { asset: DocAsset; ok: true; text: string; changed: boolean }
  | { asset: DocAsset; ok: false; issues: SceneIssue[] };

/** A project's live doc assets: scenes, prefabs, checks, input scripts and every declarative kind. */
async function docAssets(project: ProjectHandle): Promise<DocAsset[]> {
  const { state } = await scanProject(project);
  const out: DocAsset[] = [];
  for (const entry of Object.values(state.assets)) {
    const def = project.kinds.get(entry.kind);
    if (entry.deleted !== undefined || def?.storage !== "doc") continue;
    out.push({ project, entry, def, file: join(project.dir, ...entry.path.split("/")) });
  }
  return out.sort((a, b) => (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
}

/** The asset's canonical text, through its kind's `parse` and `format`. */
async function format(asset: DocAsset): Promise<Formatted> {
  const text = await readFile(asset.file, "utf8");
  const env: KindEnv = { registry: asset.project.registry, project: null };
  const parsed = parseAssetDoc(asset.def, text, env);
  if (!parsed.ok) return { asset, ok: false, issues: parsed.issues };
  const canonical = formatAssetDoc(asset.def, parsed.value);
  return { asset, ok: true, text: canonical, changed: canonical !== text };
}

const nameKey = (asset: DocAsset) => (asset.def.kind === "scene" ? "scene" : "asset");

function one(result: Formatted, check: boolean): ToolResult {
  const { entry, def } = result.asset;
  const head = { [nameKey(result.asset)]: entry.id, kind: def.kind, path: entry.path };
  if (!result.ok)
    return {
      exitCode: 1,
      data: { ok: false, ...head, issues: result.issues },
      text: [`${entry.id}: failed to parse`, ...result.issues.map(issueLine)].join("\n"),
    };
  const { changed } = result;
  if (check)
    return {
      exitCode: changed ? 1 : 0,
      data: { ok: !changed, ...head, changed },
      text: changed
        ? `${entry.id}: not canonical; run vp run scene fmt ${entry.id}`
        : `${entry.id}: canonical`,
    };
  return {
    exitCode: 0,
    data: { ok: true, ...head, changed },
    text: changed ? `${entry.id}: formatted` : `${entry.id}: already canonical`,
  };
}

/**
 * Rewrites a doc asset (a scene, prefab, checks file, input script or any
 * declarative kind) in its kind's canonical form, found by id across the
 * projects; without an id, every doc asset of the projects in scope.
 * `--check` only reports, exit 1 when something isn't canonical.
 */
export const fmt: Tool<FmtInput> = async (input, ctx) => {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const check = input.check === true;
  const id = input.scene;

  if (id !== undefined) {
    if (id === "-" || id.includes("/") || id.endsWith(".json"))
      return usage("scene fmt takes an asset id; file paths are read-only");
    const assets = new Map<ProjectHandle, DocAsset[]>();
    const found = await locateInProjects(
      ctx.projects,
      id,
      async (p) => {
        const hits = (await docAssets(p)).filter((a) => a.entry.id === id);
        assets.set(p, hits);
        return hits.length > 0;
      },
      ctx.project,
    );
    if (!found.ok)
      return found.exitCode === 2
        ? usage(found.message)
        : failure(`No scene or doc asset named ${JSON.stringify(id)}.`);
    const [asset, ...more] = assets.get(found.project) ?? [];
    if (!asset || more.length > 0)
      return failure(`${JSON.stringify(id)} is more than one file in "${found.project.file.id}".`);
    const result = await format(asset);
    if (result.ok && result.changed && !check) await writeSceneText(asset, result.text);
    return one(result, check);
  }

  const results = await Promise.all(
    (await Promise.all(inScope(ctx).map(docAssets))).flat().map(format),
  );
  const changed = results.filter((r) => r.ok && r.changed);
  const failed = results.filter((r) => !r.ok);
  if (!check) for (const r of changed) if (r.ok) await writeSceneText(r.asset, r.text);
  const rows = results.map((r) => ({
    project: r.asset.project.file.id,
    id: r.asset.entry.id,
    kind: r.asset.def.kind,
    path: r.asset.entry.path,
    ...(r.ok ? { changed: r.changed } : { issues: r.issues }),
  }));
  const verb = check ? "not canonical" : "formatted";
  const lines = [
    ...changed.map((r) => `${r.asset.entry.id} (${r.asset.def.kind}): ${verb}`),
    ...failed.flatMap((r) =>
      r.ok ? [] : [`${r.asset.entry.id}: failed to parse`, ...r.issues.map(issueLine)],
    ),
    `${results.length} doc assets, ${changed.length} ${verb}, ${failed.length} failed to parse`,
  ];
  const bad = failed.length > 0 || (check && changed.length > 0);
  return {
    exitCode: bad ? 1 : 0,
    data: { ok: !bad, assets: rows, changed: changed.length, failed: failed.length },
    text: lines.join("\n"),
  };
};
