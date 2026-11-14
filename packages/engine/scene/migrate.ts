import type { z } from "zod";

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { BASE_FIELDS } from "../game/fields";
import { ENGINE_SETTING_KEYS, NODE_TYPE } from "../game/primitives";
import type { Registry } from "../game/types";
import { pxPerMetreOf, scaleLengths, scaleLengthsAt } from "../game/units";
import { parseBulkId } from "./bulk-ref";
import { splitFieldPath, splitOverridePath } from "./field-path";
import { jsonPointer, makeIssue } from "./issues";
import { CHILD_SEPARATOR, parseChildRef, sceneFrames } from "./resolve";
import { unknownGameIssue } from "./schema";
import { isShapeSchema, mapShapeLengths } from "./shapes";
import { compose, composeSteps, invert } from "./transform";
import { transformEntityDef } from "./translate";
import {
  PREFAB_KIND,
  PREFAB_MAX_DEPTH,
  RESERVED_SCENE_KEYS,
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "./types";
import { pxToMetres } from "./units";

/** What a migration step may need beyond the document: the game, and the prefabs its instances name. */
export type MigrateEnv = {
  registry?: Registry;
  /** The prefab an instance names, for the units of its overrides and exposed params. */
  prefab?: (id: string) => Prefab | undefined;
};

/** A step that can't run without what `env` lacks returns this; `migrate` reports its issue. */
export type MigrationRefusal = { readonly refused: SceneIssue };

/**
 * `MIGRATIONS[n]` lifts an untyped v`n` document to v`n + 1`, or refuses.
 * Each step ships with a frozen fixture test; only the current version
 * exists as Zod.
 */
export type Migration = (raw: unknown, env: MigrateEnv) => unknown;

/** Whether a step's result is a refusal rather than the lifted document. */
export function isMigrationRefusal(value: unknown): value is MigrationRefusal {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "refused" in value
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * v1 → v2: groups become declared, with a local origin. v1 groups were
 * folders with world coordinates, so each group a v1 entity names is
 * declared at `[0, 0]` and nothing moves.
 */
function v1ToV2(raw: unknown): unknown {
  const doc = raw as Record<string, unknown>;
  const names = new Set<string>();
  if (Array.isArray(doc.entities))
    for (const e of doc.entities)
      if (isRecord(e) && typeof e.group === "string") names.add(e.group);
  const out: Record<string, unknown> = { ...doc, v: 2 };
  if (names.size > 0) {
    const groups: Record<string, unknown> = {};
    for (const name of [...names].sort()) groups[name] = { at: [0, 0] };
    out.groups = groups;
  }
  return out;
}

/**
 * v2 → v3: only `v` changes. Every v3 addition is optional and defaults to
 * v2's behaviour, so scenes, prefabs and fragments carry over as they are.
 */
function v2ToV3(raw: unknown): unknown {
  return { ...(raw as Record<string, unknown>), v: 3 };
}

// ─── v3 → v4: lengths in metres ──────────────────────────

/** Why a length's unit can't be read; the site that met it turns it into the refusal. */
class Unresolved extends Error {}

const unresolved = (path: string, message: string): MigrationRefusal => ({
  refused: makeIssue("migration-unresolved", { message, path }),
});

const hasNumber = (v: unknown): boolean =>
  typeof v === "number" ||
  (Array.isArray(v) && v.some(hasNumber)) ||
  (isRecord(v) && Object.values(v).some(hasNumber));

/** Raw prefab-like bodies the step reads children from: a prefab file, or the document being migrated. */
type Body = Record<string, unknown>;

const listOf = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter(isRecord) : [];

/**
 * The v3 → v4 step for one document, over the registry it is read with.
 * Throws `Unresolved` where a value's unit can't be read; `v3ToV4` reports
 * it at the site that holds the value.
 */
function metricStep(registry: Registry, env: MigrateEnv) {
  const ppm = pxPerMetreOf(registry);
  const len = (v: unknown) => (typeof v === "number" ? pxToMetres(v, ppm) : v);
  const pt = (v: unknown) => (Array.isArray(v) ? v.map(len) : v);
  const field = (schema: z.core.$ZodType, v: unknown) =>
    isShapeSchema(schema)
      ? mapShapeLengths(v, (n) => pxToMetres(n, ppm))
      : scaleLengths(v, schema, ppm);

  const prefab = (id: unknown): Body => {
    if (typeof id !== "string") throw new Unresolved("its prefab id isn't a string");
    const found = env.prefab?.(id);
    if (!found)
      throw new Unresolved(
        env.prefab
          ? `prefab "${id}" isn't in the project`
          : `the step wasn't given prefab "${id}" to read the field's unit from`,
      );
    return found as unknown as Body;
  };

  function behaviors(blocks: unknown): unknown {
    if (!isRecord(blocks)) return blocks;
    const out: Record<string, unknown> = {};
    for (const [name, block] of Object.entries(blocks)) {
      const b = registry.behaviors.get(name);
      out[name] = b && isRecord(block) ? fieldsOf(b.shape, block) : block;
    }
    return out;
  }

  function fieldsOf(shape: z.ZodRawShape, value: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const s = shape[k];
      out[k] = s ? field(s, v) : v;
    }
    return out;
  }

  function entity(e: unknown): unknown {
    if (!isRecord(e) || typeof e.type !== "string") return e;
    const t = registry.types.get(e.type);
    if (!t) return e;
    const out = fieldsOf(t.shape, e);
    if (e[BEHAVIORS_FIELD] !== undefined) out[BEHAVIORS_FIELD] = behaviors(e[BEHAVIORS_FIELD]);
    return out;
  }

  function bulk(rows: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, entries] of Object.entries(rows)) {
      const info = registry.bulkKey(key);
      const s = info && registry.types.get(info.type)?.shape[info.field];
      out[key] = s && Array.isArray(entries) ? entries.map((v) => field(s, v)) : entries;
    }
    return out;
  }

  function grid(g: unknown): unknown {
    if (!isRecord(g)) return g;
    const out = { ...g };
    for (const k of ["cell", "origin"]) if (out[k] !== undefined) out[k] = pt(out[k]);
    if (out.side !== undefined) out.side = len(out.side);
    return out;
  }

  function settings(s: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "gravity") out[k] = pt(v);
      else if (k === "grid") out[k] = grid(v);
      else if ((ENGINE_SETTING_KEYS as readonly string[]).includes(k)) out[k] = v;
      else {
        const schema = registry.settings[k];
        out[k] = schema ? field(schema, v) : v;
      }
    }
    return out;
  }

  /** A field of an entity or bulk child of type `type`, at field path `path`. */
  function childField(type: string, path: string, value: unknown, current: unknown): unknown {
    const t = registry.types.get(type);
    if (!t) throw new Unresolved(`the child's type "${type}" isn't registered`);
    const segs = splitFieldPath(path);
    if (!segs) throw new Unresolved(`"${path}" isn't a field path`);
    const [head, ...rest] = segs as [string, ...string[]];
    if (head === BEHAVIORS_FIELD) {
      if (rest.length === 0) return behaviors(value);
      const b = registry.behaviors.get(rest[0]!);
      if (!b) throw new Unresolved(`behavior "${rest[0]}" isn't registered`);
      if (rest.length === 1) return isRecord(value) ? fieldsOf(b.shape, value) : value;
      const s = b.shape[rest[1]!];
      const hit = s && scaleLengthsAt(value, s, rest.slice(2), ppm);
      if (!hit)
        throw new Unresolved(`behavior "${rest[0]}" has no field "${rest.slice(1).join(".")}"`);
      return hit.value;
    }
    const s = t.shape[head] ?? (BASE_FIELDS as Record<string, z.core.$ZodType>)[head];
    if (!s) throw new Unresolved(`type "${type}" has no field "${head}"`);
    if (isShapeSchema(s)) {
      if (rest.length === 0) return field(s, value);
      const tag = isRecord(current) && Array.isArray(current[head]) ? current[head][0] : undefined;
      const at = rest.length === 1 ? Number(rest[0]) : NaN;
      if (typeof tag !== "string" || !Number.isInteger(at) || at < 1)
        throw new Unresolved(`"${path}" points into a shape whose tag the step can't see`);
      return (tag === "box" || tag === "capsule") && at === 5 ? value : len(value);
    }
    const hit = scaleLengthsAt(value, s, rest, ppm);
    if (!hit) throw new Unresolved(`type "${type}" has no field "${path}"`);
    return hit.value;
  }

  /** An override of `child` (a ref relative to `body`) at field path `path`. */
  function override(
    body: Body,
    child: string,
    path: string,
    value: unknown,
    depth: number,
  ): unknown {
    if (depth > PREFAB_MAX_DEPTH * 2) throw new Unresolved("its prefabs nest too deep to follow");
    const segs = child.split("/");
    const head = segs[0]!;
    const nested = listOf(body.instances).find((i) => i.id === head);
    if (segs.length > 1) {
      if (nested)
        return override(prefab(nested.prefab), segs.slice(1).join("/"), path, value, depth + 1);
    } else {
      const ref = parseBulkId(head);
      if (ref) {
        const info = registry.bulkKey(ref.key);
        if (!info) throw new Unresolved(`bulk key "${ref.key}" isn't registered`);
        return childField(info.type, path, value, undefined);
      }
      const e = listOf(body.entities).find((x) => x.id === head);
      if (e && typeof e.type === "string") return childField(e.type, path, value, e);
      if (nested) return instanceField(nested, path, value, depth);
    }
    if (typeof body.base === "string")
      return override(prefab(body.base), child, path, value, depth + 1);
    throw new Unresolved(`it names no child "${child}"`);
  }

  /** A nested instance's own field, set by an override (`door-1.at`, `door-1.params.speed`). */
  function instanceField(inst: Body, path: string, value: unknown, depth: number): unknown {
    if (path === "at") return pt(value);
    const param = /^params\.(.+)$/.exec(path)?.[1];
    if (param !== undefined) return paramValue(prefab(inst.prefab), param, value, depth + 1);
    if (["rot", "flip", "z", "off", "layer"].includes(path)) return value;
    throw new Unresolved(`an instance has no field "${path}"`);
  }

  /** A value of `body`'s exposed param `name`, in the unit of the field its first target names. */
  function paramValue(body: Body, name: string, value: unknown, depth: number): unknown {
    for (let b: Body | undefined = body, d = depth; b; d++) {
      if (d > PREFAB_MAX_DEPTH * 2) break;
      const param = isRecord(b.params) ? b.params[name] : undefined;
      if (isRecord(param)) {
        const target = Array.isArray(param.targets) ? param.targets[0] : undefined;
        const split = typeof target === "string" ? splitOverridePath(target) : null;
        if (!split) throw new Unresolved(`param "${name}" has no target to read the unit from`);
        return override(b, split.child, split.field, value, d);
      }
      b = typeof b.base === "string" ? prefab(b.base) : undefined;
    }
    throw new Unresolved(`its prefab exposes no param "${name}"`);
  }

  /** Every override and param value of `overrides` and `params` against `body`, under `pointer`. */
  function overridesOf(
    body: () => Body,
    overrides: unknown,
    pointer: (string | number)[],
    who: string,
  ): unknown {
    if (!isRecord(overrides)) return overrides;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overrides)) {
      const split = splitOverridePath(key);
      out[key] =
        hasNumber(value) && split
          ? at([...pointer, key], `${who} override "${key}"`, () =>
              override(body(), split.child, split.field, value, 0),
            )
          : value;
    }
    return out;
  }

  function instance(inst: unknown, pointer: (string | number)[]): unknown {
    if (!isRecord(inst)) return inst;
    const out = { ...inst };
    if (inst.at !== undefined) out.at = pt(inst.at);
    const who = `instance "${String(inst.id)}"'s`;
    if (isRecord(inst.params)) {
      const params: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(inst.params))
        params[name] = hasNumber(value)
          ? at([...pointer, "params", name], `${who} param "${name}"`, () =>
              paramValue(prefab(inst.prefab), name, value, 0),
            )
          : value;
      out.params = params;
    }
    if (inst.overrides !== undefined)
      out.overrides = overridesOf(
        () => prefab(inst.prefab),
        inst.overrides,
        [...pointer, "overrides"],
        who,
      );
    return out;
  }

  /** A prefab file's own header: its variant overrides through its base, its params' defaults through itself. */
  function prefabHeader(doc: Body, out: Record<string, unknown>): void {
    if (doc.overrides !== undefined && typeof doc.base === "string") {
      const base = doc.base;
      out.overrides = overridesOf(
        () => prefab(base),
        doc.overrides,
        ["overrides"],
        "the variant's",
      );
    }
    if (isRecord(doc.params)) {
      const params: Record<string, unknown> = {};
      for (const [name, p] of Object.entries(doc.params)) {
        const target = isRecord(p) && Array.isArray(p.targets) ? p.targets[0] : undefined;
        const split = typeof target === "string" ? splitOverridePath(target) : null;
        params[name] =
          isRecord(p) && hasNumber(p.default) && split
            ? {
                ...p,
                default: at(["params", name, "default"], `param "${name}"'s default`, () =>
                  override(doc, split.child, split.field, p.default, 0),
                ),
              }
            : p;
      }
      out.params = params;
    }
    if (isRecord(doc.contract)) out.contract = fieldsOf(registry.prefabContract, doc.contract);
  }

  return function lift(doc: Body): Record<string, unknown> {
    const out: Record<string, unknown> = { ...doc, v: 4 };
    const isFile = doc.kind !== undefined;
    if (Array.isArray(doc.bounds)) out.bounds = doc.bounds.map(len);
    if (isRecord(doc.settings)) out.settings = settings(doc.settings);
    if (isRecord(doc.groups)) {
      const groups: Record<string, unknown> = {};
      for (const [id, g] of Object.entries(doc.groups))
        groups[id] = isRecord(g) && g.at !== undefined ? { ...g, at: pt(g.at) } : g;
      out.groups = groups;
    }
    if (Array.isArray(doc.instances))
      out.instances = doc.instances.map((inst, i) => instance(inst, ["instances", i]));
    if (Array.isArray(doc.entities)) out.entities = doc.entities.map(entity);
    if (isFile) {
      if (isRecord(doc.bulk)) out.bulk = bulk(doc.bulk);
    } else {
      const rows = Object.fromEntries(
        Object.entries(doc).filter(
          ([k]) => !RESERVED_SCENE_KEYS.includes(k) && registry.bulkKey(k),
        ),
      );
      Object.assign(out, bulk(rows));
    }
    if (doc.kind === PREFAB_KIND) prefabHeader(doc, out);
    return out;
  };
}

/** Runs `fn` for the value at `pointer`, turning a ref it can't follow into a refusal that names the site. */
function followAt<T>(pointer: (string | number)[], what: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof Unresolved)) throw error;
    throw new Refused(
      unresolved(jsonPointer(pointer), `${what} can't be followed: ${error.message}`),
    );
  }
}

/** Runs `fn` for the value at `pointer`, turning an unreadable unit into a refusal that names the site. */
function at<T>(pointer: (string | number)[], what: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof Unresolved)) throw error;
    throw new Refused(
      unresolved(jsonPointer(pointer), `${what} can't move to metres: ${error.message}`),
    );
  }
}

class Refused extends Error {
  constructor(readonly refusal: MigrationRefusal) {
    super(refusal.refused.message);
  }
}

/**
 * v3 → v4: lengths in metres. Every length is divided by the game's px per
 * metre (`roundLength`): the format's own (`bounds`, `settings.gravity`,
 * the grid's cell, origin and hex side, groups' and instances' `at`, bulk
 * entries) and every number under a field whose `meta.unit` is a length
 * unit, in entities, behavior blocks, the game's settings and a prefab's
 * contract. An instance's overrides and params, and a variant's overrides
 * and param defaults, take the unit of the child field they name, read
 * through `env.prefab`. Refuses (`migration-unresolved`) without a
 * registry, or when a number's field can't be resolved; a value with no
 * number in it needs no field.
 */
function v3ToV4(raw: unknown, env: MigrateEnv): unknown {
  const doc = raw as Record<string, unknown>;
  const registry = env.registry;
  if (!registry)
    return unresolved(
      "/v",
      "the v3 → v4 step moves lengths to metres with the game's px per metre and field units, and wasn't given the game's registry",
    );
  const game = typeof doc.game === "string" ? doc.game : undefined;
  if (game !== undefined && game !== registry.id)
    return { refused: unknownGameIssue(game, registry) };
  try {
    return metricStep(registry, env)(doc);
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

// ─── v4 → v5: the scene tree ─────────────────────────────

/** Whether a v4 doc is a scene: prefab files and fragments never had groups. */
const isSceneDoc = (doc: Body) => doc.kind === undefined;

/** Quarter turns `k` as degrees; anything else is left for the schema to judge. */
const quarterDeg = (k: unknown): unknown => (k === 1 || k === 2 || k === 3 ? 90 * k : k);

/** An instance with `rot` in degrees. */
function instanceDeg(inst: unknown): unknown {
  if (!isRecord(inst) || inst.rot === undefined) return inst;
  const out = { ...inst, rot: quarterDeg(inst.rot) };
  if (out.rot === 0) delete out.rot;
  return out;
}

/**
 * The v4 → v5 step for one document, over the registry it is read with.
 * Throws `Unresolved` where a ref can't be followed through `env.prefab`.
 */
function treeStep(registry: Registry, env: MigrateEnv) {
  const prefab = (id: unknown): Body => {
    if (typeof id !== "string") throw new Unresolved("its prefab id isn't a string");
    const found = env.prefab?.(id);
    if (!found)
      throw new Unresolved(
        env.prefab
          ? `prefab "${id}" isn't in the project`
          : `the step wasn't given prefab "${id}" to follow`,
      );
    return found as unknown as Body;
  };

  /** Whether `child` (a ref relative to `body`) names one of its nested instances. */
  function namesInstance(body: Body, child: string, depth: number): boolean {
    if (depth > PREFAB_MAX_DEPTH * 2) throw new Unresolved("its prefabs nest too deep to follow");
    const [head, ...rest] = child.split("/") as [string, ...string[]];
    const nested = listOf(body.instances).find((i) => i.id === head);
    if (rest.length > 0) {
      if (nested) return namesInstance(prefab(nested.prefab), rest.join("/"), depth + 1);
    } else {
      if (nested) return true;
      if (parseBulkId(head) || listOf(body.entities).some((e) => e.id === head)) return false;
    }
    if (typeof body.base === "string") return namesInstance(prefab(body.base), child, depth + 1);
    throw new Unresolved(`it names no child "${child}"`);
  }

  /** Overrides with each `<instance>.rot` value in degrees; `body` is what the keys are relative to. */
  function overridesDeg(
    body: () => Body,
    overrides: unknown,
    pointer: (string | number)[],
  ): unknown {
    if (!isRecord(overrides)) return overrides;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overrides)) {
      const split = splitOverridePath(key);
      out[key] =
        split?.field === "rot" && typeof value === "number"
          ? followAt([...pointer, key], `override "${key}"`, () =>
              namesInstance(body(), split.child, 0) ? quarterDeg(value) : value,
            )
          : value;
    }
    return out;
  }

  /**
   * Step 1: instance `rot` in degrees (`k` quarter turns are `90 × k`), in
   * the doc's instances and in overrides that set one.
   */
  function rotations(doc: Body, out: Record<string, unknown>): void {
    if (!Array.isArray(doc.instances)) return;
    out.instances = doc.instances.map((inst, i) => {
      const lifted = instanceDeg(inst);
      if (!isRecord(lifted) || lifted.overrides === undefined) return lifted;
      return {
        ...lifted,
        overrides: overridesDeg(() => prefab(lifted.prefab), lifted.overrides, [
          "instances",
          i,
          "overrides",
        ]),
      };
    });
  }

  /**
   * Step 2: each group a node at the front of `entities` (the next free
   * `<id>-<n>` when its id is taken), each `group` a `parent`; a `group`
   * naming no declared group is dropped.
   */
  function groups(doc: Body, out: Record<string, unknown>): void {
    const declared = isRecord(doc.groups) ? doc.groups : {};
    delete out.groups;
    const taken = new Set(
      [...listOf(out.entities), ...listOf(out.instances)].map((e) => String(e.id)),
    );
    const nodeOf = new Map<string, string>();
    const nodes: Record<string, unknown>[] = [];
    for (const g of Object.keys(declared).sort()) {
      const def = declared[g];
      if (!isRecord(def)) continue;
      let id = g;
      for (let n = 1; taken.has(id); n++) id = `${g}-${n}`;
      taken.add(id);
      nodeOf.set(g, id);
      const node: Record<string, unknown> = { id, type: NODE_TYPE };
      if (typeof def.name === "string") node.name = def.name;
      node.at = def.at;
      const rot = quarterDeg(def.rot);
      if (typeof rot === "number" && rot !== 0) node.rot = rot;
      if (def.flip === true) node.flip = true;
      nodes.push(node);
    }
    const lift = (item: unknown): unknown => {
      if (!isRecord(item) || item.group === undefined) return item;
      const { group, ...rest } = item;
      const node = typeof group === "string" ? nodeOf.get(group) : undefined;
      return node === undefined ? rest : { ...rest, parent: node };
    };
    if (Array.isArray(out.instances)) out.instances = out.instances.map(lift);
    if (nodes.length > 0 || Array.isArray(out.entities))
      out.entities = [...nodes, ...listOf(out.entities).map(lift)];
  }

  /** The prefabs `doc`'s instances reach, at the current version, for placing their children. */
  function library(doc: Body): PrefabLibrary {
    const out = new Map<string, Prefab>();
    const visit = (id: unknown, depth: number) => {
      if (typeof id !== "string" || out.has(id)) return;
      if (depth > PREFAB_MAX_DEPTH * 2) throw new Unresolved("its prefabs nest too deep to follow");
      const raw = prefab(id);
      const lifted =
        typeof raw.v === "number" && raw.v < SCENE_FORMAT_VERSION
          ? migrate(structuredClone(raw), MIGRATIONS, SCENE_FORMAT_VERSION, env)
          : { ok: true as const, raw };
      if (!lifted.ok) throw new Unresolved(lifted.issue.message);
      const body = lifted.raw as Body;
      out.set(id, { ...body, entities: listOf(body.entities) } as unknown as Prefab);
      for (const n of listOf(body.instances)) visit(n.prefab, depth + 1);
      visit(body.base, depth + 1);
    };
    for (const n of listOf(doc.instances)) visit(n.prefab, 0);
    return out;
  }

  /**
   * Step 3: `attach: f` on a type with no field of that name becomes
   * `parent: f`, its geometry moved from the world into `f`'s frame; an `f`
   * inside an instance is placed through `env.prefab`.
   */
  function attachments(out: Record<string, unknown>): void {
    const entities = listOf(out.entities);
    const riders = entities.filter(
      (e) =>
        typeof e.attach === "string" &&
        typeof e.type === "string" &&
        !("attach" in (registry.types.get(e.type)?.shape ?? {})),
    );
    if (riders.length === 0) return;
    const nested = entities.findIndex(
      (e) => riders.includes(e) && String(e.attach).includes(CHILD_SEPARATOR),
    );
    const view = {
      v: SCENE_FORMAT_VERSION,
      name: "",
      bounds: [0, 0, 0, 0],
      ...(isRecord(out.settings) ? { settings: out.settings } : {}),
      entities,
      instances: listOf(out.instances),
    } as unknown as SceneDefinition;
    const prefabs =
      nested < 0
        ? undefined
        : followAt(["entities", nested, "attach"], `${String(entities[nested]!.id)}.attach`, () =>
            library(out),
          );
    const frames = sceneFrames(view, registry, prefabs);
    const moved = new Map<Record<string, unknown>, Record<string, unknown>>();
    entities.forEach((e, i) => {
      if (!riders.includes(e)) return;
      const host = e.attach as string;
      const child = parseChildRef(host);
      const inst = child && view.instances?.find((x) => x.id === child.instance);
      if (child && !(inst && frames.placed(inst)?.some((c) => c.def.id === host)))
        throw new Refused(
          unresolved(
            jsonPointer(["entities", i, "attach"]),
            `${String(e.id)}.attach names "${host}", which the step can't place through its instance's prefab`,
          ),
        );
      const { attach: _attach, ...rest } = e;
      const by = compose(
        invert(composeSteps(frames.under(host))),
        composeSteps(frames.stepsFor(e as EntityDef)),
      );
      const placed = transformEntityDef(registry, rest as EntityDef, by) ?? (rest as EntityDef);
      moved.set(e, { ...placed, parent: host });
    });
    out.entities = entities.map((e) => moved.get(e) ?? e);
  }

  return function lift(doc: Body): Record<string, unknown> {
    const out: Record<string, unknown> = { ...doc };
    rotations(doc, out);
    if (doc.kind === PREFAB_KIND && doc.overrides !== undefined && typeof doc.base === "string") {
      const base = doc.base;
      out.overrides = overridesDeg(() => prefab(base), doc.overrides, ["overrides"]);
    }
    if (isSceneDoc(doc)) groups(doc, out);
    attachments(out);
    out.v = 5;
    return out;
  };
}

/**
 * v4 → v5: the scene tree, where instance `rot` counts degrees and groups and
 * `attach` become parents; refuses (`migration-unresolved`) without a
 * registry, or when a ref can't be followed through the prefabs.
 */
function v4ToV5(raw: unknown, env: MigrateEnv): unknown {
  const doc = raw as Record<string, unknown>;
  const registry = env.registry;
  if (!registry)
    return unresolved(
      "/v",
      "the v4 → v5 step places groups and attached colliders under parents through the game's registry, and wasn't given it",
    );
  const game = typeof doc.game === "string" ? doc.game : undefined;
  if (game !== undefined && game !== registry.id)
    return { refused: unknownGameIssue(game, registry) };
  try {
    return treeStep(registry, env)(doc);
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
  4: v4ToV5,
});

export type MigrateResult =
  | { ok: true; raw: unknown; from: number }
  | { ok: false; issue: SceneIssue };

export function migrate(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SCENE_FORMAT_VERSION,
  env: MigrateEnv = {},
): MigrateResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      issue: makeIssue("schema", {
        message: "a scene must be a JSON object",
        path: "",
        expected: "object",
        got: Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw,
      }),
    };
  }
  const v = (raw as Record<string, unknown>).v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return {
      ok: false,
      issue: makeIssue("schema", {
        message:
          v === undefined
            ? "the scene has no format version `v`"
            : `\`v\` must be a positive integer; got ${JSON.stringify(v)}`,
        path: "/v",
        expected: `integer 1..${target}`,
        got: v === undefined ? "missing" : JSON.stringify(v),
        hint: `Set "v": ${target}.`,
      }),
    };
  }
  if (v > target) {
    return {
      ok: false,
      issue: makeIssue("version-newer", {
        message: `the scene is format v${v}, but this engine reads up to v${target}`,
        path: "/v",
        expected: `<= ${target}`,
        got: String(v),
      }),
    };
  }
  let doc: unknown = raw;
  for (let step = v; step < target; step++) {
    const lift = migrations[step];
    if (!lift) {
      return {
        ok: false,
        issue: makeIssue("schema", {
          message: `no migration from scene format v${step} to v${step + 1}`,
          path: "/v",
          got: String(v),
        }),
      };
    }
    const lifted = lift(doc, env);
    if (isMigrationRefusal(lifted)) return { ok: false, issue: lifted.refused };
    doc = lifted;
  }
  return { ok: true, raw: doc, from: v };
}
