import { BASE_FIELDS } from "../game/fields";
import { DEFAULT_GRAVITY } from "../game/primitives";
import type { RegisteredType, Registry } from "../game/types";
import { bulkId } from "./bulk-ref";
import { resolveScene } from "./resolve";
import { fieldKind } from "./schema";
import { parseShape } from "./shapes";
import {
  RESERVED_SCENE_KEYS,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type ExpandedScene,
  type PrefabLibrary,
  type Pt,
  type ResolvedSettings,
  type RuntimeEntity,
  type SceneDefinition,
  type SceneSettings,
  type ShapeObj,
  type ShapeTuple,
} from "./types";

export { bulkId, bulkKeyType, parseBulkId } from "./bulk-ref";

const isBulkKey = (def: SceneDefinition, k: string) =>
  !RESERVED_SCENE_KEYS.includes(k) && Array.isArray(def[k]);

/** The bulk keys a document holds, in canonical order. Needs no registry: any other top-level array is one. */
export function bulkKeysOf(def: SceneDefinition): BulkKey[] {
  return Object.keys(def)
    .filter((k) => isBulkKey(def, k))
    .sort();
}

/** A bulk key's entries; empty when the document has none. */
export function bulkEntries(def: SceneDefinition, k: BulkKey): BulkEntry[] {
  return isBulkKey(def, k) ? (def[k] as BulkEntry[]) : [];
}

function toShape(tuple: unknown, where: string): ShapeObj {
  const result = parseShape(tuple);
  if (!result.ok) throw new Error(`expandScene: ${where}: ${result.issue.message}`);
  return result.shape;
}

const pt = ([x, y]: Pt): Pt => [x, y];

function resolveSettings(settings: SceneSettings | undefined): ResolvedSettings {
  const { gravity, ...rest } = structuredClone(settings ?? {});
  return { gravity: gravity ? pt(gravity) : pt(DEFAULT_GRAVITY), ...rest };
}

function runtimeEntity(e: EntityDef, t: RegisteredType): RuntimeEntity {
  const out: Record<string, unknown> = { id: e.id, type: e.type };
  for (const [field, value] of Object.entries(e)) {
    if (field === "type" || field in BASE_FIELDS || value === undefined) continue;
    const schema = t.shape[field];
    out[field] =
      schema && fieldKind(schema) === "shape"
        ? toShape(value, `${e.id}.${field}`)
        : structuredClone(value);
  }
  return out as RuntimeEntity;
}

/** Whether `scene` is already expanded: an `ExpandedScene` has an `entities` list and, unlike a document, no `v`. */
export function isExpandedScene(scene: SceneDefinition | ExpandedScene): scene is ExpandedScene {
  return !("v" in scene) && Array.isArray(scene.entities);
}

export type ExpandOptions = {
  /** The prefabs the scene's instances name; an instance whose prefab is missing loads nothing. */
  prefabs?: PrefabLibrary;
};

/**
 * What the runtime loads, from the scene's resolved view (`resolveScene`:
 * instances inlined as `<instance>/<child>`, group offsets applied): bulk
 * entries become `~key:index` entities, `off` entities and types that don't
 * load are dropped, along with the editor's fields, shapes become objects,
 * and settings get their defaults. Entities come in `registry.spawnGroups`
 * order: within a group, bulk entries first (in `registry.bulkKeys` order),
 * then entities in file order, instance children after the document's own.
 */
export function expandScene(
  source: SceneDefinition,
  registry: Registry,
  opts: ExpandOptions = {},
): ExpandedScene {
  const def = resolveScene(source, registry, opts.prefabs);
  if (def.game !== undefined && def.game !== registry.id) {
    throw new Error(
      `expandScene: scene "${def.name}" is for game "${def.game}", not "${registry.id}"`,
    );
  }
  const groups: RuntimeEntity[][] = registry.spawnGroups.map(() => []);

  for (const b of registry.bulkKeys) {
    const rows = def[b.key];
    const group = registry.spawnGroupOf(b.type);
    const target = group === undefined ? undefined : groups[group];
    if (!Array.isArray(rows) || !target) continue;
    rows.forEach((value, index) => {
      const id = bulkId(b.key, index);
      const field = b.form === "shape" ? toShape(value as ShapeTuple, id) : pt(value as Pt);
      target.push({
        id,
        type: b.type,
        [b.field]: field,
        ...(b.material ? { material: b.material } : {}),
      });
    });
  }

  for (const e of def.entities ?? []) {
    if (e.off) continue;
    const t = registry.types.get(e.type);
    if (!t) throw new Error(`expandScene: ${e.id} has unregistered type "${e.type}"`);
    const group = registry.spawnGroupOf(e.type);
    if (group !== undefined) groups[group]?.push(runtimeEntity(e, t));
  }

  return {
    name: def.name,
    ...(def.game !== undefined ? { game: def.game } : {}),
    bounds: [def.bounds[0], def.bounds[1], def.bounds[2], def.bounds[3]],
    settings: resolveSettings(def.settings),
    entities: groups.flat(),
  };
}
