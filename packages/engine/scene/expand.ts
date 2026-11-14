import { z } from "zod";

import { BEHAVIORS_FIELD, type BehaviorBlock, type BehaviorName } from "../game/behaviors";
import { DEFAULT_GRAVITY, DEFAULT_PHYSICS } from "../game/defaults";
import { BASE_FIELDS } from "../game/fields";
import { ENGINE_SETTING_KEYS, ENGINE_SETTINGS } from "../game/primitives";
import type { RegisteredType, Registry } from "../game/types";
import { isPlainObject } from "../project/kinds/define";
import { bulkId } from "./bulk-ref";
import { gridTurns, instanceStepsIn, placeInstance, resolveSceneDetailed } from "./resolve";
import { fieldKind } from "./schema";
import { parseShape } from "./shapes";
import type { Dihedral } from "./transform";
import { scopeBehaviorRefs } from "./translate";
import {
  RESERVED_SCENE_KEYS,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type EntityTypeName,
  type ExpandedScene,
  type GroupDef,
  type InstanceDef,
  type PrefabLibrary,
  type Pt,
  type ResolvedSettings,
  type RuntimeEntity,
  type SceneDefinition,
  type SceneIssue,
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
  /** The project's `game-settings` `engine` block: `gravity` and `physics`, each used when valid. */
  project?: Readonly<Record<string, unknown>>;
  /** The game's world defaults (`GameDefinition.world`): `gravity`, `physics` and `grid`. */
  game?: Partial<ResolvedSettings>;
};

type EngineSettingKey = (typeof ENGINE_SETTING_KEYS)[number];

const ENGINE_DEFAULTS = {
  gravity: DEFAULT_GRAVITY,
  physics: DEFAULT_PHYSICS,
  grid: null,
  view: { projection: "orthogonal" },
  camera: undefined,
} satisfies Record<EngineSettingKey, unknown>;

/** The sources each engine key reads after the scene: `grid` skips the project, `view` reads none. */
const SOURCES_OF: Record<EngineSettingKey, readonly (keyof SettingsSources)[]> = {
  gravity: ["project", "game"],
  physics: ["project", "game"],
  grid: ["game"],
  view: [],
  camera: [],
};

function sourceValue(sources: SettingsSources, from: keyof SettingsSources, key: EngineSettingKey) {
  const value = sources[from]?.[key];
  if (value === undefined || value === null) return undefined;
  // the project block is stored data; one that fails the setting's schema is passed over
  if (from === "project" && !z.safeParse(ENGINE_SETTINGS[key], value).success) return undefined;
  return value;
}

/**
 * The scene's settings with every engine key filled. `gravity` and
 * `physics` come from the scene's `settings`, else the project's engine
 * block, else the game's world, else the engine's default; `grid` from the
 * scene, else the game's world, else none; `view` from the scene, else
 * orthogonal (`game/defaults` holds the engine's values); `camera` from the
 * scene only, absent when it sets none. The game's own
 * keys are the scene's, as given.
 */
export function resolveSettings(
  settings: SceneSettings | undefined,
  sources: SettingsSources = {},
): ResolvedSettings {
  const out: Record<string, unknown> = {};
  for (const key of ENGINE_SETTING_KEYS) {
    let value: unknown = settings?.[key];
    for (const from of SOURCES_OF[key]) value ??= sourceValue(sources, from, key);
    value ??= ENGINE_DEFAULTS[key];
    if (value !== undefined) out[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (!(key in out) && value !== undefined) out[key] = structuredClone(value);
  }
  return out as ResolvedSettings;
}

/** The sources a scene under `registry` resolves through: `engine` (the project's block), then the game's world. */
export function settingsSources(
  registry: Registry,
  engine?: Readonly<Record<string, unknown>>,
): SettingsSources {
  const world = registry.game?.world;
  const game: Partial<ResolvedSettings> = {};
  if (world?.gravity) game.gravity = world.gravity;
  if (world?.physics) game.physics = world.physics;
  if (world?.grid) game.grid = world.grid;
  return { ...(engine ? { project: engine } : {}), game };
}

/** The physics backend `def` resolves to, so a host can load Rapier only when it says "rapier". */
export function scenePhysics(
  def: SceneDefinition,
  registry: Registry,
  engine?: Readonly<Record<string, unknown>>,
): "rapier" | "none" {
  return resolveSettings(def.settings, settingsSources(registry, engine)).physics;
}

/** The game's default backend: the project's `engine.physics`, else `world.physics`, else Rapier. */
export function defaultPhysics(
  registry: Registry,
  engine?: Readonly<Record<string, unknown>>,
): "rapier" | "none" {
  return resolveSettings(undefined, settingsSources(registry, engine)).physics;
}

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
  const own = isPlainObject(written) ? written : {};
  const out: Record<BehaviorName, BehaviorBlock> = {};
  for (const name of registry.behaviorNames) {
    const required = rules.required.get(name);
    const carried =
      required !== undefined || (Object.hasOwn(own, name) && rules.allowed.includes(name));
    if (!carried) continue;
    const block: Record<string, unknown> = structuredClone({ ...rules.defaults.get(name) });
    const fields = own[name];
    if (isPlainObject(fields)) {
      for (const [field, value] of Object.entries(fields))
        if (value !== undefined) block[field] = structuredClone(value);
    }
    out[name] = block;
  }
  return out;
}

const IDENTITY: Dihedral = { rot: 0, flip: false };

/**
 * What the runtime loads for one scene entity of type `t`: the editor's
 * fields dropped (`layer` and a non-zero `z` kept), shapes as objects, whole
 * behavior blocks, and `transform` when `transform` turns or flips it.
 */
export function runtimeEntity(
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

/**
 * One prefab instance's entities as a load expands them: ids
 * `<instance>/<child>` (refs between its children remapped to them, the
 * behavior blocks' entity refs by `scopeBehaviorRefs`), fields,
 * behaviors, `z`, layers and `transform`, in spawn-group order, `off`
 * children and types that don't load dropped. `group` is the instance's
 * group; `cells` says the scene's turns are grid turns (`gridTurns`). An
 * issue when the prefab is missing, cyclic or too deep; a child of an
 * unregistered type throws, as a load does.
 */
export function expandInstance(
  inst: InstanceDef,
  library: PrefabLibrary,
  registry: Registry,
  opts: { group?: GroupDef; cells?: boolean } = {},
): { ok: true; entities: RuntimeEntity[] } | { ok: false; issue: SceneIssue } {
  const placed = placeInstance(
    library.get(inst.prefab),
    inst,
    registry,
    instanceStepsIn(inst, opts.group),
    opts.cells === true,
    library,
  );
  if (!placed.ok) return placed;
  const groups: RuntimeEntity[][] = registry.spawnGroups.map(() => []);
  const ids = new Set(placed.children.map((c) => c.def.id));
  const has = (id: string) => ids.has(id);
  for (const child of placed.children) {
    if (child.def.off) continue;
    const def = scopeBehaviorRefs(registry, child.def, has);
    const t = registry.types.get(def.type);
    if (!t) throw new Error(`expandInstance: ${def.id} has unregistered type "${def.type}"`);
    const group = registry.spawnGroupOf(def.type);
    if (group === undefined) continue;
    groups[group]?.push(runtimeEntity(registry, def, t, child.transform));
  }
  return { ok: true, entities: groups.flat() };
}

/** Whether `scene` is already expanded: an `ExpandedScene` has an `entities` list and, unlike a document, no `v`. */
export function isExpandedScene(scene: SceneDefinition | ExpandedScene): scene is ExpandedScene {
  return !("v" in scene) && Array.isArray(scene.entities);
}

export type ExpandOptions = {
  /** The prefabs the scene's instances name; an instance whose prefab is missing loads nothing. */
  prefabs?: PrefabLibrary;
  /** The project's `engine` block, which settings resolve through between the scene and the game. */
  engine?: Readonly<Record<string, unknown>>;
};

/**
 * What the runtime loads, as the scene's resolved view (`resolveScene`)
 * holds it: group transforms applied, each instance's children through
 * `expandInstance` (ids `<instance>/<child>`); bulk entries become `~key:index` entities, `off` entities and
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
  // the document's own entities with their groups applied; instances expand one by one below
  const { def, origins } = resolveSceneDetailed({ ...source, instances: [] }, registry);
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

  const library = opts.prefabs;
  const cells = gridTurns(source);
  for (const inst of source.instances ?? []) {
    if (!library) break;
    const group = inst.group === undefined ? undefined : source.groups?.[inst.group];
    const out = expandInstance(inst, library, registry, { group, cells });
    if (!out.ok) continue;
    for (const e of out.entities) {
      const at = registry.spawnGroupOf(e.type);
      if (at !== undefined) groups[at]?.push(e);
    }
  }

  return {
    name: def.name,
    ...(def.game !== undefined ? { game: def.game } : {}),
    bounds: [def.bounds[0], def.bounds[1], def.bounds[2], def.bounds[3]],
    settings: resolveSettings(def.settings, settingsSources(registry, opts.engine)),
    entities: groups.flat(),
  };
}
