import { BEHAVIORS_FIELD, type BehaviorBlock, type BehaviorName } from "../game/behaviors";
import { BASE_FIELDS } from "../game/fields";
import { DEFAULT_GRAVITY, ENGINE_SETTING_KEYS } from "../game/primitives";
import type { RegisteredType, Registry } from "../game/types";
import { bulkId } from "./bulk-ref";
import { resolveSceneDetailed } from "./resolve";
import { fieldKind } from "./schema";
import { parseShape } from "./shapes";
import type { Dihedral } from "./transform";
import {
  RESERVED_SCENE_KEYS,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type EntityTypeName,
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

/** Where engine settings come from besides the scene, highest first after it. */
export type SettingsSources = {
  /** The project's `game-settings` `engine` block. */
  project?: Record<string, unknown>;
  /** The game's defaults. */
  game?: Partial<ResolvedSettings>;
};

const ENGINE_DEFAULTS = {
  gravity: DEFAULT_GRAVITY,
  physics: "rapier",
  grid: null,
  view: { projection: "orthogonal" },
} satisfies Record<(typeof ENGINE_SETTING_KEYS)[number], unknown>;

/**
 * The scene's settings with every engine key filled: each comes from the
 * scene's `settings`, else the project's engine block, else the game's
 * default, else the engine's (`[0, 1200]` gravity, Rapier, no grid,
 * orthogonal). The game's own keys are the scene's, as given.
 */
export function resolveSettings(
  settings: SceneSettings | undefined,
  sources: SettingsSources = {},
): ResolvedSettings {
  const out: Record<string, unknown> = {};
  for (const key of ENGINE_SETTING_KEYS) {
    const value =
      settings?.[key] ?? sources.project?.[key] ?? sources.game?.[key] ?? ENGINE_DEFAULTS[key];
    out[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (!(key in out) && value !== undefined) out[key] = structuredClone(value);
  }
  return out as ResolvedSettings;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The behavior blocks an entity of `type` runs with, in registration order:
 * each required behavior and each allowed one `written` carries, as the
 * behavior's field defaults, then the type's (`behaviorRules`), then the
 * entity's own fields. `written` is the entity's `behaviors` as on disk;
 * omit it for a bulk entry, which carries only the required ones.
 */
export function behaviorBlocks(
  registry: Registry,
  type: EntityTypeName,
  written?: unknown,
): Record<BehaviorName, BehaviorBlock> {
  const rules = registry.behaviorRules(type);
  const own = isRecord(written) ? written : {};
  const out: Record<BehaviorName, BehaviorBlock> = {};
  for (const name of registry.behaviorNames) {
    const required = rules.required.get(name);
    const carried =
      required !== undefined || (Object.hasOwn(own, name) && rules.allowed.includes(name));
    if (!carried) continue;
    const block: Record<string, unknown> = structuredClone({ ...rules.defaults.get(name) });
    const fields = own[name];
    if (isRecord(fields)) {
      for (const [field, value] of Object.entries(fields))
        if (value !== undefined) block[field] = structuredClone(value);
    }
    out[name] = block;
  }
  return out;
}

const IDENTITY: Dihedral = { rot: 0, flip: false };

function runtimeEntity(
  registry: Registry,
  e: EntityDef,
  t: RegisteredType,
  transform: Dihedral,
): RuntimeEntity {
  const out: Record<string, unknown> = { id: e.id, type: e.type };
  if (e.layer !== undefined) out.layer = e.layer;
  if (typeof e.z === "number" && e.z !== 0) out.z = e.z;
  for (const [field, value] of Object.entries(e)) {
    if (field === "type" || field === BEHAVIORS_FIELD || field in BASE_FIELDS) continue;
    if (value === undefined) continue;
    const schema = t.shape[field];
    out[field] =
      schema && fieldKind(schema) === "shape"
        ? toShape(value, `${e.id}.${field}`)
        : structuredClone(value);
  }
  const behaviors = behaviorBlocks(registry, e.type, e[BEHAVIORS_FIELD]);
  if (Object.keys(behaviors).length > 0) out.behaviors = behaviors;
  if (transform.rot !== 0 || transform.flip)
    out.transform = { turn: transform.rot, flip: transform.flip };
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
 * instances inlined as `<instance>/<child>`, group and instance transforms
 * applied): bulk entries become `~key:index` entities, `off` entities and
 * types that don't load are dropped, along with the editor's fields (`layer`
 * and a non-zero `z` stay), shapes become objects, behavior blocks are whole
 * (`behaviorBlocks`), a turned or flipped entity records its `transform`,
 * and settings get their defaults. Entities come in `registry.spawnGroups`
 * order: within a group, bulk entries first (in `registry.bulkKeys` order),
 * then entities in file order, instance children after the document's own.
 */
export function expandScene(
  source: SceneDefinition,
  registry: Registry,
  opts: ExpandOptions = {},
): ExpandedScene {
  const { def, origins } = resolveSceneDetailed(source, registry, opts.prefabs);
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
    const blocks = behaviorBlocks(registry, b.type);
    const behaviors = Object.keys(blocks).length > 0 ? blocks : undefined;
    rows.forEach((value, index) => {
      const id = bulkId(b.key, index);
      const field = b.form === "shape" ? toShape(value as ShapeTuple, id) : pt(value as Pt);
      target.push({
        id,
        type: b.type,
        [b.field]: field,
        ...(b.material ? { material: b.material } : {}),
        ...(behaviors ? { behaviors: structuredClone(behaviors) } : {}),
      });
    });
  }

  (def.entities ?? []).forEach((e, i) => {
    if (e.off) return;
    const t = registry.types.get(e.type);
    if (!t) throw new Error(`expandScene: ${e.id} has unregistered type "${e.type}"`);
    const group = registry.spawnGroupOf(e.type);
    if (group === undefined) return;
    const transform = origins[i]?.transform ?? IDENTITY;
    groups[group]?.push(runtimeEntity(registry, e, t, transform));
  });

  return {
    name: def.name,
    ...(def.game !== undefined ? { game: def.game } : {}),
    bounds: [def.bounds[0], def.bounds[1], def.bounds[2], def.bounds[3]],
    settings: resolveSettings(def.settings),
    entities: groups.flat(),
  };
}
