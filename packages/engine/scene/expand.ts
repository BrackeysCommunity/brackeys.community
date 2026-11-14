import { z } from "zod";

import { BEHAVIORS_FIELD, type BehaviorBlock, type BehaviorName } from "../game/behaviors";
import { DEFAULT_GRAVITY, DEFAULT_PHYSICS } from "../game/defaults";
import { BASE_FIELDS } from "../game/fields";
import { ENGINE_SETTING_KEYS, ENGINE_SETTINGS } from "../game/primitives";
import type { RegisteredType, Registry } from "../game/types";
import { isPlainObject } from "../project/kinds/define";
import { bulkId } from "./bulk-ref";
import {
  CHILD_SEPARATOR,
  gridTurns,
  instanceFrame,
  placeInstance,
  resolveWith,
  sceneFrames,
  type PlacedInstanceChild,
} from "./resolve";
import { fieldKind } from "./schema";
import { parseShape } from "./shapes";
import { frame, type Orientation, type Transform2D } from "./transform";
import { scopeBehaviorRefs } from "./translate";
import {
  RESERVED_SCENE_KEYS,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type EntityTypeName,
  type ExpandedScene,
  type InstanceDef,
  type Prefab,
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

const IDENTITY: Orientation = { rot: 0, flip: false };

/**
 * What the runtime loads for one scene entity of type `t`: the editor's
 * fields dropped (`layer` and a non-zero `z` kept), shapes as objects, whole
 * behavior blocks, `transform` when `transform` (degrees clockwise, and a
 * flip) turns or flips it, and `parent` when one is given.
 */
export function runtimeEntity(
  registry: Registry,
  e: EntityDef,
  t: RegisteredType,
  transform: Orientation,
  parent?: string,
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
    out.transform = { rot: transform.rot, flip: transform.flip };
  if (parent !== undefined) out.parent = parent;
  return out as RuntimeEntity;
}

/** The id each prefab gains in `withOrigins`: no entity id can take it, and it names no bulk entry. */
const ORIGIN = "~origin";
const ORIGIN_SUFFIX = `${CHILD_SEPARATOR}${ORIGIN}`;
const NODE: EntityTypeName = "node";

type Origins = { source: Map<string, Prefab>; marked: Map<string, Prefab> };
/** Per library, its prefabs each with an origin child; kept in step with the library's entries. */
const ORIGINS = new WeakMap<PrefabLibrary, Origins>();

/**
 * `library` with a `node` child at each prefab's origin, so the resolver
 * places it as it places every child: under each instance's params,
 * overrides, turns, variant bases and `off`, it lands where that
 * instance's node goes. The same map comes back for the same library, so
 * resolved prefabs stay cached.
 */
function withOrigins(library: PrefabLibrary): PrefabLibrary {
  let o = ORIGINS.get(library);
  if (!o) ORIGINS.set(library, (o = { source: new Map(), marked: new Map() }));
  for (const [id, prefab] of library) {
    if (o.source.get(id) === prefab) continue;
    o.source.set(id, prefab);
    o.marked.set(id, {
      ...prefab,
      entities: [...prefab.entities, { id: ORIGIN, type: NODE, at: [0, 0] }],
    });
  }
  if (o.source.size !== library.size) {
    for (const id of [...o.source.keys()]) {
      if (library.has(id)) continue;
      o.source.delete(id);
      o.marked.delete(id);
    }
  }
  return o.marked;
}

/** The id of the nearest of `nodes` that encloses `id` (`room-1/door-1` for `room-1/door-1/panel`). */
function enclosing(id: string, nodes: ReadonlySet<string>): string | undefined {
  for (let i = id.lastIndexOf(CHILD_SEPARATOR); i > 0; i = id.lastIndexOf(CHILD_SEPARATOR, i - 1)) {
    const at = id.slice(0, i);
    if (nodes.has(at)) return at;
  }
  return undefined;
}

/**
 * One prefab instance's entities as a load expands them. First a `node`
 * at the instance's id, at its world origin and turned by its angle (`rot`
 * in degrees), under `parent` when one is given; then one for each nested
 * instance (`<instance>/<nested>`), each under the nested instance's
 * `parent` if it has one, else under the one that holds it, with its layer
 * and summed `z`. Then the children, ids `<instance>/<child>` (refs
 * between its children remapped to them, the behavior blocks' entity refs
 * by `scopeBehaviorRefs`), fields, behaviors, `z`, layers and `transform`,
 * in spawn-group order, each under its own `parent` in the prefab, else
 * under the nearest enclosing instance's node; `nodes` counts the leading
 * nodes, the rest being the prefab's children. `off` children and types
 * that don't load are dropped; an `off` instance gives nothing. `steps` are
 * the frames above the instance, innermost first (default none);
 * `cells` says the scene's turns are grid turns (`gridTurns`). An issue
 * when the prefab is missing, cyclic or too deep; a child of an
 * unregistered type throws, as a load does.
 */
export function expandInstance(
  inst: InstanceDef,
  library: PrefabLibrary,
  registry: Registry,
  opts: {
    steps?: readonly Transform2D[];
    parent?: string;
    cells?: boolean;
  } = {},
): { ok: true; entities: RuntimeEntity[]; nodes: number } | { ok: false; issue: SceneIssue } {
  const marked = withOrigins(library);
  const placed = placeInstance(
    marked.get(inst.prefab),
    inst,
    registry,
    [frame(instanceFrame(inst)), ...(opts.steps ?? [])],
    opts.cells === true,
    marked,
  );
  if (!placed.ok) return placed;
  const origins: { id: string; child: PlacedInstanceChild }[] = [];
  const nodeIds = new Set<string>();
  const rest: PlacedInstanceChild[] = [];
  for (const child of placed.children) {
    const origin = child.child.child === ORIGIN || child.child.child.endsWith(ORIGIN_SUFFIX);
    if (!origin) rest.push(child);
    else if (!child.def.off) {
      const id = child.def.id.slice(0, -ORIGIN_SUFFIX.length);
      // a variant carries its base's origin and its own, at the same place
      if (nodeIds.has(id)) continue;
      nodeIds.add(id);
      origins.push({ id, child });
    }
  }
  const nodeType = registry.types.get(NODE);
  if (!nodeType) throw new Error(`expandInstance: the registry has no "${NODE}" type`);
  const ids = new Set(rest.filter((c) => !c.def.off).map((c) => c.def.id));
  const linked = (parent: unknown) =>
    typeof parent === "string" && (ids.has(parent) || nodeIds.has(parent)) ? parent : undefined;
  const nodes = origins.map(({ id, child: { def, transform, nodeParent } }) => {
    const node: EntityDef = { id, type: NODE, at: def.at as Pt };
    if (transform.rot !== 0) node.rot = transform.rot;
    if (def.layer !== undefined) node.layer = def.layer;
    if (def.z !== undefined) node.z = def.z;
    const parent = id === inst.id ? opts.parent : (linked(nodeParent) ?? enclosing(id, nodeIds));
    return runtimeEntity(registry, node, nodeType, transform, parent);
  });
  const groups: RuntimeEntity[][] = registry.spawnGroups.map(() => []);
  const has = (id: string) => ids.has(id);
  for (const child of rest) {
    if (child.def.off) continue;
    const def = scopeBehaviorRefs(registry, child.def, has);
    const t = registry.types.get(def.type);
    if (!t) throw new Error(`expandInstance: ${def.id} has unregistered type "${def.type}"`);
    const group = registry.spawnGroupOf(def.type);
    if (group === undefined) continue;
    const parent = linked(def.parent) ?? enclosing(def.id, nodeIds);
    groups[group]?.push(runtimeEntity(registry, def, t, child.transform, parent));
  }
  return { ok: true, entities: [...nodes, ...groups.flat()], nodes: nodes.length };
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
 * holds it: parent frames applied, each instance's nodes and children
 * through `expandInstance` (ids `<instance>/<child>`); bulk entries become `~key:index` entities, `off` entities and
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
  const library = opts.prefabs;
  const frames = sceneFrames(source, registry, library);
  // the document's own entities in the world; instances expand one by one below
  const { def, origins } = resolveWith(source, registry, frames, false);
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

  // a `parent` link to something that doesn't load (a note, a missing child) is dropped below
  const linked: RuntimeEntity[] = [];
  (def.entities ?? []).forEach((e, i) => {
    if (e.off) return;
    const t = registry.types.get(e.type);
    if (!t) throw new Error(`expandScene: ${e.id} has unregistered type "${e.type}"`);
    const group = registry.spawnGroupOf(e.type);
    if (group === undefined) return;
    const transform = origins[i]?.transform ?? IDENTITY;
    const parent = frames.parentOf(e.id);
    const out = runtimeEntity(registry, e, t, transform, parent);
    if (parent !== undefined) linked.push(out);
    groups[group]?.push(out);
  });

  const cells = gridTurns(source);
  for (const inst of source.instances ?? []) {
    if (!library) break;
    if (frames.hidden(inst.id)) continue;
    const parent = frames.parentOf(inst.id);
    const steps = frames.stepsFor(inst);
    const out = expandInstance(inst, library, registry, { steps, cells, parent });
    if (!out.ok) continue;
    for (const e of out.entities) {
      const at = registry.spawnGroupOf(e.type);
      if (at !== undefined) groups[at]?.push(e);
      if (parent !== undefined && e.id === inst.id) linked.push(e);
    }
  }

  const entities = groups.flat();
  if (linked.length > 0) {
    const ids = new Set(entities.map((e) => e.id));
    for (const e of linked) if (e.parent !== undefined && !ids.has(e.parent)) delete e.parent;
  }

  return {
    name: def.name,
    ...(def.game !== undefined ? { game: def.game } : {}),
    bounds: [def.bounds[0], def.bounds[1], def.bounds[2], def.bounds[3]],
    settings: resolveSettings(def.settings, settingsSources(registry, opts.engine)),
    entities,
  };
}
