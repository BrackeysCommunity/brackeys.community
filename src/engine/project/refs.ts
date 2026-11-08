import { closest } from "../scene/did-you-mean";
import { makeIssue, pointerSegments } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { fieldLayout } from "./canonical";
import type { DocLayout, KindEnv, KindRegistry } from "./kinds";
import { byCodeUnit, isPlainObject } from "./kinds/define";
import { MATERIAL_KIND } from "./kinds/material";
import type { JsonPointer } from "./ops";
import type { AssetEntry, AssetId, AssetKey, AssetKindName, ProjectView } from "./types";

/** One reference: the referring doc's value names asset `id` at `pointer`. */
export type RefSite = {
  pointer: JsonPointer;
  id: AssetId;
  kinds: readonly AssetKindName[];
  /**
   * "key" when the id is the `:<id>` end of the object key `pointer` ends
   * at (a bulk key such as `solid:ice`) rather than the value there.
   */
  in?: "key";
};
export type Referrer = { id: AssetId; kind: AssetKindName; pointer: JsonPointer };

export type RefIndex = {
  /** Who names `id`. */
  referrers(id: AssetId): readonly Referrer[];
  /** What `id` names. */
  targets(id: AssetId): readonly RefSite[];
  /** References to ids that aren't live: `asset-missing` issues (with a did-you-mean). */
  dangling(): readonly SceneIssue[];
};

const fits = (entry: AssetEntry, site: RefSite): boolean =>
  site.kinds.length === 0 || site.kinds.includes(entry.kind);

/**
 * A site that may name a material is a reference only when an entry of one
 * of its kinds (live or trashed) has the id: other names are a game's code
 * materials, which aren't assets.
 */
function siteCounts(view: ProjectView, site: RefSite): boolean {
  if (!site.kinds.includes(MATERIAL_KIND)) return true;
  const live = view.byId.get(site.id);
  if (live && fits(live, site)) return true;
  return view.deleted.some((e) => e.id === site.id && fits(e, site));
}

function sitesOf(
  entry: AssetEntry,
  values: ReadonlyMap<AssetId, unknown>,
  kinds: KindRegistry,
  env: KindEnv,
): readonly RefSite[] {
  const def = kinds.get(entry.kind);
  if (!def) return [];
  if (def.storage === "doc") {
    if (!def.refs || !values.has(entry.id)) return [];
    return def.refs(values.get(entry.id), env);
  }
  if (def.storage === "blob") return def.refs?.(entry) ?? [];
  return [];
}

function kindsLabel(site: RefSite): string {
  return site.kinds.length > 0 ? site.kinds.join(" or ") : "asset";
}

function danglingIssue(view: ProjectView, from: AssetEntry, site: RefSite): SceneIssue | undefined {
  const live = view.byId.get(site.id);
  if (live && fits(live, site)) return undefined;
  const what = kindsLabel(site);
  const head = `"${from.id}" names ${what} "${site.id}" at ${site.pointer || "/"}`;
  let message: string;
  if (live) {
    message = `${head}, but "${site.id}" is a ${live.kind}`;
  } else if (view.deleted.some((e) => e.id === site.id && fits(e, site))) {
    message = `${head}, but it's in the trash`;
  } else {
    message = `${head}, but the project has no live ${what} "${site.id}"`;
  }
  const candidates = [...view.byId.values()]
    .filter((e) => e.id !== site.id && fits(e, site))
    .map((e) => e.id);
  const guess = closest(site.id, candidates);
  message += guess ? `; did you mean "${guess}"?` : ".";
  return makeIssue("asset-missing", {
    message,
    entityIds: [from.id],
    path: site.pointer,
    got: site.id,
    ...(site.kinds.length > 0 ? { expected: what } : {}),
  });
}

const byIdThenPointer = (a: Referrer, b: Referrer): number =>
  byCodeUnit(a.id, b.id) || byCodeUnit(a.pointer, b.pointer);

/**
 * References out of every live asset: a doc kind's `refs(value)` over its
 * value in `values` (a doc that isn't there isn't read), a blob kind's
 * `refs(entry)`. A reference to an id with no live asset of a kind it
 * accepts is dangling.
 */
export function buildRefIndex(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
  kinds: KindRegistry,
  env: KindEnv,
): RefIndex {
  const out = new Map<AssetId, RefSite[]>();
  const into = new Map<AssetId, Referrer[]>();
  const issues: SceneIssue[] = [];
  const live = [...view.byId.values()].sort((a, b) => byCodeUnit(a.id, b.id));
  for (const entry of live) {
    const sites = sitesOf(entry, values, kinds, env).filter((s) => siteCounts(view, s));
    if (sites.length === 0) continue;
    out.set(entry.id, [...sites]);
    for (const site of sites) {
      const list = into.get(site.id) ?? [];
      list.push({ id: entry.id, kind: entry.kind, pointer: site.pointer });
      into.set(site.id, list);
      const issue = danglingIssue(view, entry, site);
      if (issue) issues.push(issue);
    }
  }
  for (const list of into.values()) list.sort(byIdThenPointer);
  return {
    referrers: (id) => into.get(id) ?? [],
    targets: (id) => out.get(id) ?? [],
    dangling: () => issues,
  };
}

/**
 * Trashed entries that a live value names while no live asset holds their
 * id: what the project's writer restores so a delete racing a new
 * reference ends restored, never dangling. Of several trashed entries with
 * one id, the one deleted last. Keys, sorted.
 */
export function referencedTrash(view: ProjectView, index: RefIndex): AssetKey[] {
  const latest = new Map<AssetId, AssetEntry>();
  for (const entry of view.deleted) {
    if (view.byId.has(entry.id)) continue;
    const named = index
      .referrers(entry.id)
      .some((r) =>
        index
          .targets(r.id)
          .some((s) => s.id === entry.id && s.pointer === r.pointer && fits(entry, s)),
      );
    if (!named) continue;
    const prev = latest.get(entry.id);
    if (!prev || deletedAfter(entry, prev)) latest.set(entry.id, entry);
  }
  return [...latest.values()].map((e) => e.key).sort();
}

function deletedAfter(a: AssetEntry, b: AssetEntry): boolean {
  const at = (a.deleted?.at ?? 0) - (b.deleted?.at ?? 0);
  return at !== 0 ? at > 0 : a.key > b.key;
}

const INDEX = /^(0|[1-9]\d*)$/;

/** The layout below `segment`; undefined where the layout says nothing (inside an atomic value, or with none given). */
function childLayout(layout: DocLayout | undefined, segment: string): DocLayout | undefined {
  if (!layout) return undefined;
  if (layout.as === "map") return fieldLayout(layout, segment);
  if (layout.as === "list" || layout.as === "keyed") return layout.item;
  return undefined;
}

/**
 * An array index from a pointer segment: a number, or "@<id>" for the item
 * whose id field (a keyed layout's `id`, else "id") holds that.
 */
function indexOf(
  list: readonly unknown[],
  segment: string,
  layout: DocLayout | undefined,
): number | undefined {
  if (segment.startsWith("@")) {
    const id = segment.slice(1);
    const field = layout?.as === "keyed" ? (layout.id ?? "id") : "id";
    const i = list.findIndex((item) => isPlainObject(item) && item[field] === id);
    return i < 0 ? undefined : i;
  }
  if (!INDEX.test(segment)) return undefined;
  const i = Number(segment);
  return i < list.length ? i : undefined;
}

/** `node` with `key` renamed in place; arrays under both names are joined. Undefined when they can't be. */
function renameKey(
  node: Record<string, unknown>,
  key: string,
  next: string,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (!Object.hasOwn(node, next)) {
    for (const [k, v] of Object.entries(node)) out[k === key ? next : k] = v;
    return out;
  }
  const had = node[next];
  const moved = node[key];
  if (!Array.isArray(had) || !Array.isArray(moved)) return undefined;
  for (const [k, v] of Object.entries(node))
    if (k !== key) out[k] = k === next ? [...had, ...moved] : v;
  return out;
}

function rewriteAt(
  node: unknown,
  segments: readonly string[],
  depth: number,
  site: RefSite,
  to: AssetId,
  layout: DocLayout | undefined,
): unknown {
  const segment = segments[depth];
  if (segment === undefined) return node === site.id ? to : node;
  const below = childLayout(layout, segment);
  if (Array.isArray(node)) {
    const i = indexOf(node, segment, layout);
    if (i === undefined) return node;
    const child = rewriteAt(node[i], segments, depth + 1, site, to, below);
    if (child === node[i]) return node;
    const copy = node.slice();
    copy[i] = child;
    return copy;
  }
  if (!isPlainObject(node) || !Object.hasOwn(node, segment)) return node;
  if (site.in === "key" && depth === segments.length - 1) {
    if (!segment.endsWith(`:${site.id}`)) return node;
    return renameKey(node, segment, `${segment.slice(0, -site.id.length)}${to}`) ?? node;
  }
  const child = rewriteAt(node[segment], segments, depth + 1, site, to, below);
  return child === node[segment] ? node : { ...node, [segment]: child };
}

/**
 * The value with every `from` reference at `sites` replaced by `to`. Only
 * the named sites change, and only where they still hold `from`; the input
 * is never mutated and untouched branches are shared. A key site renames
 * its key (`solid:from` → `solid:to`, joining an existing `solid:to`). With
 * the referring kind's `layout`, an "@<id>" segment matches a keyed
 * collection's own id field; without one, the items' `id`.
 */
export function rewriteRefs<J>(
  value: J,
  sites: readonly RefSite[],
  from: AssetId,
  to: AssetId,
  layout?: DocLayout,
): J {
  let next: unknown = value;
  for (const site of sites) {
    if (site.id !== from) continue;
    next = rewriteAt(next, pointerSegments(site.pointer), 0, site, to, layout);
  }
  return next as J;
}

/** Whether `value` still names `site.id` at the site: the value there, or for a key site, the key. */
export function namesAt(value: unknown, site: RefSite, layout?: DocLayout): boolean {
  const segments = pointerSegments(site.pointer);
  let node = value;
  let at = layout;
  for (const [depth, segment] of segments.entries()) {
    if (site.in === "key" && depth === segments.length - 1)
      return isPlainObject(node) && Object.hasOwn(node, segment) && segment.endsWith(`:${site.id}`);
    if (Array.isArray(node)) {
      const i = indexOf(node, segment, at);
      if (i === undefined) return false;
      node = node[i];
    } else if (isPlainObject(node) && Object.hasOwn(node, segment)) node = node[segment];
    else return false;
    at = childLayout(at, segment);
  }
  return node === site.id;
}
