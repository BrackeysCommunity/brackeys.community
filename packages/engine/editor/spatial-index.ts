import { SPRITE } from "../game/behaviors/sprite";
import { Z_LIMIT } from "../game/fields";
import { NODE_TYPE } from "../game/primitives";
import { isCameraRegionType } from "../game/primitives";
import type { RegisteredType, Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { behaviorBlocks, bulkEntries, bulkId, bulkKeysOf, parseBulkId } from "../scene/expand";
import { defaultLayer } from "../scene/layers";
import { spriteBoxOf, type DrawnSprite, type SpriteAssetLookup } from "../scene/render-geometry";
import { documentTree } from "../scene/resolve";
import { geometryFields } from "../scene/schema";
import { aabb, aabbBox, aabbUnion, translateShape } from "../scene/shape-geometry";
import { parseShape } from "../scene/shapes";
import { createSpatialHash } from "../scene/spatial-hash";
import type { Aabb, BulkKey, EntityDef, Pt, Ref, SceneDefinition, ShapeObj } from "../scene/types";
import { editTree, enclosingInstances, type EditSource, type EditTree } from "./gizmos/tree";
import type { IndexEntry, SpatialIndex } from "./tools";

export const DEFAULT_CELL = 2.56;

/** Where an entity's geometry lives in the document, and what it is in the world. */
export type EditGeometry = {
  /** The first shape field the entity sets. */
  shapeField?: string;
  /** The first point field the entity sets. */
  pointField?: string;
  /** The first path field the entity sets; a shape is local to its first point. */
  pathField?: string;
  /** The shape as written: local to the path's first point when there is a path. */
  local?: ShapeObj;
  /** The shape in world metres. */
  shape?: ShapeObj;
  at?: Pt;
  /** The path's waypoints, world metres. */
  pts?: Pt[];
  /** The path runs a closing segment from its last point back to its first. */
  loop?: boolean;
};

const isPt = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

function readPath(v: unknown): Pt[] | undefined {
  const pts = (v as { pts?: unknown } | null)?.pts;
  return Array.isArray(pts) && pts.length > 0 && pts.every(isPt)
    ? pts.map(([x, y]) => [x, y] as Pt)
    : undefined;
}

/**
 * An on-disk entity's geometry, placed the way the renderers place it
 * (`drawnEntities`): the first shape, point and path field it sets, with a
 * shape on a path drawn at the path's first point. Fields that don't parse
 * are left out, so a half-typed shape never throws.
 */
export function entityGeometry(type: RegisteredType, e: EntityDef): EditGeometry {
  const out: EditGeometry = {};
  for (const { field, kind } of geometryFields(type)) {
    const value = e[field];
    if (value === undefined) continue;
    if (kind === "shape" && !out.shapeField) {
      const parsed = parseShape(value);
      if (!parsed.ok) continue;
      out.shapeField = field;
      out.local = parsed.shape;
    } else if (kind === "point" && !out.pointField && isPt(value)) {
      out.pointField = field;
      out.at = [value[0], value[1]];
    } else if (kind === "path" && !out.pathField) {
      const pts = readPath(value);
      if (!pts) continue;
      out.pathField = field;
      out.pts = pts;
      if ((value as { mode?: unknown }).mode === "loop") out.loop = true;
    }
  }
  if (out.local) out.shape = out.pts ? translateShape(out.local, out.pts[0]!) : out.local;
  return out;
}

/** A bulk entry's geometry: its shape or point, under the bulk key's field. */
export function bulkGeometry(
  registry: Registry,
  key: BulkKey,
  value: unknown,
): EditGeometry | undefined {
  const info = registry.bulkKey(key);
  if (!info) return undefined;
  if (info.form === "point")
    return isPt(value) ? { pointField: info.field, at: [value[0], value[1]] } : undefined;
  const parsed = parseShape(value);
  return parsed.ok
    ? { shapeField: info.field, local: parsed.shape, shape: parsed.shape }
    : undefined;
}

/** The world geometry of `ref` in `def`; `undefined` when it has none or isn't there. */
export function geometryOfRef(
  def: SceneDefinition,
  registry: Registry,
  ref: Ref,
): (EditGeometry & { type: string; bulk: boolean }) | undefined {
  const bulk = parseBulkId(ref);
  if (bulk) {
    const g = bulkGeometry(registry, bulk.key, bulkEntries(def, bulk.key)[bulk.index]);
    return g && { ...g, type: registry.bulkKey(bulk.key)!.type, bulk: true };
  }
  const e = (def.entities ?? []).find((x) => x.id === ref);
  const t = e && registry.types.get(e.type);
  return t && { ...entityGeometry(t, e), type: e.type, bulk: false };
}

/**
 * Where the sprite of an entity or bulk row of `type` draws over `g`: its
 * `sprite` block (the type's default merged with `written`, the entity's
 * `behaviors`) at `g`'s pose. Undefined when it carries no sprite.
 */
export function editSpriteBox(
  registry: Registry,
  type: string,
  g: EditGeometry,
  written?: unknown,
  asset?: SpriteAssetLookup,
): DrawnSprite | undefined {
  if (!registry.types.has(type)) return undefined;
  const block = behaviorBlocks(registry, type, written)[SPRITE.name];
  return block
    ? spriteBoxOf(
        block,
        { shape: g.shape, at: g.at, path: g.pts ? { pts: g.pts } : undefined },
        asset,
        pxPerMetreOf(registry),
      )
    : undefined;
}

const pointBox = ([x, y]: Pt): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

/**
 * Stacking, bottom to top: the registry's layer order, then the entity's
 * `z`, then document order. Every term stays an exact integer.
 */
const ORDER_STRIDE = 1e7;
const Z_SPAN = 2 * Z_LIMIT + 1;
const zOf = (layerIndex: number, z: number, order: number) =>
  (layerIndex * Z_SPAN + z + Z_LIMIT) * ORDER_STRIDE + order;

const entityZ = (e: EntityDef | undefined) =>
  typeof e?.z === "number" && Number.isInteger(e.z)
    ? Math.max(-Z_LIMIT, Math.min(Z_LIMIT, e.z))
    : 0;

/**
 * Topmost first. An instance shares its top entry's `z` and sorts below it,
 * so the order doesn't depend on which entries an update rewrote.
 */
function topFirst(a: IndexEntry, b: IndexEntry): number {
  if (a.z !== b.z) return b.z - a.z;
  if (!a.instance !== !b.instance) return a.instance ? 1 : -1;
  return a.instance && a.ref !== b.ref ? (a.ref < b.ref ? -1 : 1) : 0;
}

export type SpatialIndexOptions = {
  /** Metres per grid cell; default 2.56. */
  cell?: number;
  /**
   * The doc key behind a ref (`EditorSession.keyOf`). Without it, or when it
   * answers `undefined`, an entry's key is its ref.
   */
  keyOf?: (ref: Ref) => string | undefined;
  /**
   * Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`); read at
   * each (re)index. Without it a sprite's box is its block's size or 32×32.
   */
  asset?: SpriteAssetLookup;
};

export type EditableSpatialIndex = SpatialIndex & {
  /**
   * Indexes `def` (a resolved view, or a scene with neither instances nor
   * parents) from scratch. `source` is the document behind a resolved view,
   * which says what sits under a parent the view can't show: an instance
   * under a node.
   */
  rebuild(def: SceneDefinition, registry: Registry, source?: EditSource): void;
  /**
   * Brings the index up to `def` after a change to `touched` (refs of the
   * document, as `applyOps` and `EditorSession` report them, or of the
   * view). Each touched ref is re-indexed with its subtree, which a moved or
   * turned parent carries in the world: an instance's id with its children.
   * An empty list rebuilds. A bulk key whose entries changed is re-indexed
   * whole, since its indices shift; entities missing from `def` are dropped,
   * and only the instances over what changed are redrawn.
   */
  update(
    def: SceneDefinition,
    registry: Registry,
    touched: readonly Ref[],
    source?: EditSource,
  ): void;
};

/**
 * The uniform grid of AABBs picking, marquee and snapping query. Entries
 * cover every bulk entry and every entity with a shape or point, `off`
 * entities, notes and nodes (at their origin) included; an entity on a path
 * is indexed at the path's first point. An entity carrying a sprite is also
 * hit by the box the sprite draws; a point entity's sprite box is its
 * geometry. Each instance has an entry over its subtree, stacked with the
 * topmost entry under it, and a prefab child's entry names the instances
 * it sits in.
 */
export function createSpatialIndex(opts: SpatialIndexOptions = {}): EditableSpatialIndex {
  const keyOf = (ref: Ref) => opts.keyOf?.(ref) ?? ref;
  const entries = new Map<Ref, IndexEntry>();
  const hash = createSpatialHash<Ref>(opts.cell ?? DEFAULT_CELL);
  /** Each indexed bulk key's entries as last indexed, to spot a changed bucket. */
  const buckets = new Map<BulkKey, { sig: string; count: number }>();

  function insert(e: IndexEntry) {
    entries.set(e.ref, e);
    hash.insert(e.ref, e.aabb);
  }

  function drop(ref: Ref) {
    if (!entries.delete(ref)) return;
    hash.remove(ref);
  }

  function entryOf(
    registry: Registry,
    ref: Ref,
    type: string,
    layer: string,
    g: EditGeometry | undefined,
    written?: unknown,
  ): IndexEntry | undefined {
    const own = g?.shape ?? g?.at;
    if (!g || !own) return undefined;
    const sprite = editSpriteBox(registry, type, g, written, opts.asset);
    const box = g.shape ? aabb(g.shape) : pointBox(g.at!);
    const instances = enclosingInstances(ref);
    return {
      ref,
      key: keyOf(ref),
      type,
      layer,
      aabb: sprite ? aabbUnion(box, sprite.box) : box,
      z: 0,
      geometry: g.shape ?? sprite?.shape ?? own,
      ...(sprite ? { sprite: sprite.shape } : {}),
      ...(isCameraRegionType(registry.types.get(type)) ? { region: true as const } : {}),
      ...(instances.length > 0 ? { instances } : {}),
    };
  }

  /** Each instance's subtree as last indexed, and the instances each ref was found under. */
  const instanceMembers = new Map<Ref, readonly Ref[]>();
  const memberOf = new Map<Ref, Set<Ref>>();

  /** Redraws one instance's entry over the entries of its subtree; an instance with none drawn has none. */
  function indexInstance(tree: EditTree, ref: Ref) {
    drop(ref);
    for (const r of instanceMembers.get(ref) ?? []) {
      const held = memberOf.get(r);
      if (held?.delete(ref) && held.size === 0) memberOf.delete(r);
    }
    instanceMembers.delete(ref);
    if (!tree.isInstance(ref)) return;
    const members = tree.below([ref]);
    instanceMembers.set(ref, members);
    let top: IndexEntry | undefined;
    let box: Aabb | undefined;
    for (const r of members) {
      const held = memberOf.get(r);
      if (held) held.add(ref);
      else memberOf.set(r, new Set([ref]));
      const e = entries.get(r);
      if (!e || e.instance) continue;
      box = box ? aabbUnion(box, e.aabb) : e.aabb;
      if (!top || e.z > top.z) top = e;
    }
    if (!box || !top) return;
    insert({
      ref,
      key: keyOf(ref),
      type: NODE_TYPE,
      layer: top.layer,
      aabb: box,
      z: top.z,
      geometry: aabbBox(box),
      instance: true,
    });
  }

  /**
   * The instances whose entry `changed` refs can move: those they sat under
   * at the last index and those they sit under now, plus instances added or
   * removed since.
   */
  function staleInstances(
    def: SceneDefinition,
    tree: EditTree,
    changed: ReadonlySet<Ref>,
    source: EditSource | undefined,
  ): Set<Ref> {
    const out = new Set<Ref>();
    for (const ref of instanceMembers.keys()) if (!tree.isInstance(ref)) out.add(ref);
    for (const ref of tree.instances()) if (!instanceMembers.has(ref)) out.add(ref);
    if (instanceMembers.size === 0 && tree.instances().length === 0) return out;
    const doc = documentTree(source?.doc ?? def);
    for (const ref of changed) {
      if (tree.isInstance(ref)) out.add(ref);
      for (const i of memberOf.get(ref) ?? []) out.add(i);
      for (const a of doc.ancestors(ref)) if (tree.isInstance(a)) out.add(a);
    }
    return out;
  }

  function indexBucket(def: SceneDefinition, registry: Registry, key: BulkKey) {
    const info = registry.bulkKey(key);
    if (!info) return;
    const layer = defaultLayer(registry.types.get(info.type), true, registry.layers);
    bulkEntries(def, key).forEach((value, i) => {
      const ref = bulkId(key, i);
      const e = entryOf(registry, ref, info.type, layer, bulkGeometry(registry, key, value));
      if (e) insert(e);
    });
  }

  function entityEntry(registry: Registry, e: EntityDef): IndexEntry | undefined {
    const t = registry.types.get(e.type);
    if (!t) return undefined;
    const layer =
      e.layer && registry.layers.some((l) => l.name === e.layer)
        ? e.layer
        : defaultLayer(t, false, registry.layers);
    return entryOf(registry, e.id, e.type, layer, entityGeometry(t, e), e.behaviors);
  }

  /** The first entity per id, as refs resolve. */
  function entityMap(def: SceneDefinition): Map<string, EntityDef> {
    const out = new Map<string, EntityDef>();
    for (const e of def.entities ?? []) if (!out.has(e.id)) out.set(e.id, e);
    return out;
  }

  /** Re-stamps `z` from document order (bulk keys in canonical order, then entities); returns the refs restacked. */
  function restack(def: SceneDefinition, registry: Registry, ents: Map<string, EntityDef>) {
    const layerIndex = new Map(registry.layers.map((l, i) => [l.name, i]));
    const moved: Ref[] = [];
    let order = 0;
    const stamp = (ref: Ref, entityZOf = 0) => {
      const e = entries.get(ref);
      if (!e) return;
      const z = zOf(layerIndex.get(e.layer) ?? 0, entityZOf, order++);
      if (e.z === z) return;
      entries.set(ref, { ...e, z });
      moved.push(ref);
    };
    for (const key of bulkKeysOf(def)) {
      const n = bulkEntries(def, key).length;
      for (let i = 0; i < n; i++) stamp(bulkId(key, i));
    }
    for (const [id, e] of ents) stamp(id, entityZ(e));
    return moved;
  }

  const bucketSig = (def: SceneDefinition, key: BulkKey) => JSON.stringify(bulkEntries(def, key));

  function remember(def: SceneDefinition, key: BulkKey, sig = bucketSig(def, key)) {
    const count = bulkEntries(def, key).length;
    if (count > 0) buckets.set(key, { sig, count });
    else buckets.delete(key);
  }

  function clear() {
    entries.clear();
    hash.clear();
    buckets.clear();
    instanceMembers.clear();
    memberOf.clear();
  }

  const index: EditableSpatialIndex = {
    rebuild(def, registry, source) {
      clear();
      for (const key of bulkKeysOf(def)) {
        indexBucket(def, registry, key);
        remember(def, key);
      }
      const ents = entityMap(def);
      for (const e of ents.values()) {
        const entry = entityEntry(registry, e);
        if (entry) insert(entry);
      }
      restack(def, registry, ents);
      const tree = editTree(def, source);
      for (const ref of tree.instances()) indexInstance(tree, ref);
    },

    update(def, registry, touched, source) {
      if (touched.length === 0) return index.rebuild(def, registry, source);
      const tree = editTree(def, source);
      const touchedKeys = new Set<BulkKey>();
      const touchedIds = new Set<string>();
      for (const ref of touched) {
        const bulk = parseBulkId(ref);
        if (bulk) touchedKeys.add(bulk.key);
        else touchedIds.add(ref);
      }
      for (const ref of tree.below(touchedIds)) touchedIds.add(ref);

      for (const key of new Set([...buckets.keys(), ...bulkKeysOf(def)])) {
        const sig = bucketSig(def, key);
        const was = buckets.get(key);
        if (!touchedKeys.has(key) && (was?.sig ?? "[]") === sig) continue;
        for (let i = 0; i < (was?.count ?? 0); i++) drop(bulkId(key, i));
        indexBucket(def, registry, key);
        remember(def, key, sig);
      }

      const ents = entityMap(def);
      const changed = new Set<Ref>(touchedIds);
      for (const ref of [...entries.keys()]) {
        if (instanceMembers.has(ref) || parseBulkId(ref)) continue;
        if (ents.has(ref) && !touchedIds.has(ref)) continue;
        drop(ref);
        changed.add(ref);
      }
      for (const id of touchedIds) {
        const e = ents.get(id);
        const entry = e && entityEntry(registry, e);
        if (entry) insert(entry);
      }
      for (const ref of restack(def, registry, ents)) changed.add(ref);
      for (const ref of staleInstances(def, tree, changed, source)) indexInstance(tree, ref);
    },

    query: (rect) =>
      hash
        .query(rect)
        .map((ref) => entries.get(ref)!)
        .sort(topFirst),

    get: (ref) => entries.get(ref),
    entries: () => [...entries.values()].sort(topFirst),
    get size() {
      return entries.size;
    },
  };
  return index;
}
