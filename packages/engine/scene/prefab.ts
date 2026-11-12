import { z } from "zod";

import { AssetIdSchema, ID_PATTERN } from "../game/fields";
import { ENGINE_REGISTRY_ID, type Registry } from "../game/types";
import { FIELD_NAME_PATTERN } from "./field-path";
import { formatPrefab, formatScene } from "./format";
import { FRAGMENT_KIND, fragmentSchemaFor, parseFragment } from "./fragment";
import { hashText } from "./hash";
import { jsonPointer, makeIssue } from "./issues";
import { migrate, MIGRATIONS } from "./migrate";
import { migrateEnvOf, parseScene, type ParseOptions } from "./parse";
import { paramMapProblem } from "./prefab-params";
import { InstanceSchema, OVERRIDE_PATH } from "./schema";
import {
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type BulkEntry,
  type BulkKey,
  type InstanceDef,
  type Prefab,
  type PrefabBody,
  type PrefabLibrary,
  type PrefabParam,
  type SceneDefinition,
  type SceneHash,
  type SceneIssue,
} from "./types";

export { PREFAB_KIND };

/** Where a scenes directory keeps its prefabs: `<dir>/prefabs/<id>.json`. */
export const PREFABS_DIR = "prefabs";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The schema of a prefab's `contract`: the game's `prefabContract` fields, or none at all. */
function contractSchema(registry: Registry): z.ZodType {
  return Object.keys(registry.prefabContract).length > 0
    ? z
        .strictObject(registry.prefabContract)
        .optional()
        .describe("What the game promises about this prefab; its fields are the game's.")
        .meta({ title: "Contract" })
    : z
        .never()
        .optional()
        .describe("This game defines no prefab contract, so a prefab carries none.");
}

const OverridePathSchema = z.string().regex(OVERRIDE_PATH, {
  error: "an override key is `<childId>.<field.path>`, e.g. door.path.speed",
});

/**
 * One exposed parameter, as a prefab file and an `exposeParam` op carry it,
 * with `path` the schema of its targets.
 */
export const prefabParamSchema = (path: z.ZodString) =>
  z
    .strictObject({
      description: z.string().min(1).describe("One sentence for the inspector and agents."),
      targets: z
        .array(path)
        .min(1)
        .describe("Override paths inside the prefab that the value feeds, e.g. `door.path.speed`."),
      default: z
        .unknown()
        .optional()
        .describe("Used when an instance sets none; omitted, the targets' own values stand."),
      map: z
        .record(path, z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          'Per target, the value it takes for each string value of the param, e.g. `{ "unit.behaviors.sprite.frame": { "red": "knight-red" } }`. A mapped target with no entry for the value keeps its own; targets left out take the value as it is.',
        ),
    })
    .describe("An exposed parameter: one value an instance sets that overrides every target.");

const PrefabParamSchema = prefabParamSchema(OverridePathSchema);

/** The header keys a variant and its parameters add, in file order. */
const variantHeader = {
  base: z
    .string()
    .regex(ID_PATTERN)
    .optional()
    .describe(
      "The prefab this one is a variant of: its children are the base's, with `overrides` applied, plus this file's own.",
    )
    .meta({ title: "Base" }),
  params: z
    .record(z.string().regex(FIELD_NAME_PATTERN), PrefabParamSchema)
    .optional()
    .describe(
      "Exposed parameters by name. An instance's `params` value applies as an override of each target; a variant inherits its base's and may redeclare one.",
    )
    .meta({ title: "Parameters" }),
  assets: z
    .array(AssetIdSchema)
    .optional()
    .describe("Asset ids only game code names, so they count as used: sorted, each once.")
    .meta({ title: "Assets" }),
  overrides: z
    .record(OverridePathSchema, z.unknown())
    .optional()
    .describe(
      "A variant's changes to its base's children, keyed `<childId>.<field.path>`; `off: true` hides one.",
    )
    .meta({ title: "Overrides" }),
};
const VariantHeaderSchema = z.strictObject(variantHeader);

/**
 * The schema of a prefab file judged by `registry`: a fragment's entities
 * and bulk entries around a local origin, nested instances of other
 * prefabs, its id, and the game's contract.
 */
export function prefabSchemaFor(registry: Registry): z.ZodObject {
  const fragment = fragmentSchemaFor(registry).shape;
  return z
    .strictObject({
      $schema: z
        .string()
        .optional()
        .describe("Path or URI of this file's JSON Schema, for editors. Ignored by the engine."),
      kind: z.literal(PREFAB_KIND),
      v: z.literal(SCENE_FORMAT_VERSION).describe("The scene format version it was written at."),
      ...(registry.id === ENGINE_REGISTRY_ID
        ? {}
        : { game: z.literal(registry.id).optional().describe("The game it belongs to.") }),
      id: z
        .string()
        .regex(ID_PATTERN)
        .describe("The prefab's id; matches the file name without .json.")
        .meta({ title: "Id" }),
      base: variantHeader.base,
      contract: contractSchema(registry),
      params: variantHeader.params,
      assets: variantHeader.assets,
      overrides: variantHeader.overrides,
      bulk: fragment.bulk,
      instances: z
        .array(InstanceSchema)
        .optional()
        .describe(
          "Instances of other prefabs nested in this one, placed around its origin. Their children load with ids `<instance>/<child>` under this prefab's own instance.",
        ),
      entities: fragment.entities,
    })
    .describe(
      "A prefab: entities, bulk entries and nested instances around a local origin, placed in scenes by instances, optionally a variant of a base prefab. Coordinates are relative to the origin, which an instance's `at` puts in the world. `entities` is required and may be empty.",
    );
}

export type ParsePrefabResult =
  | { ok: true; prefab: Prefab; migratedFrom?: number; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

const PREFAB_KEYS = [
  "$schema",
  "kind",
  "v",
  "game",
  "id",
  "base",
  "contract",
  "params",
  "assets",
  "overrides",
  "bulk",
  "instances",
  "entities",
];
const SCRATCH_BOUNDS = [0, 0, 1, 1];

/**
 * Parses a prefab file from text or a parsed value. Its entities and bulk
 * entries go through `parseFragment` (migrations, the registry's schemas,
 * duplicate entity ids), its instances through the scene's own instance
 * schema, then the id, the game's contract and the variant header (`base`,
 * `params`, `assets`, `overrides`) are checked. Which prefabs the instances
 * and the base name, cycles, depth and whether overrides and param targets
 * reach a child are `validateScene`'s. Never throws.
 */
export function parsePrefab(
  input: unknown,
  registry: Registry,
  opts: ParseOptions = {},
): ParsePrefabResult {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        issues: [
          makeIssue("schema", { message: `the prefab isn't valid JSON: ${detail}`, path: "" }),
        ],
      };
    }
  }
  if (!isRecord(raw) || raw.kind !== PREFAB_KIND) {
    return {
      ok: false,
      issues: [
        makeIssue("schema", {
          message: `expected a prefab, an object with "kind": "${PREFAB_KIND}"`,
          path: isRecord(raw) ? "/kind" : "",
          expected: `"${PREFAB_KIND}"`,
          got: isRecord(raw) ? JSON.stringify(raw.kind) : typeof raw,
        }),
      ],
    };
  }
  const extra = Object.keys(raw).filter((k) => !PREFAB_KEYS.includes(k));
  if (extra.length > 0) {
    return {
      ok: false,
      issues: extra.map((k) =>
        makeIssue("unknown-key", {
          message: `unknown key "${k}" in the prefab`,
          path: jsonPointer([k]),
          got: k,
          expected: PREFAB_KEYS.join(", "),
        }),
      ),
    };
  }
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    return {
      ok: false,
      issues: [
        makeIssue("bad-id", {
          message: `the prefab's id ${JSON.stringify(raw.id)} must match ${ID_PATTERN.source}`,
          path: "/id",
          expected: ID_PATTERN.source,
          got: JSON.stringify(raw.id),
        }),
      ],
    };
  }
  let doc: Record<string, unknown> = raw;
  let migratedFrom: number | undefined;
  if (
    typeof raw.v === "number" &&
    Number.isInteger(raw.v) &&
    raw.v >= 1 &&
    raw.v < SCENE_FORMAT_VERSION
  ) {
    const lifted = migrate(raw, MIGRATIONS, SCENE_FORMAT_VERSION, migrateEnvOf(registry, opts));
    if (!lifted.ok) return { ok: false, issues: [lifted.issue] };
    migratedFrom = lifted.from;
    doc = lifted.raw as Record<string, unknown>;
  }
  const fragment = parseFragment(
    {
      kind: FRAGMENT_KIND,
      v: doc.v,
      ...(doc.game !== undefined ? { game: doc.game } : {}),
      entities: doc.entities ?? [],
      ...(doc.bulk !== undefined ? { bulk: doc.bulk } : {}),
    },
    registry,
    opts,
  );
  if (!fragment.ok) return fragment;
  const instances = parseInstances(doc, registry, opts);
  if (!instances.ok) return instances;
  const contract = contractSchema(registry).safeParse(doc.contract);
  if (!contract.success) {
    const first = contract.error.issues[0]!;
    return {
      ok: false,
      issues: [
        makeIssue(first.code === "unrecognized_keys" ? "unknown-key" : "schema", {
          message: `contract: ${first.message}`,
          path: jsonPointer(["contract", ...first.path.map(String)]),
        }),
      ],
    };
  }
  const header = VariantHeaderSchema.safeParse({
    base: doc.base,
    params: doc.params,
    assets: doc.assets,
    overrides: doc.overrides,
  });
  if (!header.success) {
    const first = header.error.issues[0]!;
    const path = first.path.map(String);
    const what = path.length > 0 ? `${path.join(".")}: ` : "";
    return {
      ok: false,
      issues: [
        makeIssue(first.code === "unrecognized_keys" ? "unknown-key" : "schema", {
          message: `${what}${first.message}`,
          path: jsonPointer(path),
        }),
      ],
    };
  }
  const { base, params, assets, overrides } = header.data;
  for (const [name, param] of Object.entries(params ?? {})) {
    const problem = paramMapProblem(param);
    if (problem)
      return {
        ok: false,
        issues: [
          makeIssue("schema", {
            message: `param "${name}" ${problem.message}`,
            path: jsonPointer(["params", name, ...problem.path]),
          }),
        ],
      };
  }
  const f = fragment.fragment;
  const prefab: Prefab = {
    ...(typeof doc.$schema === "string" ? { $schema: doc.$schema } : {}),
    kind: PREFAB_KIND,
    v: f.v,
    ...(f.game !== undefined ? { game: f.game } : {}),
    id: raw.id,
    ...(base !== undefined ? { base } : {}),
    ...(contract.data !== undefined ? { contract: contract.data } : {}),
    ...(params && Object.keys(params).length > 0 ? { params: paramsOf(params) } : {}),
    ...(assets && assets.length > 0 ? { assets } : {}),
    ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
    ...(f.bulk ? { bulk: f.bulk } : {}),
    ...(instances.instances ? { instances: instances.instances } : {}),
    entities: f.entities,
  };
  const from = migratedFrom ?? fragment.migratedFrom;
  return from === undefined
    ? { ok: true, prefab, issues: [] }
    : { ok: true, prefab, migratedFrom: from, issues: [] };
}

/** Parsed params with an absent `default` left out rather than kept as `undefined`. */
function paramsOf(params: Record<string, PrefabParam>): Record<string, PrefabParam> {
  const out: Record<string, PrefabParam> = {};
  for (const [name, p] of Object.entries(params))
    out[name] = {
      description: p.description,
      targets: p.targets,
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.map && Object.keys(p.map).length > 0 ? { map: p.map } : {}),
    };
  return out;
}

/**
 * A prefab's `instances`, migrated and checked as a scene's are, with the
 * same pointers (`/instances/0/at`) a scene's issues carry.
 */
function parseInstances(
  raw: Record<string, unknown>,
  registry: Registry,
  opts: ParseOptions,
): { ok: true; instances?: InstanceDef[] } | { ok: false; issues: SceneIssue[] } {
  if (raw.instances === undefined) return { ok: true };
  const game =
    raw.game ?? (registry.id === ENGINE_REGISTRY_ID ? undefined : (registry.id as unknown));
  const parsed = parseScene(
    {
      v: raw.v,
      ...(game !== undefined ? { game } : {}),
      name: typeof raw.id === "string" ? raw.id : "prefab",
      bounds: SCRATCH_BOUNDS,
      instances: raw.instances,
    },
    registry,
    opts,
  );
  if (!parsed.ok) return parsed;
  const instances = parsed.def.instances ?? [];
  return instances.length > 0 ? { ok: true, instances } : { ok: true };
}

/** A library from a list of prefabs; a later prefab with the same id wins. */
export function prefabLibrary(prefabs: Iterable<Prefab>): PrefabLibrary {
  const out = new Map<string, Prefab>();
  for (const p of prefabs) out.set(p.id, p);
  return out;
}

/** The prefab file a body becomes for scene `def`: current version, the scene's game. */
export function prefabOf(id: string, body: PrefabBody, game?: string): Prefab {
  return {
    kind: PREFAB_KIND,
    v: SCENE_FORMAT_VERSION,
    ...(game !== undefined ? { game } : {}),
    id,
    ...(body.base !== undefined ? { base: body.base } : {}),
    ...(body.contract !== undefined ? { contract: structuredClone(body.contract) } : {}),
    ...headerOf(body),
    entities: structuredClone(body.entities),
    ...(body.bulk && Object.keys(body.bulk).length > 0 ? { bulk: structuredClone(body.bulk) } : {}),
    ...(body.instances && body.instances.length > 0
      ? { instances: structuredClone(body.instances) }
      : {}),
  };
}

/** A body's non-empty `params`, `assets` and `overrides`, copied. */
function headerOf(body: PrefabBody): Partial<PrefabBody> {
  return {
    ...(body.params && Object.keys(body.params).length > 0
      ? { params: structuredClone(body.params) }
      : {}),
    ...(body.assets && body.assets.length > 0 ? { assets: [...body.assets] } : {}),
    ...(body.overrides && Object.keys(body.overrides).length > 0
      ? { overrides: structuredClone(body.overrides) }
      : {}),
  };
}

/** What `definePrefab` carries for a prefab: its body, base, params, assets and overrides, without the file's identity. */
export function prefabBody(prefab: Prefab): PrefabBody {
  return {
    entities: structuredClone(prefab.entities),
    ...(prefab.bulk ? { bulk: structuredClone(prefab.bulk) } : {}),
    ...(prefab.instances ? { instances: structuredClone(prefab.instances) } : {}),
    ...(prefab.contract !== undefined ? { contract: structuredClone(prefab.contract) } : {}),
    ...(prefab.base !== undefined ? { base: prefab.base } : {}),
    ...headerOf(prefab),
  };
}

/**
 * The prefab ids a scene reaches, sorted by code unit, each once: those its
 * instances name and, with `prefabs`, every one those reach in turn through
 * their nested instances and variant bases. A prefab missing from `prefabs`
 * is listed and reaches nothing further; a cycle ends where it closes.
 */
export function prefabsUsedBy(def: SceneDefinition, prefabs?: PrefabLibrary): string[] {
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const prefab = prefabs?.get(id);
    if (!prefab) return;
    if (typeof prefab.base === "string") visit(prefab.base);
    for (const nested of prefab.instances ?? []) visit(nested.prefab);
  };
  for (const instance of def.instances ?? []) visit(instance.prefab);
  return [...seen].sort();
}

/**
 * The scene's hash with every prefab it reaches (`prefabsUsedBy`): what a
 * recording or a cache keys on, so editing a prefab, nested ones included,
 * marks it stale. A scene with no instances hashes as `sceneHash` does.
 */
export function sceneHashWith(def: SceneDefinition, prefabs?: PrefabLibrary): SceneHash {
  const used = prefabsUsedBy(def, prefabs);
  const text = formatScene(def).text;
  if (used.length === 0) return hashText(text);
  const parts = used.map((id) => {
    const p = prefabs?.get(id);
    return `prefab ${id}\n${p ? formatPrefab({ ...p, $schema: undefined }) : "missing\n"}`;
  });
  return hashText([text, ...parts].join("\n"));
}

/**
 * A prefab as a scene of its own, for editing it in isolation and for
 * validating it: its children at their local coordinates, around the origin,
 * and its `assets` header. Its variant base, overrides and params stay on
 * the prefab, which the view's header ops change.
 */
export function prefabScene(prefab: Prefab, bounds: SceneDefinition["bounds"]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    ...(prefab.game !== undefined ? { game: prefab.game } : {}),
    name: prefab.id,
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    ...structuredClone(prefab.bulk ?? {}),
    ...(prefab.instances && prefab.instances.length > 0
      ? { instances: structuredClone(prefab.instances) }
      : {}),
    ...(prefab.entities.length > 0 ? { entities: structuredClone(prefab.entities) } : {}),
    ...(prefab.assets && prefab.assets.length > 0 ? { assets: [...prefab.assets] } : {}),
  };
}

/** A scene's entities, bulk arrays, instances and `assets` as a prefab body, the other way from `prefabScene`. */
export function sceneBody(
  def: SceneDefinition,
  registry: Registry,
  contract?: unknown,
): PrefabBody {
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const { key } of registry.bulkKeys) {
    const rows = def[key];
    if (Array.isArray(rows) && rows.length > 0) bulk[key] = structuredClone(rows as BulkEntry[]);
  }
  return {
    entities: structuredClone(def.entities ?? []),
    ...(Object.keys(bulk).length > 0 ? { bulk } : {}),
    ...(def.instances && def.instances.length > 0
      ? { instances: structuredClone(def.instances) }
      : {}),
    ...(def.assets && def.assets.length > 0 ? { assets: [...def.assets] } : {}),
    ...(contract !== undefined ? { contract: structuredClone(contract) } : {}),
  };
}

/** The canonical text of each prefab, by id, as files are written. */
export function formatPrefabs(prefabs: PrefabLibrary): Map<string, string> {
  return new Map([...prefabs].map(([id, p]) => [id, formatPrefab(p)]));
}
