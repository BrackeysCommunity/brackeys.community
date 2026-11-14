import type { Registry } from "../game/types";
import { didYouMean } from "../scene/did-you-mean";
import { expandInstance } from "../scene/expand";
import { jsonPointer, makeIssue, pointerSegments } from "../scene/issues";
import { prefabsUsedBy, reachPrefabs } from "../scene/prefab";
import {
  PREFAB_KIND,
  type ExpandedScene,
  type Prefab,
  type PrefabLibrary,
  type RuntimeEntity,
  type SceneDefinition,
  type SceneIssue,
} from "../scene/types";
import type { KindRegistry } from "./kinds";
import { byCodeUnit, isPlainObject, isRuntimeKind, type KindEnv } from "./kinds/define";
import { entityRefSites, headerAssetRefs } from "./kinds/fields";
import { GAME_SETTINGS_KIND, gameSettingsEntries, gameSettingsValues } from "./kinds/game-settings";
import { MATERIAL_KIND } from "./kinds/material";
import { TEXTURE_KIND } from "./kinds/texture";
import { kindsLabel, schemaRefSites, siteFits, type RefSite } from "./refs";
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

/**
 * A blob's content as a bundle or a release pins it: its hash with its
 * size, or null while the entry lacks either.
 */
export function blobContent(
  entry: Pick<AssetEntry, "sha256" | "bytes">,
): { sha256: Sha256; bytes: number } | null {
  return entry.sha256 !== undefined && entry.bytes !== undefined
    ? { sha256: entry.sha256, bytes: entry.bytes }
    : null;
}

/**
 * The `asset-missing` a bundle raises for a texture whose entry records a
 * hash but no size: its bytes exist, but there's no size to pin. Carries
 * `detail.unsized`, the hash, so the export can tell it from other issues.
 */
function unsizedIssue({ site, where, entityIds }: Source, sha256: Sha256): SceneIssue {
  return makeIssue("asset-missing", {
    message: `${where} names texture "${site.id}", whose entry records no size for blob ${sha256}`,
    path: site.pointer,
    entityIds,
    got: site.id,
    detail: { unsized: sha256 },
  });
}

/** The ids of the textures `issues` already raise as recorded with no size. */
export function unsizedIds(issues: readonly SceneIssue[]): Set<AssetId> {
  const ids = new Set<AssetId>();
  for (const i of issues)
    if (i.code === "asset-missing" && typeof i.detail?.unsized === "string" && i.got !== undefined)
      ids.add(i.got);
  return ids;
}

/** A reference to resolve: `where` names its field for a message, `entityIds` its owner. */
type Source = { site: RefSite; where: string; entityIds: string[] };

const fits = (entry: AssetEntry, site: RefSite): boolean => siteFits(site, entry.kind);

/** The site's field below its first `skip` pointer segments, dotted. */
const fieldOf = (site: RefSite, skip: number): string =>
  pointerSegments(site.pointer).slice(skip).join(".");

function missingIssue(view: ProjectView, { site, where, entityIds }: Source): SceneIssue {
  const what = kindsLabel(site);
  const live = view.byId.get(site.id);
  let why: string;
  if (live && fits(live, site)) why = "which has no content to fetch";
  else if (live) why = `which is of kind ${live.kind}`;
  else if (view.deleted.some((e) => e.id === site.id && fits(e, site)))
    why = "which is in the trash";
  else why = "which the project doesn't have";
  const near = didYouMean(
    site.id,
    [...view.byId.values()].filter((e) => fits(e, site)).map((e) => e.id),
  );
  return makeIssue("asset-missing", {
    message: `${where} names ${what} "${site.id}", ${why}${near}`,
    path: site.pointer,
    entityIds,
    got: site.id,
    ...(site.kinds.length > 0 ? { expected: what } : {}),
  });
}

/**
 * A doc's value by kind and id, as a bundle reads it to follow a runtime
 * doc a field names; undefined when it has none. A `DocLookup` is one.
 */
type BundleDocs = { read(kind: AssetKindName, id: AssetId): unknown };

/** How `resolve` reads a runtime doc's references: its values, and the env its kind's `refs` take. */
type DocFollow = { docs: BundleDocs; env: KindEnv };

/**
 * Resolves `sources` against the project, following each blob asset's own
 * references through its kind's `refs` (an atlas's texture, a font's
 * pages), and, with `follow`, each runtime doc's through its kind's
 * `bundleRefs` (default `refs`), so an animation a behavior names brings
 * its atlas and texture. Only textures are entries: an atlas's or font's
 * data is its meta. Material sites are skipped, since materials ride in the
 * registry.
 */
function resolve(
  name: string,
  sources: Source[],
  view: ProjectView,
  kinds: KindRegistry,
  follow?: DocFollow,
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
    if (isRuntimeKind(def)) {
      const value = follow?.docs.read(live.kind, live.id);
      if (!follow || value === undefined) continue;
      const own = def.bundleRefs
        ? def.bundleRefs(value, follow.env)
        : def.refs?.(value, follow.env);
      for (const site of own ?? [])
        sources.push({ site, where: `"${live.id}" ${fieldOf(site, 0)}`, entityIds: [live.id] });
      continue;
    }
    if (def?.storage !== "blob") continue;
    if (live.kind === TEXTURE_KIND) {
      const content = blobContent(live);
      if (!content) {
        issues.push(
          live.sha256 === undefined
            ? missingIssue(view, source)
            : unsizedIssue(source, live.sha256),
        );
        continue;
      }
      entries.set(live.id, { id: live.id, kind: live.kind, ...content });
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

const entitySources = (registry: Registry, e: RuntimeEntity): Source[] =>
  entityRefSites(registry, e, jsonPointer(["entities", `@${e.id}`])).map((site) => ({
    site,
    where: `${e.id}.${fieldOf(site, 2)}`,
    entityIds: [e.id],
  }));

/** A prefab a field names, placed as an instance at the origin, and the scene field that first reached it. */
type NamedPrefab = { id: AssetId; children: RuntimeEntity[]; from: Source };

/**
 * The prefabs `entities` name through prefab asset fields of their types
 * and behavior blocks (a spawner's `prefab`), then those the named
 * prefabs' own children name in turn, as far as `get` has them. Each comes
 * with its children as an instance at the origin places them (defaults
 * applied, nested instances and variant bases resolved); `library` holds
 * every prefab they reach.
 */
function walkNamedPrefabs(
  entities: readonly RuntimeEntity[],
  registry: Registry,
  get: (id: AssetId) => Prefab | undefined,
): { named: NamedPrefab[]; library: Map<string, Prefab> } {
  const library = new Map<string, Prefab>();
  const pending: { id: AssetId; from: Source }[] = [];
  const queue = (e: RuntimeEntity, from?: Source) => {
    for (const source of entitySources(registry, e))
      if (source.site.kinds.includes(PREFAB_KIND))
        pending.push({ id: source.site.id, from: from ?? source });
  };
  for (const e of entities) queue(e);
  const named: NamedPrefab[] = [];
  const seen = new Set<AssetId>();
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const { id, from } = next;
    if (seen.has(id)) continue;
    seen.add(id);
    reachPrefabs([id], get, library);
    if (!library.has(id)) continue;
    let children: RuntimeEntity[];
    try {
      const placed = expandInstance({ id, prefab: id, at: [0, 0] }, library, registry);
      if (!placed.ok) continue;
      children = placed.entities;
    } catch {
      continue;
    }
    named.push({ id, children, from });
    for (const child of children) queue(child, from);
  }
  return { named, library };
}

/**
 * The prefabs a scene's expanded `entities` name through prefab asset
 * fields (a spawner's `prefab`), with every prefab those reach: their
 * nested instances, variant bases and the prefabs their own children name,
 * as far as `get` has them. What a reader adds to the scene's prefab
 * library so `sceneBundle` follows a spawned prefab into its assets.
 */
export function namedPrefabs(
  entities: readonly RuntimeEntity[],
  registry: Registry,
  get: (id: AssetId) => Prefab | undefined,
): PrefabLibrary {
  return walkNamedPrefabs(entities, registry, get).library;
}

/**
 * The sources of the prefabs the scene's fields name (`walkNamedPrefabs`):
 * their children's asset fields and the headers of every prefab they
 * reach, each pointed at the scene field that named it. An id an earlier
 * source already names, and a header the scene's instances already cover,
 * are left out, so nothing is reported twice.
 */
function namedPrefabSources(
  scene: ExpandedScene,
  prefabs: PrefabLibrary,
  registry: Registry,
  covered: ReadonlySet<string>,
  earlier: readonly Source[],
): Source[] {
  const { named, library } = walkNamedPrefabs(scene.entities, registry, (id) => prefabs.get(id));
  if (named.length === 0) return [];
  const known = new Set(earlier.map((s) => s.site.id));
  const headers = new Set(covered);
  const out: Source[] = [];
  const add = (source: Source, from: Source) => {
    if (known.has(source.site.id)) return;
    known.add(source.site.id);
    out.push({
      site: { ...source.site, pointer: from.site.pointer },
      where: source.where,
      entityIds: from.entityIds,
    });
  };
  for (const { id, children, from } of named) {
    const label = `prefab "${id}" (${from.where})`;
    for (const child of children) {
      for (const source of entitySources(registry, child))
        add({ ...source, where: `${label} ${source.where.slice(id.length + 1)}` }, from);
    }
    const reached = prefabsUsedBy(
      { instances: [{ id, prefab: id, at: [0, 0] }] } as SceneDefinition,
      library,
    );
    for (const pid of reached) {
      if (headers.has(pid)) continue;
      headers.add(pid);
      const prefab = library.get(pid);
      if (!prefab) continue;
      for (const source of headerSources(prefab.assets, `prefab "${pid}"'s `, []))
        add({ ...source, where: `${source.where} (${from.where})` }, from);
    }
  }
  return out;
}

/**
 * The bundle of an expanded scene: every asset field of its entities
 * (instances resolved and defaults applied, so an id only a type's or a
 * behavior's default names counts), its settings' asset fields, and the
 * `assets` headers of `def` and of every prefab it reaches
 * (`prefabsUsedBy`: nesting and variant bases included), with each asset's
 * own references followed. A prefab a field names (a spawner's `prefab`)
 * that `prefabs` holds brings its children's asset fields and its header
 * too, and so on through what those name (`namedPrefabs`). Entries are the
 * textures among them, sorted by id, each once. A reference no live asset
 * of its kinds resolves, or a texture with no content, is `asset-missing`
 * with the closest live id; a texture whose entry records a hash but no
 * size is left out and is `asset-missing` too, saying so. With `docs`, a
 * runtime doc a field names (an `anim`'s animation) is followed into the
 * blobs its kind's `bundleRefs` name; blobs reached only through runtime
 * docs no field names stay out, and load on demand.
 */
export function sceneBundle(
  scene: ExpandedScene,
  def: SceneDefinition,
  prefabs: PrefabLibrary,
  view: ProjectView,
  kinds: KindRegistry,
  registry: Registry,
  docs?: BundleDocs,
): { bundle: AssetBundle; issues: SceneIssue[] } {
  const sources: Source[] = [];
  for (const e of scene.entities) sources.push(...entitySources(registry, e));
  for (const site of schemaRefSites(registry.settings, scene.settings, "/settings"))
    sources.push({ site, where: `settings.${fieldOf(site, 1)}`, entityIds: [] });
  sources.push(...headerSources(def.assets, "", []));
  const used = prefabsUsedBy(def, prefabs);
  for (const id of used) {
    const prefab = prefabs.get(id);
    if (prefab) sources.push(...headerSources(prefab.assets, `prefab "${id}"'s `, [id]));
  }
  sources.push(...namedPrefabSources(scene, prefabs, registry, new Set(used), sources));
  const follow = docs ? { docs, env: { registry, project: view } } : undefined;
  return resolve(scene.name, sources, view, kinds, follow);
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
