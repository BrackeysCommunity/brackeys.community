import type { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import type { GameDefinition } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { ISSUE_CODES, jsonPointer, makeIssue } from "../scene/issues";
import { toJsonSchema } from "../scene/json-schema";
import { locatePointer } from "../scene/parse";
import type { IssueCode, SceneIssue } from "../scene/types";
import { canonicalJson, fieldLayout, stableJson } from "./canonical";
import { sha256 } from "./hash";
import { ATLAS_KIND, atlasExportApp } from "./kinds/atlas";
import {
  isPlainObject,
  type AssetKindDef,
  type DocKindDef,
  type DocLayout,
  type KindEnv,
  type ParseAssetResult,
} from "./kinds/define";
import { ENGINE_ASSET_KINDS } from "./kinds/index";
import { PROJECT_FILE, type AssetKindName, type AssetPath, type Sha256 } from "./types";

export {
  defineAssetKind,
  type AssetKindDef,
  type AssetMatch,
  type BlobKindDef,
  type CodeKindDef,
  type DocKindDef,
  type DocLayout,
  type InspectEnv,
  type InspectResult,
  type KindEnv,
  type ParseAssetResult,
} from "./kinds/define";

export type KindRegistry = {
  get(kind: AssetKindName): AssetKindDef | undefined;
  list(): readonly AssetKindDef[];
  /**
   * The kind of a file, in order: the sidecar's kind, the longest matching
   * suffix, a `.json` file's top-level `kind`, a kind's `test`. Null when
   * the file isn't an asset, is always skipped (`isSkippedAssetPath`), or
   * its sidecar names a kind this registry doesn't have.
   */
  detect(path: AssetPath, json?: unknown, sidecarKind?: string): AssetKindDef | null;
  /** Per-kind JSON Schema hash for code skew. */
  schemaHashes(env: KindEnv): Promise<Readonly<Record<AssetKindName, Sha256>>>;
};

const SKIPPED_SUFFIXES = [".schema.json", ".asset.json"];
const SKIPPED_DIRS: readonly string[] = ["__tests__", "node_modules", "dist"];

/** Whether a path is never an asset whatever the globs say: schemas, sidecars, the project file, tests and build output. */
export function isSkippedAssetPath(path: AssetPath): boolean {
  const segments = path.split("/");
  const name = (segments.pop() ?? "").toLowerCase();
  if (name === PROJECT_FILE || SKIPPED_SUFFIXES.some((s) => name.endsWith(s))) return true;
  return segments.some((s) => SKIPPED_DIRS.includes(s));
}

function checkName(def: AssetKindDef, gameId: string | null): void {
  const name = def.kind;
  if (gameId === null) {
    if (!ID_PATTERN.test(name)) throw new Error(`asset kind "${name}" doesn't match ${ID_PATTERN}`);
    return;
  }
  const prefix = `${gameId}/`;
  if (!name.startsWith(prefix) || !ID_PATTERN.test(name.slice(prefix.length)))
    throw new Error(`game "${gameId}"'s asset kind "${name}" must be named "${prefix}<name>"`);
  if (def.storage === "doc" && def.layout === "custom")
    throw new Error(`game "${gameId}"'s asset kind "${name}" can't use layout "custom"`);
}

/**
 * Engine kinds (`base`, default `ENGINE_ASSET_KINDS`) first, then the
 * game's `assetKinds`. Throws on a duplicate name, an engine kind whose name
 * isn't an id, a game kind not named `<gameId>/<name>` or with `layout:
 * "custom"`, a declarative layout whose root isn't a `map`, and a suffix or
 * `jsonKind` two kinds claim.
 */
export function createKindRegistry(
  game?: GameDefinition | null,
  base: readonly AssetKindDef[] = ENGINE_ASSET_KINDS,
): KindRegistry {
  const kinds = new Map<AssetKindName, AssetKindDef>();
  const suffixes: { suffix: string; def: AssetKindDef }[] = [];
  const jsonKinds = new Map<string, AssetKindDef>();
  const tests: AssetKindDef[] = [];

  const add = (def: AssetKindDef, gameId: string | null) => {
    checkName(def, gameId);
    if (kinds.has(def.kind)) throw new Error(`asset kind "${def.kind}" is registered twice`);
    if (def.storage === "doc" && def.layout !== "custom" && def.layout.as !== "map")
      throw new Error(`asset kind "${def.kind}"'s layout must have a "map" root`);
    kinds.set(def.kind, def);
    for (const raw of def.match.suffixes ?? []) {
      const suffix = raw.toLowerCase();
      const other = suffixes.find((s) => s.suffix === suffix);
      if (other)
        throw new Error(`asset kinds "${other.def.kind}" and "${def.kind}" both claim "${raw}"`);
      suffixes.push({ suffix, def });
    }
    const jsonKind = def.match.jsonKind;
    if (jsonKind !== undefined) {
      const other = jsonKinds.get(jsonKind);
      if (other)
        throw new Error(
          `asset kinds "${other.kind}" and "${def.kind}" both claim jsonKind "${jsonKind}"`,
        );
      jsonKinds.set(jsonKind, def);
    }
    if (def.match.test) tests.push(def);
  };
  for (const def of base) add(def, null);
  for (const def of game?.assetKinds ?? []) add(def, game!.id);
  suffixes.sort((a, b) => b.suffix.length - a.suffix.length);
  const list = [...kinds.values()];

  return {
    get: (kind) => kinds.get(kind),
    list: () => list,
    detect(path, json, sidecarKind) {
      if (isSkippedAssetPath(path)) return null;
      if (sidecarKind !== undefined) return kinds.get(sidecarKind) ?? null;
      const name = (path.split("/").pop() ?? "").toLowerCase();
      const bySuffix = suffixes.find((s) => name.endsWith(s.suffix));
      if (bySuffix) return bySuffix.def;
      if (!name.endsWith(".json") || json === undefined) return null;
      if (isPlainObject(json) && typeof json.kind === "string") {
        const byKind = jsonKinds.get(json.kind);
        if (byKind) return byKind;
      }
      return tests.find((def) => def.match.test!(json)) ?? null;
    },
    async schemaHashes(env) {
      const out: Record<AssetKindName, Sha256> = {};
      for (const def of list) {
        const schema = kindJsonSchema(def, env);
        if (schema !== null) out[def.kind] = await sha256(stableJson(schema));
      }
      return out;
    },
  };
}

/**
 * The kind a file brought into a project takes: `detect`'s, else, for a
 * `.json` that names no kind, `atlas` when its `meta.app` says Aseprite or
 * TexturePacker exported it. Detection by path then differs, so the
 * imported file's sidecar records the kind.
 */
export function detectImport(
  kinds: KindRegistry,
  path: AssetPath,
  json?: unknown,
): AssetKindDef | null {
  const detected = kinds.detect(path, json);
  if (detected || isSkippedAssetPath(path)) return detected;
  if (!path.toLowerCase().endsWith(".json") || atlasExportApp(json) === null) return null;
  return kinds.get(ATLAS_KIND) ?? null;
}

/** The JSON Schema a kind's content is judged by; a blob kind's is its settings and meta. Null for code. */
function kindJsonSchema(def: AssetKindDef, env: KindEnv): unknown {
  switch (def.storage) {
    case "doc":
      return toJsonSchema(def.schema(env));
    case "blob":
      return { settings: toJsonSchema(def.settings), meta: toJsonSchema(def.meta) };
    case "code":
      return null;
  }
}

/** A doc kind's draft 2020-12 JSON Schema as a file publishes it: `$id`, the agent surface and a title first. */
export function docKindJsonSchema(def: DocKindDef, env: KindEnv): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(def.schema(env));
  const of = env.registry.game ? ` for ${env.registry.id}` : "";
  return {
    $schema,
    $id: def.schemaId,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine ${def.title.toLowerCase()}${of}, format v${def.version}`,
    ...rest,
  };
}

const isEngineCode = (code: unknown): code is IssueCode =>
  typeof code === "string" && Object.hasOwn(ISSUE_CODES, code);

/**
 * Zod issues as SceneIssues: `unknown-key` for extra keys, `schema`
 * otherwise. A schema's custom issue whose `params.issue` names an engine
 * code (`asset-kind`) reports as that code, with `params.hint`,
 * `params.expected` and `params.got` when given.
 */
function zodIssues(error: z.ZodError): SceneIssue[] {
  return error.issues.flatMap((issue) => {
    const segments = issue.path.filter((s): s is string | number => typeof s !== "symbol");
    const path = jsonPointer(segments);
    const where = path || "the document";
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) =>
        makeIssue("unknown-key", {
          message: `unknown key "${key}" at ${where}`,
          path: `${path}${jsonPointer([key])}`,
          got: key,
        }),
      );
    if (
      issue.code === "custom" &&
      isPlainObject(issue.params) &&
      isEngineCode(issue.params.issue)
    ) {
      const { hint, expected, got } = issue.params;
      return [
        makeIssue(issue.params.issue, {
          message: `${where}: ${issue.message}`,
          path,
          ...(typeof hint === "string" ? { hint } : {}),
          ...(typeof expected === "string" ? { expected } : {}),
          ...(typeof got === "string" ? { got } : {}),
        }),
      ];
    }
    const expected =
      "expected" in issue && typeof issue.expected === "string" ? issue.expected : undefined;
    return [
      makeIssue("schema", {
        message: `${where}: ${issue.message}`,
        path,
        ...(expected === undefined ? {} : { expected }),
      }),
    ];
  });
}

/** `dup-id` for each item of a `keyed` collection whose id an earlier item of that collection has. */
function duplicateIds(
  layout: DocLayout,
  value: unknown,
  at: (string | number)[],
  out: SceneIssue[],
): void {
  if (layout.as === "map" && isPlainObject(value)) {
    for (const [k, v] of Object.entries(value))
      duplicateIds(fieldLayout(layout, k), v, [...at, k], out);
  } else if (layout.as === "list" && Array.isArray(value)) {
    value.forEach((v, i) => duplicateIds(layout.item, v, [...at, i], out));
  } else if (layout.as === "keyed" && Array.isArray(value)) {
    const idField = layout.id ?? "id";
    const seen = new Set<string>();
    value.forEach((item, i) => {
      const id = isPlainObject(item) ? item[idField] : undefined;
      if (typeof id === "string") {
        if (seen.has(id))
          out.push(
            makeIssue("dup-id", {
              message: `two items of ${jsonPointer(at) || "the document"} have the id "${id}"`,
              path: jsonPointer([...at, i, idField]),
              entityIds: [id],
              hint: `Give the later one a new id, e.g. "${id}-2".`,
            }),
          );
        seen.add(id);
      }
      duplicateIds(layout.item, item, [...at, i], out);
    });
  }
}

/**
 * Judges a doc kind's parsed, migrated value: its schema's issues, a
 * `dup-id` for each repeated id in a `keyed` collection, then the kind's
 * own `validate` when the schema passed.
 */
export function validateAssetDoc(kind: DocKindDef, value: unknown, env: KindEnv): SceneIssue[] {
  const parsed = kind.schema(env).safeParse(value);
  const issues = parsed.success ? [] : zodIssues(parsed.error);
  if (kind.layout !== "custom") duplicateIds(kind.layout, value, [], issues);
  if (parsed.success && kind.validate) issues.push(...kind.validate(parsed.data, env));
  return issues;
}

/** The file's `v` lifted to `kind.version` through its migrations, or the issue that stops it. */
function migrateAsset(
  kind: DocKindDef,
  raw: Record<string, unknown>,
): { ok: true; raw: Record<string, unknown>; from: number } | { ok: false; issue: SceneIssue } {
  const what = `the ${kind.title.toLowerCase()} file`;
  const v = raw.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    return {
      ok: false,
      issue: makeIssue("schema", {
        message:
          v === undefined
            ? `${what} has no format version \`v\``
            : `\`v\` must be a positive integer; got ${JSON.stringify(v)}`,
        path: "/v",
        expected: `integer 1..${kind.version}`,
        got: v === undefined ? "missing" : JSON.stringify(v),
        hint: `Set "v": ${kind.version}.`,
      }),
    };
  if (v > kind.version)
    return {
      ok: false,
      issue: makeIssue("version-newer", {
        message: `${what} is format v${v}; this engine reads up to v${kind.version}`,
        path: "/v",
        expected: `<= ${kind.version}`,
        got: String(v),
      }),
    };
  let doc: unknown = raw;
  for (let step = v; step < kind.version; step++) {
    const lift = kind.migrations?.[step];
    if (!lift)
      return {
        ok: false,
        issue: makeIssue("schema", {
          message: `no migration from ${kind.kind} format v${step} to v${step + 1}`,
          path: "/v",
          got: String(v),
        }),
      };
    doc = lift(doc);
  }
  if (!isPlainObject(doc)) throw new Error(`${kind.kind}'s migration from v${v} lost the object`);
  return { ok: true, raw: doc, from: v };
}

/**
 * Reads a doc kind's file from text or a parsed value: JSON, the `kind`
 * its `jsonKind` names, `v` and migrations, then `validateAssetDoc`. The
 * value is the migrated JSON as written, so formatting it gives the file
 * back. Refused when any issue is an error; issues from text carry lines.
 * A kind with its own `parse` (scenes, prefabs) is read by it. Never throws.
 */
export function parseAssetDoc<J>(
  kind: DocKindDef<J>,
  input: unknown,
  env: KindEnv,
): ParseAssetResult<J> {
  if (kind.parse) return kind.parse(input, env);
  const what = `the ${kind.title.toLowerCase()} file`;
  const text = typeof input === "string" ? input : undefined;
  const withLine = (issue: SceneIssue): SceneIssue => {
    if (text === undefined || issue.path === undefined || issue.line !== undefined) return issue;
    const line = locatePointer(text, issue.path);
    return line === undefined ? issue : { ...issue, line };
  };
  let raw = input;
  if (text !== undefined) {
    try {
      raw = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        issues: [makeIssue("schema", { message: `${what} isn't valid JSON: ${detail}`, path: "" })],
      };
    }
  }
  if (!isPlainObject(raw))
    return {
      ok: false,
      issues: [
        makeIssue("schema", {
          message: `${what} must be a JSON object`,
          path: "",
          expected: "object",
          got: Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw,
        }),
      ],
    };
  const jsonKind = kind.match.jsonKind;
  if (jsonKind !== undefined && raw.kind !== jsonKind)
    return {
      ok: false,
      issues: [
        withLine(
          makeIssue("schema", {
            message: `expected ${what}, an object with "kind": "${jsonKind}"`,
            path: "/kind",
            expected: JSON.stringify(jsonKind),
            got: raw.kind === undefined ? "missing" : JSON.stringify(raw.kind),
          }),
        ),
      ],
    };
  const migrated = migrateAsset(kind, raw);
  if (!migrated.ok) return { ok: false, issues: [withLine(migrated.issue)] };
  const issues = validateAssetDoc(kind, migrated.raw, env).map(withLine);
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues };
  const value = migrated.raw as J;
  return migrated.from === kind.version
    ? { ok: true, value, issues }
    : { ok: true, value, migratedFrom: migrated.from, issues };
}

/** A doc kind's canonical text: its `format`, else `canonicalJson` over its layout. */
export function formatAssetDoc<J>(kind: DocKindDef<J>, value: J): string {
  if (kind.format) return kind.format(value);
  if (kind.layout === "custom") throw new Error(`asset kind "${kind.kind}" has no formatter`);
  return canonicalJson(value, kind.layout);
}
