import { z } from "zod";

import type { BlendMode } from "../context";
import { MATERIAL_KIND, projectMaterialOf } from "../project/kinds/material";
import type { AssetId, AssetKindName, ProjectView } from "../project/types";
import { FIELD_NAME_PATTERN } from "../scene/field-path";
import { ISSUE_CODES } from "../scene/issues";
import { DEFAULT_LAYERS, type SceneLayerDef } from "../scene/layers";
import { fieldKind } from "../scene/schema";
import {
  RESERVED_SCENE_KEYS,
  SCENE_FORMAT_VERSION,
  type EntityTypeName,
  type IssueCodeInfo,
  type RuntimeEntity,
} from "../scene/types";
import type { Vec2 } from "../types";
import {
  BEHAVIOR_NAME_PATTERN,
  type BehaviorBlock,
  type BehaviorDef,
  type BehaviorName,
  type RegisteredBehavior,
} from "./behaviors";
import { LIFETIME } from "./behaviors/lifetime";
import { OCCUPANT } from "./behaviors/occupant";
import { SPRITE } from "./behaviors/sprite";
import { COMMAND_NAME_PATTERN, ENGINE_COMMANDS } from "./commands";
import { DEFAULT_TIME } from "./defaults";
import { ID_PATTERN, isAttachField, RESERVED_FIELDS } from "./fields";
import {
  BASE_REQUIRED_FIELDS,
  ENGINE_SETTING_KEYS,
  ENGINE_SETTINGS,
  PRIMITIVES,
  resolveFields,
} from "./primitives";
import { tickRateProblem, type TimeKind, type TimeModel } from "./time";
import {
  ENGINE_CHECK_KINDS,
  ENGINE_COLLISION_GROUPS,
  ENGINE_PREDICATES,
  ENGINE_REGISTRY_ID,
  ENGINE_RUN_RESULTS,
  PRIMITIVE_TYPES,
  type BasePrimitive,
  type BehaviorRules,
  type BulkKeyInfo,
  type CommandDef,
  type EntityTypeDef,
  type FieldEnv,
  type GameDefinition,
  type GameWorldDef,
  type MaterialDef,
  type RegisteredType,
  type Registry,
  type Style,
} from "./types";

/** The runtime entity a type's fields describe. */
export type EntityOf<D extends EntityTypeDef> =
  D extends EntityTypeDef<infer F> ? RuntimeEntity<z.infer<z.ZodObject<F>>> : RuntimeEntity;

/** Declares an entity type; the identity, typed so `EntityOf` can read its fields. */
export function defineEntityType<F extends z.ZodRawShape>(def: EntityTypeDef<F>): EntityTypeDef<F> {
  return def;
}

/** Declares a game; checked when a registry is built from it. */
export function defineGame<S, G = unknown>(def: GameDefinition<S, G>): GameDefinition<S, G> {
  return def;
}

export class RegistryError extends Error {
  readonly problems: string[];
  constructor(id: string, problems: string[]) {
    super(`registry "${id}" is invalid:\n- ${problems.join("\n- ")}`);
    this.name = "RegistryError";
    this.problems = problems;
  }
}

/** Primitives with no body: a game's `spawnOrder` may leave them out, and they then spawn last. */
const BODILESS_PRIMITIVES: readonly EntityTypeName[] = ["decor", "nav"];

const isPrimitive = (name: string): boolean =>
  (PRIMITIVE_TYPES as readonly string[]).includes(name);

/** Engine groups' default interactions: static and dynamic bodies collide, dynamic with each other. */
const ENGINE_INTERACTIONS: readonly [string, string][] = [
  ["static", "dynamic"],
  ["dynamic", "dynamic"],
];

function packGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** A project's material asset as the registry takes it; without `physics` it is render data only. */
export type ProjectMaterialDef = {
  description: string;
  physics?: { friction: number; restitution: number; impulse?: Vec2 };
  style?: Style;
  tint?: number;
  blend?: BlendMode;
};

export type CreateRegistryOptions = {
  /**
   * The project's materials by asset id. Each wins over the game's code
   * material of that name. One with `physics` joins `materials` (and so
   * the material fields' choices); one without is left out of them, so a
   * physics body naming it is refused like any unknown material, and its
   * `style`, `tint` and `blend` reach no entity: a sprite falls back to a
   * material's tint and blend only through `materials`. The
   * `primitives` registry beside a game's has them too, so a scene with
   * no game run under one sees its project's materials.
   */
  materials?: Readonly<Record<string, ProjectMaterialDef>>;
  /**
   * The project's live asset ids of the asked kinds, sorted: what asset
   * fields offer as JSON Schema choices. Omitted means no project, so
   * every kind is empty. The `primitives` registry shares it.
   */
  assets?: FieldEnv["assets"];
};

/** What a type's field may be named: a JS identifier, so `@`-prefixed collab layout keys never collide. */

const noAssets: FieldEnv["assets"] = () => [];

/** The engine's own behaviors, registered before a game's. */
export const ENGINE_BEHAVIORS: readonly BehaviorDef[] = Object.freeze([SPRITE, OCCUPANT, LIFETIME]);

/** A behavior's own field defaults: each field whose schema parses `undefined` to a value. */
function shapeDefaults(shape: z.ZodRawShape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(shape)) {
    const parsed = z.safeParse(schema, undefined);
    if (parsed.success && parsed.data !== undefined) out[field] = parsed.data;
  }
  return out;
}

const noBehaviors: BehaviorRules = Object.freeze({
  allowed: [],
  required: new Map<BehaviorName, BehaviorBlock>(),
  defaults: new Map<BehaviorName, BehaviorBlock>(),
});

/**
 * A type's behavior rules. `required` holds each required behavior's block:
 * the behavior's defaults under the type's `defaults` under its `required`
 * values. `defaults` holds what an allowed behavior an entity carries
 * starts from, the same merge (so a required one's equals its `required`
 * block). Types that never load carry none.
 */
function typeBehaviorRules(
  t: RegisteredType,
  behaviors: ReadonlyMap<BehaviorName, RegisteredBehavior>,
  own: ReadonlyMap<BehaviorName, BehaviorBlock>,
): BehaviorRules {
  if (t.loads === false) return noBehaviors;
  const rules = t.behaviors ?? {};
  const required = rules.required ?? {};
  const forbidden = rules.forbidden ?? [];
  const allowed = [...behaviors.keys()].filter((name) =>
    forbidden === "all" ? name in required : !forbidden.includes(name),
  );
  const defaults = new Map<BehaviorName, BehaviorBlock>();
  for (const name of allowed) {
    defaults.set(
      name,
      Object.freeze({ ...own.get(name), ...rules.defaults?.[name], ...required[name] }),
    );
  }
  const requiredBlocks = new Map<BehaviorName, BehaviorBlock>();
  for (const name of allowed) if (name in required) requiredBlocks.set(name, defaults.get(name)!);
  return Object.freeze({ allowed, required: requiredBlocks, defaults });
}

/** Refuses a type's behavior rules that name unknown behaviors, overlap or fail a schema. */
function checkTypeBehaviors(
  t: RegisteredType,
  behaviors: ReadonlyMap<BehaviorName, RegisteredBehavior>,
  problem: (msg: string) => void,
): void {
  const rules = t.behaviors;
  if (!rules) return;
  const name = t.type;
  if (t.loads === false) {
    problem(`type "${name}" never loads and can't carry behaviors`);
    return;
  }
  const required = Object.keys(rules.required ?? {});
  const forbidden = rules.forbidden === "all" ? [] : (rules.forbidden ?? []);
  for (const b of forbidden)
    if (!behaviors.has(b)) problem(`type "${name}" forbids unknown behavior "${b}"`);
  for (const b of required) {
    if (forbidden.includes(b)) problem(`type "${name}" both requires and forbids "${b}"`);
    for (const dep of behaviors.get(b)?.requires ?? []) {
      const refused = rules.forbidden === "all" ? !required.includes(dep) : forbidden.includes(dep);
      if (refused)
        problem(`type "${name}" requires "${b}", which requires "${dep}", but forbids "${dep}"`);
    }
  }
  for (const [rule, blocks] of [
    ["required", rules.required],
    ["defaults", rules.defaults],
  ] as const) {
    for (const [b, block] of Object.entries(blocks ?? {})) {
      const behavior = behaviors.get(b);
      if (!behavior) {
        problem(`type "${name}" ${rule} names unknown behavior "${b}"`);
        continue;
      }
      if (
        rule === "defaults" &&
        (rules.forbidden === "all" ? !required.includes(b) : forbidden.includes(b))
      )
        problem(`type "${name}" gives defaults for "${b}", which it forbids`);
      for (const [field, value] of Object.entries(block)) {
        const schema = behavior.shape[field];
        if (!schema) problem(`type "${name}" ${rule} "${b}" names unknown field "${field}"`);
        else if (!z.safeParse(schema, value).success)
          problem(`type "${name}" ${rule} "${b}" field "${field}" fails the behavior's schema`);
      }
    }
  }
}

function checkLayers(layers: readonly SceneLayerDef[], problem: (msg: string) => void): void {
  if (layers.length === 0) problem("layers must list at least one layer");
  const seen = new Set<string>();
  for (const layer of layers) {
    if (!ID_PATTERN.test(layer.name)) problem(`layer "${layer.name}" must match ${ID_PATTERN}`);
    if (seen.has(layer.name)) problem(`layer "${layer.name}" is declared twice`);
    seen.add(layer.name);
    if (!Number.isFinite(layer.draw)) problem(`layer "${layer.name}" draw must be a finite number`);
    if (layer.scroll && !layer.scroll.every((n) => Number.isFinite(n)))
      problem(`layer "${layer.name}" scroll must be two finite numbers`);
  }
}

/** Refuses world defaults the runtime can't use: each must be what the scene setting of that name accepts. */
function checkWorld(
  world: GameWorldDef,
  types: ReadonlyMap<EntityTypeName, RegisteredType>,
  problem: (msg: string) => void,
): void {
  if (world.physics !== undefined && world.physics !== "rapier" && world.physics !== "none")
    problem(`world.physics must be "rapier" or "none", got ${JSON.stringify(world.physics)}`);
  const g = world.gravity as unknown;
  if (
    g !== undefined &&
    !(
      Array.isArray(g) &&
      g.length === 2 &&
      g.every((n) => typeof n === "number" && Number.isFinite(n))
    )
  )
    problem("world.gravity must be two finite numbers [x, y]");
  if (world.grid !== undefined && !z.safeParse(ENGINE_SETTINGS.grid, world.grid).success)
    problem("world.grid must be a square or hex grid, as settings.grid takes it");
  for (const name of world.gridWalls ?? []) {
    const t = types.get(name);
    if (!t) problem(`world.gridWalls names unknown type "${name}"`);
    else if (t.loads === false) problem(`world.gridWalls names "${name}", which never loads`);
  }
  const unit = world.lengthUnit;
  if (unit !== undefined && !(typeof unit === "number" && Number.isFinite(unit) && unit > 0))
    problem(`world.lengthUnit must be a finite number above 0, got ${String(unit)}`);
}

const TIME_KINDS: readonly string[] = ["fixed", "turns", "event"] satisfies TimeKind[];

/** Refuses a time model the clock can't run besides its rate: an unknown kind, or a `catchUp.maxMs` `@elapsed`'s args would refuse. */
function checkTime(time: TimeModel, problem: (msg: string) => void): void {
  const kind: unknown = time.kind;
  if (!TIME_KINDS.includes(kind as string))
    problem(`time.kind must be one of ${TIME_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  if (time.catchUp !== undefined) {
    const maxMs: unknown = (time.catchUp as { maxMs?: unknown } | null)?.maxMs;
    if (!(typeof maxMs === "number" && Number.isInteger(maxMs) && maxMs >= 0))
      problem(
        `time.catchUp.maxMs must be a whole number of milliseconds, 0 or more, got ${typeof maxMs === "number" ? String(maxMs) : JSON.stringify(maxMs)}`,
      );
  }
  const wake: unknown = time.wakeOnPointerMove;
  if (wake !== undefined && typeof wake !== "boolean")
    problem(`time.wakeOnPointerMove must be true or false, got ${JSON.stringify(wake)}`);
}

/**
 * Whether `type` is registered spawn-only: it loads and `ctx.spawn` makes
 * it, but no scene, prefab or op may place it.
 */
export function isSpawnOnly(registry: Registry, type: EntityTypeName): boolean {
  return registry.types.get(type)?.spawnOnly === true;
}

/** The types a scene, prefab or op may place, in registration order: every type but the spawn-only ones. */
export function placeableTypes(registry: Registry): EntityTypeName[] {
  return registry.typeNames.filter((t) => !isSpawnOnly(registry, t));
}

/**
 * Merges the engine's primitives with a game's types, materials, actions,
 * collision groups and issue codes, and the project's materials over the
 * game's, and the engine's behaviors then the game's. Throws
 * `RegistryError` listing every problem: duplicate or reserved names, bulk
 * keys or codes, a type without a system, a spawn-only type that never
 * loads or has a bulk form, a spawn order that misses or
 * repeats a type, unknown groups, a game behavior outside the game's
 * namespace, behavior rules naming unknown behaviors or failing their
 * schemas, a grid field without a point `at`, a `time.rate` the clock can't run
 * (`tick-rate-invalid`), an unknown `time.kind` or a `time.catchUp.maxMs` that
 * isn't a whole number ≥ 0, world defaults the scene settings would refuse, and
 * `world.gridWalls` naming a type that is unknown or never loads.
 */
export function createRegistry(
  game?: GameDefinition | null,
  opts: CreateRegistryOptions = {},
): Registry {
  const id = game?.id ?? ENGINE_REGISTRY_ID;
  const problems: string[] = [];
  const problem = (msg: string) => problems.push(msg);

  if (game) {
    if (!ID_PATTERN.test(game.id)) problem(`game id "${game.id}" must match ${ID_PATTERN}`);
    if (game.id === ENGINE_REGISTRY_ID) problem(`game id "${ENGINE_REGISTRY_ID}" is reserved`);
  }

  // materials
  const materials = new Map<string, MaterialDef>();
  for (const [name, def] of Object.entries(game?.materials ?? {})) {
    if (!ID_PATTERN.test(name)) problem(`material "${name}" must match ${ID_PATTERN}`);
    materials.set(name, def);
  }
  for (const [name, def] of Object.entries(opts.materials ?? {})) {
    if (!ID_PATTERN.test(name)) problem(`material "${name}" must match ${ID_PATTERN}`);
    if (!def.physics) {
      materials.delete(name);
      continue;
    }
    const { friction, restitution, impulse } = def.physics;
    materials.set(name, {
      friction,
      restitution,
      ...(impulse ? { impulse: { ...impulse } } : {}),
      description: def.description,
      ...(def.style ? { style: { ...def.style } } : {}),
      ...(def.tint !== undefined ? { tint: def.tint } : {}),
      ...(def.blend !== undefined ? { blend: def.blend } : {}),
    });
  }
  const materialNames = [...materials.keys()];

  // types
  const defs: { def: EntityTypeDef; origin: string }[] = [
    ...PRIMITIVE_TYPES.map((t) => ({ def: PRIMITIVES[t], origin: ENGINE_REGISTRY_ID })),
    ...(game?.types ?? []).map((def) => ({ def, origin: id })),
  ];
  const typeNames = defs.map((d) => d.def.type);
  const env: FieldEnv = {
    materials: materialNames,
    materialDefs: materials,
    types: typeNames,
    assets: opts.assets ?? noAssets,
  };
  // behaviors, the engine's first, then the game's in order
  const behaviors = new Map<BehaviorName, RegisteredBehavior>();
  const behaviorDefaults = new Map<BehaviorName, BehaviorBlock>();
  const behaviorDefs: { def: BehaviorDef; origin: string }[] = [
    ...ENGINE_BEHAVIORS.map((def) => ({ def, origin: ENGINE_REGISTRY_ID })),
    ...(game?.behaviors ?? []).map((def) => ({ def, origin: id })),
  ];
  for (const { def, origin } of behaviorDefs) {
    const name = def.name;
    if (!BEHAVIOR_NAME_PATTERN.test(name))
      problem(`behavior "${name}" must match ${BEHAVIOR_NAME_PATTERN}`);
    if (origin === ENGINE_REGISTRY_ID) {
      if (name.includes("/")) problem(`engine behavior "${name}" can't have a "/" prefix`);
    } else if (!name.startsWith(`${id}/`)) problem(`behavior "${name}" must be "${id}/<name>"`);
    if (behaviors.has(name)) {
      problem(`behavior "${name}" is registered twice`);
      continue;
    }
    const shape = typeof def.fields === "function" ? def.fields(env) : def.fields;
    for (const key of Object.keys(shape)) {
      if (!FIELD_NAME_PATTERN.test(key))
        problem(`behavior "${name}" field "${key}" must match ${FIELD_NAME_PATTERN}`);
    }
    behaviors.set(name, { ...def, origin, shape, index: behaviors.size });
    behaviorDefaults.set(name, Object.freeze(shapeDefaults(shape)));
  }
  for (const b of behaviors.values()) {
    for (const dep of b.requires ?? []) {
      if (!behaviors.has(dep)) problem(`behavior "${b.name}" requires unknown behavior "${dep}"`);
    }
  }
  const behaviorNames = [...behaviors.keys()];

  const types = new Map<EntityTypeName, RegisteredType>();

  for (const { def, origin } of defs) {
    const name = def.type;
    if (types.has(name)) {
      problem(
        isPrimitive(name)
          ? `type "${name}" is an engine primitive and can't be redefined`
          : `type "${name}" is registered twice`,
      );
      continue;
    }
    if (!ID_PATTERN.test(name)) problem(`type "${name}" must match ${ID_PATTERN}`);
    if (def.ascii !== undefined && !/^[!-~]$/.test(def.ascii)) {
      problem(`type "${name}" ascii must be one printable ASCII character, not a space`);
    }
    const shape = resolveFields(def, env);
    for (const key of Object.keys(shape)) {
      if (RESERVED_FIELDS.includes(key))
        problem(`type "${name}" redefines the reserved field "${key}"`);
      if (!FIELD_NAME_PATTERN.test(key))
        problem(`type "${name}" field "${key}" must match ${FIELD_NAME_PATTERN}`);
    }
    const path = shape.path;
    if (path && !z.safeParse(path, undefined).success && z.safeParse(path, {}).success)
      problem(
        `type "${name}" field "path" accepts {} but is required; an empty path is written as none, so make it optional or reject {}`,
      );
    if (Object.values(shape).some((schema) => fieldKind(schema) === "grid")) {
      const at = shape.at;
      if (!at || fieldKind(at) !== "point")
        problem(`type "${name}" has a grid field but no point field "at"`);
    }
    const loads = def.loads !== false;
    if (origin !== ENGINE_REGISTRY_ID && loads && !def.system && !def.base) {
      problem(`type "${name}" loads but has neither a system nor a base primitive`);
    }
    if (def.spawnOnly) {
      if (!loads) problem(`type "${name}" is spawn-only but never loads`);
      if (def.bulk) problem(`type "${name}" is spawn-only and can't have a bulk form`);
    }
    if (def.base) {
      if (!isPrimitive(def.base) || def.base === ("note" as BasePrimitive)) {
        problem(`type "${name}" names an unknown base "${def.base}"`);
      } else {
        for (const field of BASE_REQUIRED_FIELDS[def.base]) {
          if (!(field in shape))
            problem(`type "${name}" is based on ${def.base} but has no "${field}" field`);
        }
      }
    }
    if (def.bulk) {
      const field = def.bulk.form === "shape" ? "shape" : "at";
      if (!(field in shape))
        problem(`type "${name}" has a ${def.bulk.form} bulk form but no "${field}" field`);
      if (def.bulk.materials && !("material" in shape)) {
        problem(`type "${name}" has material bulk keys but no "material" field`);
      }
      if (RESERVED_SCENE_KEYS.includes(name)) problem(`bulk key "${name}" is a reserved scene key`);
    }
    const attach = Object.entries(shape)
      .filter(
        ([field, schema]) => isAttachField(schema) && !def.refs?.some((r) => r.field === field),
      )
      .map(([field]) => ({ field, targets: ["follower"] as const }));
    types.set(name, {
      ...def,
      origin,
      shape,
      ...(attach.length > 0 ? { refs: [...(def.refs ?? []), ...attach] } : {}),
    });
  }

  for (const t of types.values()) {
    checkTypeBehaviors(t, behaviors, problem);
    for (const ref of t.refs ?? []) {
      if (!(ref.field in t.shape))
        problem(`type "${t.type}" declares a ref on unknown field "${ref.field}"`);
      for (const target of ref.targets) {
        if (!types.has(target))
          problem(`type "${t.type}" ref "${ref.field}" targets unknown type "${target}"`);
      }
    }
  }

  // spawn order
  const loadable = [...types.values()].filter((t) => t.loads !== false).map((t) => t.type);
  let spawnGroups: EntityTypeName[][];
  if (game?.spawnOrder) {
    spawnGroups = game.spawnOrder.map((g) => (typeof g === "string" ? [g] : [...g]));
    const listed = spawnGroups.flat();
    const seen = new Set<string>();
    for (const t of listed) {
      if (!types.has(t)) problem(`spawnOrder names unknown type "${t}"`);
      else if (types.get(t)!.loads === false) problem(`spawnOrder names "${t}", which never loads`);
      if (seen.has(t)) problem(`spawnOrder lists "${t}" twice`);
      seen.add(t);
    }
    for (const t of BODILESS_PRIMITIVES) {
      if (!seen.has(t)) {
        spawnGroups.push([t]);
        seen.add(t);
      }
    }
    for (const t of loadable) if (!seen.has(t)) problem(`spawnOrder misses type "${t}"`);
  } else {
    spawnGroups = loadable.map((t) => [t]);
  }

  // bulk keys, in spawn order
  const bulkKeys: BulkKeyInfo[] = [];
  const bulkOrder = [...spawnGroups.flat(), ...typeNames.filter((t) => !loadable.includes(t))];
  for (const name of bulkOrder) {
    const t = types.get(name);
    if (!t?.bulk) continue;
    const field = t.bulk.form === "shape" ? "shape" : "at";
    bulkKeys.push({ key: name, type: name, form: t.bulk.form, field });
    if (t.bulk.materials) {
      for (const material of materialNames) {
        bulkKeys.push({
          key: `${name}:${material}`,
          type: name,
          form: t.bulk.form,
          field,
          material,
        });
      }
    }
  }
  const bulkByKey = new Map(bulkKeys.map((b) => [b.key, b]));

  // actions
  const actionNames = (game?.actions ?? []).map((a) => a.action);
  const seenActions = new Set<string>();
  for (const a of actionNames) {
    if (seenActions.has(a)) problem(`action "${a}" is declared twice`);
    seenActions.add(a);
  }

  // collision groups
  const groupNames: string[] = [...ENGINE_COLLISION_GROUPS];
  for (const name of Object.keys(game?.collisionGroups ?? {})) {
    if (!(ENGINE_COLLISION_GROUPS as readonly string[]).includes(name)) groupNames.push(name);
  }
  if (groupNames.length > 16) problem(`at most 16 collision groups; got ${groupNames.length}`);
  const bit = (name: string) => 1 << groupNames.indexOf(name);
  const filters = new Map<string, number>(groupNames.map((n) => [n, 0]));
  const link = (a: string, b: string) => {
    filters.set(a, filters.get(a)! | bit(b));
    filters.set(b, filters.get(b)! | bit(a));
  };
  for (const [a, b] of ENGINE_INTERACTIONS) link(a, b);
  for (const [name, def] of Object.entries(game?.collisionGroups ?? {})) {
    for (const other of def.collidesWith) {
      if (!groupNames.includes(other))
        problem(`collision group "${name}" names unknown group "${other}"`);
      else link(name, other);
    }
  }
  const packed = new Map(groupNames.map((n) => [n, packGroups(bit(n), filters.get(n)!)]));

  // issue codes
  const issueCodes: Record<string, IssueCodeInfo> = { ...ISSUE_CODES };
  for (const [code, info] of Object.entries(game?.issues ?? {})) {
    if (!code.startsWith(`${id}/`) || code.length === id.length + 1) {
      problem(`issue code "${code}" must be "${id}/<code>"`);
    } else if (code in issueCodes) {
      problem(`issue code "${code}" is declared twice`);
    }
    issueCodes[code] = info;
  }

  // settings
  for (const key of ENGINE_SETTING_KEYS) {
    if (game?.settings && key in game.settings) problem(`settings field "${key}" is the engine's`);
  }

  // time and world
  const rate = game?.time?.rate;
  const rateProblem = rate === undefined ? null : tickRateProblem(rate);
  if (rateProblem) problem(`time.rate: ${rateProblem} (tick-rate-invalid)`);
  if (game?.time) checkTime(game.time, problem);
  const world = game?.world;
  if (world) checkWorld(world, types, problem);

  // layers
  const layers = game?.layers ?? DEFAULT_LAYERS;
  if (game?.layers) checkLayers(game.layers, problem);

  // play hooks
  const play = game?.play;
  const runResults: string[] = [...ENGINE_RUN_RESULTS];
  for (const result of play?.results ?? []) {
    if (runResults.includes(result)) {
      problem(
        (ENGINE_RUN_RESULTS as readonly string[]).includes(result)
          ? `run result "${result}" is the engine's`
          : `run result "${result}" is declared twice`,
      );
    } else runResults.push(result);
  }
  const predicateNames: string[] = [...ENGINE_PREDICATES];
  for (const name of Object.keys(play?.predicates ?? {})) {
    if (predicateNames.includes(name)) problem(`script predicate "${name}" is the engine's`);
    else predicateNames.push(name);
  }
  for (const action of play?.movementActions ?? []) {
    if (!seenActions.has(action)) problem(`movement action "${action}" is not a declared action`);
  }
  const seenKeys = new Set<string>();
  for (const binding of game?.editorKeys ?? []) {
    const slot = `${binding.scope} ${binding.key}`;
    if (seenKeys.has(slot))
      problem(`editor key "${binding.key}" is bound twice in ${binding.scope}`);
    seenKeys.add(slot);
  }

  // editor
  const widgets = new Map(Object.entries(game?.editor?.widgets ?? {}));

  // checks
  const checkKinds: string[] = [...ENGINE_CHECK_KINDS];
  for (const kind of Object.keys(game?.checks ?? {})) {
    if (!kind.startsWith(`${id}/`) || kind.length === id.length + 1)
      problem(`check kind "${kind}" must be "${id}/<kind>"`);
    else checkKinds.push(kind);
  }
  const physicalChecks = game?.physicalChecks ?? [];
  const seenChecks = new Set<string>();
  for (const check of physicalChecks) {
    if (seenChecks.has(check.id)) problem(`physical check "${check.id}" is declared twice`);
    seenChecks.add(check.id);
  }

  for (const name of Object.keys(game?.commands ?? {})) {
    if (name.startsWith("@"))
      problem(`command "${name}" can't start with "@"; those are the engine's`);
    else if (!COMMAND_NAME_PATTERN.test(name))
      problem(`command "${name}" must match ${COMMAND_NAME_PATTERN}`);
  }

  if (problems.length > 0) throw new RegistryError(id, problems);

  const commands = new Map<string, CommandDef>([
    ...Object.entries(ENGINE_COMMANDS),
    ...Object.entries(game?.commands ?? {}),
  ]);

  const rulesByType = new Map<EntityTypeName, BehaviorRules>();
  for (const t of types.values())
    rulesByType.set(t.type, typeBehaviorRules(t, behaviors, behaviorDefaults));

  const groupOf = new Map<EntityTypeName, number>();
  spawnGroups.forEach((group, i) => group.forEach((type) => groupOf.set(type, i)));

  const registry: Registry = {
    id,
    game: game ?? null,
    types,
    typeNames,
    spawnGroups,
    spawnGroupOf: (type) => groupOf.get(type),
    bulkKeys,
    bulkKey: (key) => bulkByKey.get(key),
    materials,
    materialNames,
    actions: game?.actions ?? [],
    actionNames,
    collisionGroups(name) {
      const value = packed.get(name);
      if (value === undefined) throw new Error(`unknown collision group "${name}"`);
      return value;
    },
    collisionGroupNames: groupNames,
    issueCodes,
    validators: game?.validators ?? [],
    settings: { ...ENGINE_SETTINGS, ...game?.settings },
    prefabContract: { ...game?.prefabContract },
    runResults,
    predicateNames,
    commands,
    commandNames: [...commands.keys()],
    time: game?.time ?? DEFAULT_TIME,
    checkKinds,
    physicalChecks,
    widgets,
    behaviors,
    behaviorNames,
    behaviorRules: (type) => rulesByType.get(type) ?? noBehaviors,
    layers,
    schemaId:
      id === ENGINE_REGISTRY_ID
        ? `urn:jams-engine:scene:v${SCENE_FORMAT_VERSION}`
        : `urn:jams-engine:scene:${id}:v${SCENE_FORMAT_VERSION}`,
    get primitives() {
      return primitives;
    },
  };
  const primitives = game
    ? createRegistry(null, { materials: opts.materials, assets: opts.assets })
    : registry;
  return registry;
}

/**
 * `registry`'s game with `view`'s live material assets overlaid by id
 * (`values` holds each asset's JSON; a material whose JSON isn't valid
 * is left out) and its live asset ids as the asset fields' choices.
 * Schema hashes for skew checks use the project-free registry instead.
 */
export function withProject(
  registry: Registry,
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
): Registry {
  const materials: Record<string, ProjectMaterialDef> = {};
  const ids = [...view.byId.values()]
    .filter((e) => e.kind === MATERIAL_KIND)
    .map((e) => e.id)
    .sort();
  for (const id of ids) {
    const def = projectMaterialOf(values.get(id));
    if (def) materials[id] = def;
  }
  const live = [...view.byId.values()];
  const assets = (kinds: readonly AssetKindName[]): readonly AssetId[] =>
    live
      .filter((e) => kinds.includes(e.kind))
      .map((e) => e.id)
      .sort();
  return createRegistry(registry.game, { materials, assets });
}
