import type { Registry } from "../game/types";
import { closest } from "../scene/did-you-mean";
import { jsonPointer, makeIssue, pointerSegments } from "../scene/issues";
import { prefabsUsedBy } from "../scene/prefab";
import type { ExpandedScene, PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import type { KindRegistry } from "./kinds";
import { byCodeUnit, isPlainObject } from "./kinds/define";
import { entityRefSites, headerAssetRefs } from "./kinds/fields";
import { GAME_SETTINGS_KIND, gameSettingsEntries, gameSettingsValues } from "./kinds/game-settings";
import { MATERIAL_KIND } from "./kinds/material";
import { TEXTURE_KIND } from "./kinds/texture";
import { schemaRefSites, type RefSite } from "./refs";
import type { AssetEntry, AssetId, AssetKindName, ProjectView, Sha256 } from "./types";

/** One blob a bundle fetches. */
export type BundleEntry = { id: AssetId; kind: AssetKindName; sha256: Sha256; bytes: number };

/** The blobs a scene (or the project's settings) needs loaded before it draws. */
export type AssetBundle = {
  /** The scene's id, or "project" for the project bundle. */
  name: string;
  /** Blobs to fetch, sorted by id. */
  entries: readonly BundleEntry[];
  bytes: number;
};

/**
 * The bundle named `name` over `entries`: one entry per id (a later entry
 * replaces an earlier one), sorted by id, `bytes` their total.
 */
export function bundleOf(name: string, entries: Iterable<BundleEntry>): AssetBundle {
  const byId = new Map<AssetId, BundleEntry>();
  for (const e of entries) byId.set(e.id, e);
  const sorted = [...byId.values()].sort((a, b) => byCodeUnit(a.id, b.id));
  return { name, entries: sorted, bytes: sorted.reduce((sum, e) => sum + e.bytes, 0) };
}

/** A reference to resolve: `where` names its field for a message, `entityIds` its owner. */
type Source = { site: RefSite; where: string; entityIds: string[] };

const fits = (entry: AssetEntry, site: RefSite): boolean =>
  site.kinds.length === 0 || site.kinds.includes(entry.kind);

/** The site's field below its first `skip` pointer segments, dotted. */
const fieldOf = (site: RefSite, skip: number): string =>
  pointerSegments(site.pointer).slice(skip).join(".");

function missingIssue(view: ProjectView, { site, where, entityIds }: Source): SceneIssue {
  const what = site.kinds.length > 0 ? site.kinds.join(" or ") : "asset";
  const live = view.byId.get(site.id);
  let why: string;
  if (live && fits(live, site)) why = "which has no content to fetch";
  else if (live) why = `which is of kind ${live.kind}`;
  else if (view.deleted.some((e) => e.id === site.id && fits(e, site)))
    why = "which is in the trash";
  else why = "which the project doesn't have";
  const guess = closest(
    site.id,
    [...view.byId.values()].filter((e) => e.id !== site.id && fits(e, site)).map((e) => e.id),
  );
  return makeIssue("asset-missing", {
    message: `${where} names ${what} "${site.id}", ${why}${guess ? `; did you mean "${guess}"?` : ""}`,
    path: site.pointer,
    entityIds,
    got: site.id,
    ...(site.kinds.length > 0 ? { expected: what } : {}),
  });
}

/**
 * Resolves `sources` against the project, following each blob asset's own
 * references through its kind's `refs` (an atlas's texture, a font's
 * pages). Only textures are entries: an atlas's or font's data is its meta.
 * Material sites are skipped, since materials ride in the registry.
 */
function resolve(
  name: string,
  sources: Source[],
  view: ProjectView,
  kinds: KindRegistry,
): { bundle: AssetBundle; issues: SceneIssue[] } {
  const entries = new Map<AssetId, BundleEntry>();
  const followed = new Set<AssetId>();
  const issues: SceneIssue[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const { site } = source;
    if (site.kinds.includes(MATERIAL_KIND)) continue;
    const live = view.byId.get(site.id);
    if (!live || !fits(live, site)) {
      issues.push(missingIssue(view, source));
      continue;
    }
    if (followed.has(live.id)) continue;
    followed.add(live.id);
    const def = kinds.get(live.kind);
    if (def?.storage !== "blob") continue;
    if (live.kind === TEXTURE_KIND) {
      if (live.sha256 === undefined || live.bytes === undefined) {
        issues.push(missingIssue(view, source));
        continue;
      }
      entries.set(live.id, {
        id: live.id,
        kind: live.kind,
        sha256: live.sha256,
        bytes: live.bytes,
      });
    }
    for (const own of def.refs?.(live) ?? [])
      sources.push({ site: own, where: `"${live.id}" ${fieldOf(own, 0)}`, entityIds: [live.id] });
  }
  return { bundle: bundleOf(name, entries.values()), issues };
}

/** The header's sites, each named `<label>.assets.<i>`. */
const headerSources = (assets: readonly unknown[] | undefined, label: string, ids: string[]) =>
  headerAssetRefs(assets).map((site) => ({
    site,
    where: `${label}assets.${fieldOf(site, 1)}`,
    entityIds: ids,
  }));

/**
 * The bundle of an expanded scene: every asset field of its entities
 * (instances resolved and defaults applied, so an id only a type's or a
 * behavior's default names counts), its settings' asset fields, and the
 * `assets` headers of `def` and of every prefab it reaches
 * (`prefabsUsedBy`: nesting and variant bases included), with each asset's
 * own references followed. Entries are the textures among them, sorted by
 * id, each once. A reference no live asset of its kinds resolves, or a
 * texture with no content, is `asset-missing` with the closest live id.
 */
export function sceneBundle(
  scene: ExpandedScene,
  def: SceneDefinition,
  prefabs: PrefabLibrary,
  view: ProjectView,
  kinds: KindRegistry,
  registry: Registry,
): { bundle: AssetBundle; issues: SceneIssue[] } {
  const sources: Source[] = [];
  for (const e of scene.entities) {
    for (const site of entityRefSites(registry, e, jsonPointer(["entities", `@${e.id}`])))
      sources.push({ site, where: `${e.id}.${fieldOf(site, 2)}`, entityIds: [e.id] });
  }
  for (const site of schemaRefSites(registry.settings, scene.settings, "/settings"))
    sources.push({ site, where: `settings.${fieldOf(site, 1)}`, entityIds: [] });
  sources.push(...headerSources(def.assets, "", []));
  for (const id of prefabsUsedBy(def, prefabs)) {
    const prefab = prefabs.get(id);
    if (prefab) sources.push(...headerSources(prefab.assets, `prefab "${id}"'s `, [id]));
  }
  return resolve(scene.name, sources, view, kinds);
}

/**
 * The bundle of the project's game-settings file `settings`: the asset
 * fields its kind's `refs` finds in the `game` block, defaults applied,
 * with each asset's own references followed as `sceneBundle` does. Loaded
 * once and kept resident.
 */
export function projectBundle(
  view: ProjectView,
  settings: unknown,
  kinds: KindRegistry,
  registry: Registry,
): { bundle: AssetBundle; issues: SceneIssue[] } {
  const def = kinds.get(GAME_SETTINGS_KIND);
  if (def?.storage !== "doc" || !def.refs || !isPlainObject(settings))
    return resolve("project", [], view, kinds);
  const game = gameSettingsValues(
    registry,
    isPlainObject(settings.game) ? settings.game : undefined,
  );
  const owner = gameSettingsEntries(view)[0]?.id ?? GAME_SETTINGS_KIND;
  const sources = def
    .refs({ ...settings, game }, { registry, project: view })
    .map((site) => ({ site, where: `${owner} ${fieldOf(site, 0)}`, entityIds: [owner] }));
  return resolve("project", sources, view, kinds);
}
