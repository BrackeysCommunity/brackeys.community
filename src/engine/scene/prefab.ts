import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import { ENGINE_REGISTRY_ID, type Registry } from "../game/types";
import { formatPrefab, formatScene } from "./format";
import { FRAGMENT_KIND, fragmentSchemaFor, parseFragment } from "./fragment";
import { hashText } from "./hash";
import { jsonPointer, makeIssue } from "./issues";
import {
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type BulkEntry,
  type BulkKey,
  type Prefab,
  type PrefabBody,
  type PrefabLibrary,
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

/**
 * The schema of a prefab file judged by `registry`: a fragment's entities
 * and bulk entries around a local origin, its id, and the game's contract.
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
      contract: contractSchema(registry),
      entities: fragment.entities,
      bulk: fragment.bulk,
    })
    .describe(
      "A prefab: entities and bulk entries around a local origin, placed in scenes by instances. Coordinates are relative to the origin, which an instance's `at` puts in the world.",
    );
}

export type ParsePrefabResult =
  | { ok: true; prefab: Prefab; migratedFrom?: number; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

const PREFAB_KEYS = ["$schema", "kind", "v", "game", "id", "contract", "entities", "bulk"];

/**
 * Parses a prefab file from text or a parsed value. Its entities and bulk
 * entries go through `parseFragment` (migrations, the registry's schemas,
 * duplicate ids), then the id and the game's contract are checked. Never
 * throws.
 */
export function parsePrefab(input: unknown, registry: Registry): ParsePrefabResult {
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
  const fragment = parseFragment(
    {
      kind: FRAGMENT_KIND,
      v: raw.v,
      ...(raw.game !== undefined ? { game: raw.game } : {}),
      entities: raw.entities ?? [],
      ...(raw.bulk !== undefined ? { bulk: raw.bulk } : {}),
    },
    registry,
  );
  if (!fragment.ok) return fragment;
  const contract = contractSchema(registry).safeParse(raw.contract);
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
  const f = fragment.fragment;
  const prefab: Prefab = {
    ...(typeof raw.$schema === "string" ? { $schema: raw.$schema } : {}),
    kind: PREFAB_KIND,
    v: f.v,
    ...(f.game !== undefined ? { game: f.game } : {}),
    id: raw.id,
    ...(contract.data !== undefined ? { contract: contract.data } : {}),
    entities: f.entities,
    ...(f.bulk ? { bulk: f.bulk } : {}),
  };
  return fragment.migratedFrom === undefined
    ? { ok: true, prefab, issues: [] }
    : { ok: true, prefab, migratedFrom: fragment.migratedFrom, issues: [] };
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
    ...(body.contract !== undefined ? { contract: structuredClone(body.contract) } : {}),
    entities: structuredClone(body.entities),
    ...(body.bulk && Object.keys(body.bulk).length > 0 ? { bulk: structuredClone(body.bulk) } : {}),
  };
}

/** What `definePrefab` carries for a prefab: its body without the file's header. */
export function prefabBody(prefab: Prefab): PrefabBody {
  return {
    entities: structuredClone(prefab.entities),
    ...(prefab.bulk ? { bulk: structuredClone(prefab.bulk) } : {}),
    ...(prefab.contract !== undefined ? { contract: structuredClone(prefab.contract) } : {}),
  };
}

/** The prefab ids a scene's instances name, sorted, each once. */
export function prefabsUsedBy(def: SceneDefinition): string[] {
  return [...new Set((def.instances ?? []).map((i) => i.prefab))].sort();
}

/**
 * The scene's hash with the prefabs it uses: what a recording or a cache
 * keys on, so editing a prefab marks it stale. A scene with no instances
 * hashes as `sceneHash` does.
 */
export function sceneHashWith(def: SceneDefinition, prefabs?: PrefabLibrary): SceneHash {
  const used = prefabsUsedBy(def);
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
 * validating it: its children at their local coordinates, around the origin.
 */
export function prefabScene(prefab: Prefab, bounds: SceneDefinition["bounds"]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    ...(prefab.game !== undefined ? { game: prefab.game } : {}),
    name: prefab.id,
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    ...structuredClone(prefab.bulk ?? {}),
    ...(prefab.entities.length > 0 ? { entities: structuredClone(prefab.entities) } : {}),
  };
}

/** A scene's entities and bulk arrays as a prefab body, the other way from `prefabScene`. */
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
    ...(contract !== undefined ? { contract: structuredClone(contract) } : {}),
  };
}

/** The canonical text of each prefab, by id, as files are written. */
export function formatPrefabs(prefabs: PrefabLibrary): Map<string, string> {
  return new Map([...prefabs].map(([id, p]) => [id, formatPrefab(p)]));
}
