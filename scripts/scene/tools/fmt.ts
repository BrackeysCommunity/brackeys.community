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
  prefabLookup,
  prefabsOf,
  scopeError,
  usage,
  writeSceneText,
  type Tool,
  type ToolResult,
} from "../context";
import { locateInProjects, scanProject, type ProjectHandle } from "../projects";

export type FmtInput = { scene?: string; check?: boolean };

type DocAsset = {
  project: ProjectHandle;
  entry: AssetEntry;
  def: DocKindDef;
  file: string;
  /** The project's kind env: its registry and its prefabs, which an older scene or prefab migrates through. */
  env: KindEnv;
};

type Formatted =
  | { asset: DocAsset; ok: true; text: string; changed: boolean; migratedFrom?: number }
  | { asset: DocAsset; ok: false; issues: SceneIssue[] };

/** A project's live doc assets: scenes, prefabs, checks, input scripts and every declarative kind. */
async function docAssets(project: ProjectHandle): Promise<DocAsset[]> {
  const scan = await scanProject(project);
  const { registry } = project;
  const prefab = prefabLookup(await prefabsOf({ project }, registry, scan));
  const env: KindEnv = { registry, project: null, prefab };
  const out: DocAsset[] = [];
  for (const entry of Object.values(scan.state.assets)) {
    const def = project.kinds.get(entry.kind);
    if (entry.deleted !== undefined || def?.storage !== "doc") continue;
    out.push({ project, entry, def, file: join(project.dir, ...entry.path.split("/")), env });
  }
  return out.sort((a, b) => (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
}

/** The asset's canonical text, through its kind's `parse` and `format`. */
async function format(asset: DocAsset): Promise<Formatted> {
  const text = await readFile(asset.file, "utf8");
  const parsed = parseAssetDoc(asset.def, text, asset.env);
  if (!parsed.ok) return { asset, ok: false, issues: parsed.issues };
  const canonical = formatAssetDoc(asset.def, parsed.value);
  const changed = canonical !== text;
  const { migratedFrom } = parsed;
  return migratedFrom === undefined
    ? { asset, ok: true, text: canonical, changed }
    : { asset, ok: true, text: canonical, changed, migratedFrom };
}

/** ` (from v3 to v4)` when the file is at an older format version that formatting migrates. */
function fromNote(result: Formatted): string {
  if (!result.ok || result.migratedFrom === undefined) return "";
  return ` (from v${result.migratedFrom} to v${result.asset.def.version})`;
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
  const migrated = result.migratedFrom === undefined ? {} : { migratedFrom: result.migratedFrom };
  const from = fromNote(result);
  if (check)
    return {
      exitCode: changed ? 1 : 0,
      data: { ok: !changed, ...head, changed, ...migrated },
      text: changed
        ? `${entry.id}: not canonical${from}; run vp run scene fmt ${entry.id}`
        : `${entry.id}: canonical`,
    };
  return {
    exitCode: 0,
    data: { ok: true, ...head, changed, ...migrated },
    text: changed ? `${entry.id}: formatted${from}` : `${entry.id}: already canonical`,
  };
}

/**
 * Rewrites a doc asset (a scene, prefab, checks file, input script or any
 * declarative kind) in its kind's canonical form, found by id across the
 * projects; without an id, every doc asset of the projects in scope. A file
 * at an older format version (a v3 scene or prefab, a v1 input script, all
 * in px) is migrated to the current one through the project's game and
 * prefabs (lengths become metres at the game's px per metre), and the
 * result says `migratedFrom`.
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
    ...(r.ok && r.migratedFrom !== undefined ? { migratedFrom: r.migratedFrom } : {}),
  }));
  const migrated = results.filter((r) => r.ok && r.migratedFrom !== undefined).length;
  const verb = check ? "not canonical" : "formatted";
  const lines = [
    ...changed.map((r) => `${r.asset.entry.id} (${r.asset.def.kind}): ${verb}${fromNote(r)}`),
    ...failed.flatMap((r) =>
      r.ok ? [] : [`${r.asset.entry.id}: failed to parse`, ...r.issues.map(issueLine)],
    ),
    `${results.length} doc assets, ${changed.length} ${verb}, ${migrated} at an older format version, ${failed.length} failed to parse`,
  ];
  const bad = failed.length > 0 || (check && changed.length > 0);
  return {
    exitCode: bad ? 1 : 0,
    data: { ok: !bad, assets: rows, changed: changed.length, migrated, failed: failed.length },
    text: lines.join("\n"),
  };
};
