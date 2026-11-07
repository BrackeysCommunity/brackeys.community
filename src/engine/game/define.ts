import type { z } from "zod";

import { ISSUE_CODES } from "../scene/issues";
import {
  RESERVED_SCENE_KEYS,
  SCENE_FORMAT_VERSION,
  type EntityTypeName,
  type IssueCodeInfo,
  type RuntimeEntity,
} from "../scene/types";
import { ID_PATTERN, isAttachField, RESERVED_FIELDS } from "./fields";
import { BASE_REQUIRED_FIELDS, ENGINE_SETTINGS, PRIMITIVES, resolveFields } from "./primitives";
import {
  ENGINE_CHECK_KINDS,
  ENGINE_COLLISION_GROUPS,
  ENGINE_PREDICATES,
  ENGINE_REGISTRY_ID,
  ENGINE_RUN_RESULTS,
  PRIMITIVE_TYPES,
  type BasePrimitive,
  type BulkKeyInfo,
  type EntityTypeDef,
  type FieldEnv,
  type GameDefinition,
  type MaterialDef,
  type RegisteredType,
  type Registry,
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

/**
 * Merges the engine's primitives with a game's types, materials, actions,
 * collision groups and issue codes. Throws `RegistryError` listing every
 * problem: duplicate or reserved names, bulk keys or codes, a type without a
 * system, a spawn order that misses or repeats a type, unknown groups.
 */
export function createRegistry(game?: GameDefinition | null): Registry {
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
  const materialNames = [...materials.keys()];

  // types
  const defs: { def: EntityTypeDef; origin: string }[] = [
    ...PRIMITIVE_TYPES.map((t) => ({ def: PRIMITIVES[t], origin: ENGINE_REGISTRY_ID })),
    ...(game?.types ?? []).map((def) => ({ def, origin: id })),
  ];
  const typeNames = defs.map((d) => d.def.type);
  const env: FieldEnv = { materials: materialNames, materialDefs: materials, types: typeNames };
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
        problem(`type "${name}" redefines the base field "${key}"`);
    }
    const loads = def.loads !== false;
    if (origin !== ENGINE_REGISTRY_ID && loads && !def.system && !def.base) {
      problem(`type "${name}" loads but has neither a system nor a base primitive`);
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
  if (game?.settings && "gravity" in game.settings)
    problem(`settings field "gravity" is the engine's`);

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

  if (problems.length > 0) throw new RegistryError(id, problems);

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
    checkKinds,
    physicalChecks,
    widgets,
    schemaId:
      id === ENGINE_REGISTRY_ID
        ? `urn:jams-engine:scene:v${SCENE_FORMAT_VERSION}`
        : `urn:jams-engine:scene:${id}:v${SCENE_FORMAT_VERSION}`,
    get primitives() {
      return primitives;
    },
  };
  const primitives = game ? createRegistry() : registry;
  return registry;
}
