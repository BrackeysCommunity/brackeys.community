import { SPRITE } from "../game/behaviors/sprite";
import { Z_LIMIT } from "../game/fields";
import type { RegisteredType, Registry } from "../game/types";
import { behaviorBlocks, bulkEntries, bulkId, bulkKeysOf, parseBulkId } from "../scene/expand";
import { defaultLayer } from "../scene/layers";
import { spriteBoxOf, type SpriteAssetLookup } from "../scene/render-geometry";
import { geometryFields } from "../scene/schema";
import { aabb, aabbUnion, translateShape } from "../scene/shape-geometry";
import { parseShape } from "../scene/shapes";
import type { Aabb, BulkKey, EntityDef, Pt, Ref, SceneDefinition, ShapeObj } from "../scene/types";
import type { IndexEntry, SpatialIndex } from "./tools";

export const DEFAULT_CELL = 256;

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
  /** The shape in world px. */
  shape?: ShapeObj;
  at?: Pt;
  /** The path's waypoints, world px. */
  pts?: Pt[];
  /** The path runs a closing segment from its last point back to its first. */
  loop?: boolean;
};

/** An index entry, with the world box its sprite draws when it carries one. */
export type SpriteIndexEntry = IndexEntry & { sprite?: ShapeObj };

/** The world box `e`'s sprite draws, when the index found one. */
export const spriteHitOf = (e: IndexEntry): ShapeObj | undefined => (e as SpriteIndexEntry).sprite;

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

const pointBox = ([x, y]: Pt): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

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

/** An entry would cover more cells than this; it lives on a list every query scans. */
const MAX_CELLS = 1024;

export type SpatialIndexOptions = {
  /** World px per grid cell; default 256. */
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
  /** Indexes `def` from scratch. */
  rebuild(def: SceneDefinition, registry: Registry): void;
  /**
   * Brings the index up to `def` after a change to `touched` (refs of the new
   * document, as `applyOps` and `EditorSession` report them). An empty list
   * rebuilds. A bulk key whose entries changed is re-indexed whole, since its
   * indices shift; entities missing from `def` are dropped.
   */
  update(def: SceneDefinition, registry: Registry, touched: readonly Ref[]): void;
};

/**
 * The uniform grid of AABBs picking, marquee and snapping query. Entries
 * cover every bulk entry and every entity with a shape or point, `off`
 * entities and notes included; an entity on a path is indexed at the
 * path's first point. An entity carrying a sprite is also hit by the box
 * the sprite draws; a point entity's sprite box is its geometry.
 */
export function createSpatialIndex(opts: SpatialIndexOptions = {}): EditableSpatialIndex {
  const cell = opts.cell ?? DEFAULT_CELL;
  const keyOf = (ref: Ref) => opts.keyOf?.(ref) ?? ref;
  const entries = new Map<Ref, IndexEntry>();
  const cells = new Map<string, Set<Ref>>();
  const cellsOf = new Map<Ref, string[]>();
  const big = new Set<Ref>();
  /** Each indexed bulk key's entries as last indexed, to spot a changed bucket. */
  const buckets = new Map<BulkKey, { sig: string; count: number }>();

  const span = (b: Aabb) => ({
    x0: Math.floor(b.minX / cell),
    y0: Math.floor(b.minY / cell),
    x1: Math.floor(b.maxX / cell),
    y1: Math.floor(b.maxY / cell),
  });

  function insert(e: IndexEntry) {
    entries.set(e.ref, e);
    const { x0, y0, x1, y1 } = span(e.aabb);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
      big.add(e.ref);
      return;
    }
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        let set = cells.get(k);
        if (!set) cells.set(k, (set = new Set()));
        set.add(e.ref);
        keys.push(k);
      }
    }
    cellsOf.set(e.ref, keys);
  }

  function drop(ref: Ref) {
    if (!entries.delete(ref)) return;
    big.delete(ref);
    for (const k of cellsOf.get(ref) ?? []) {
      const set = cells.get(k);
      set?.delete(ref);
      if (set?.size === 0) cells.delete(k);
    }
    cellsOf.delete(ref);
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
    const block = registry.types.has(type)
      ? behaviorBlocks(registry, type, written)[SPRITE.name]
      : undefined;
    const sprite =
      block &&
      spriteBoxOf(
        block,
        { shape: g.shape, at: g.at, path: g.pts ? { pts: g.pts } : undefined },
        opts.asset,
      );
    const box = g.shape ? aabb(g.shape) : pointBox(g.at!);
    const entry: SpriteIndexEntry = {
      ref,
      key: keyOf(ref),
      type,
      layer,
      aabb: sprite ? aabbUnion(box, sprite.box) : box,
      z: 0,
      geometry: g.shape ?? sprite?.shape ?? own,
      ...(sprite ? { sprite: sprite.shape } : {}),
    };
    return entry;
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

  /** Re-stamps `z` from document order: bulk keys in canonical order, then entities. */
  function restack(def: SceneDefinition, registry: Registry, ents: Map<string, EntityDef>) {
    const layerIndex = new Map(registry.layers.map((l, i) => [l.name, i]));
    let order = 0;
    const stamp = (ref: Ref, entityZOf = 0) => {
      const e = entries.get(ref);
      if (!e) return;
      const z = zOf(layerIndex.get(e.layer) ?? 0, entityZOf, order++);
      if (e.z !== z) entries.set(ref, { ...e, z });
    };
    for (const key of bulkKeysOf(def)) {
      const n = bulkEntries(def, key).length;
      for (let i = 0; i < n; i++) stamp(bulkId(key, i));
    }
    for (const [id, e] of ents) stamp(id, entityZ(e));
  }

  const bucketSig = (def: SceneDefinition, key: BulkKey) => JSON.stringify(bulkEntries(def, key));

  function remember(def: SceneDefinition, key: BulkKey, sig = bucketSig(def, key)) {
    const count = bulkEntries(def, key).length;
    if (count > 0) buckets.set(key, { sig, count });
    else buckets.delete(key);
  }

  function clear() {
    entries.clear();
    cells.clear();
    cellsOf.clear();
    big.clear();
    buckets.clear();
  }

  const index: EditableSpatialIndex = {
    rebuild(def, registry) {
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
    },

    update(def, registry, touched) {
      if (touched.length === 0) return index.rebuild(def, registry);
      const touchedKeys = new Set<BulkKey>();
      const touchedIds = new Set<string>();
      for (const ref of touched) {
        const bulk = parseBulkId(ref);
        if (bulk) touchedKeys.add(bulk.key);
        else touchedIds.add(ref);
      }

      for (const key of new Set([...buckets.keys(), ...bulkKeysOf(def)])) {
        const sig = bucketSig(def, key);
        const was = buckets.get(key);
        if (!touchedKeys.has(key) && (was?.sig ?? "[]") === sig) continue;
        for (let i = 0; i < (was?.count ?? 0); i++) drop(bulkId(key, i));
        indexBucket(def, registry, key);
        remember(def, key, sig);
      }

      const ents = entityMap(def);
      for (const ref of [...entries.keys()]) {
        if (!parseBulkId(ref) && (!ents.has(ref) || touchedIds.has(ref))) drop(ref);
      }
      for (const id of touchedIds) {
        const e = ents.get(id);
        const entry = e && entityEntry(registry, e);
        if (entry) insert(entry);
      }
      restack(def, registry, ents);
    },

    query(rect) {
      const { x0, y0, x1, y1 } = span(rect);
      const seen = new Set<Ref>(big);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > cells.size) {
        for (const ref of cellsOf.keys()) seen.add(ref);
      } else {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++)
            for (const ref of cells.get(`${x},${y}`) ?? []) seen.add(ref);
        }
      }
      const out: IndexEntry[] = [];
      for (const ref of seen) {
        const e = entries.get(ref)!;
        if (overlaps(e.aabb, rect)) out.push(e);
      }
      return out.sort((a, b) => b.z - a.z);
    },

    get: (ref) => entries.get(ref),
    entries: () => [...entries.values()].sort((a, b) => b.z - a.z),
    get size() {
      return entries.size;
    },
  };
  return index;
}
