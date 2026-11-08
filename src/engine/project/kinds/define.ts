import type { z } from "zod";

import type { Registry } from "../../game/types";
import type { Migration } from "../../scene/migrate";
import type { SceneIssue } from "../../scene/types";
import type { RefSite } from "../refs";
import type { AssetEntry, AssetId, AssetKindName, AssetPath, ProjectView } from "../types";

/** What a kind's schema, defaults and checks may depend on. */
export type KindEnv = { registry: Registry; project: ProjectView | null };

export type AssetMatch = {
  /** File-name suffixes; the longest match across kinds wins. */
  suffixes?: readonly string[];
  /** For `.json` files: the value of the top-level "kind" field. */
  jsonKind?: string;
  /** Last resort for `.json` files with no "kind"; only the scene kind has one. */
  test?: (json: unknown) => boolean;
};

type KindBase = {
  kind: AssetKindName;
  title: string;
  description: string;
  match: AssetMatch;
  /** Where createAsset puts a new asset when the op gives no folder. */
  defaultFolder?: (env: KindEnv, near?: AssetPath) => string;
};

/**
 * How a doc kind's canonical JSON lives in Yjs. The root is always a `map`;
 * the engine derives the doc codec and the merge behaviour from it, so a
 * game never writes Yjs code.
 */
export type DocLayout =
  /** One value; concurrent writes: last writer wins. */
  | { as: "atomic" }
  /** A string as Y.Text; concurrent edits merge by character. */
  | { as: "text" }
  /** An object as Y.Map; keys merge independently. `fields` name known keys, `rest` covers the others. */
  | { as: "map"; fields?: Readonly<Record<string, DocLayout>>; rest?: DocLayout }
  /** An array as Y.Array of items; inserts merge, an edited item is replaced whole. */
  | { as: "list"; item: DocLayout }
  /**
   * An array of objects with ids, as a Y.Map from generated key to the
   * item's Y.Map plus a fractional `z` (the entity pattern): items and
   * their fields merge independently, order is by `z`, two items with one
   * id stay two and report `dup-id`.
   */
  | { as: "keyed"; id?: string /* default "id" */; item: Extract<DocLayout, { as: "map" }> };

/** A doc kind's file read: its migrated value, or the issues that refuse it. */
export type ParseAssetResult<J = unknown> =
  | { ok: true; value: J; migratedFrom?: number; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

export type DocKindDef<J = unknown> = KindBase & {
  storage: "doc";
  /** Doc name prefix; only the scene kind uses "scene". */
  prefix?: "asset" | "scene";
  /** The file format's current `v`; files carry it as "v". */
  version: number;
  migrations?: Readonly<Record<number, Migration>>;
  /** The kind's JSON Schema `$id`, e.g. "urn:jams-engine:material:v1". */
  schemaId: string;
  /** Judges a parsed, migrated value; may depend on the registry (a table's row schema). */
  schema(env: KindEnv): z.ZodType<J>;
  /** "custom" only for the engine's scene and prefab kinds, whose codecs are in ./collab. */
  layout: DocLayout | "custom";
  /**
   * Reads text or a parsed value, migrations included, in place of
   * `parseAssetDoc`'s JSON, `v` and schema steps. Only the engine's custom
   * kinds have one: they wrap the scene and prefab parsers. Never throws.
   */
  parse?(input: unknown, env: KindEnv): ParseAssetResult<J>;
  /** Canonical text; default `canonicalJson(value, layout)`. Must not depend on the registry. */
  format?(value: J): string;
  /** The id a file of this kind declares itself, when it has one (prefabs: "id"). */
  idField?: string;
  /** What createAsset writes when the op carries no content. */
  empty(env: KindEnv, init: { id: AssetId }): J;
  /** Outgoing references: every place the value names another asset. */
  refs?(value: J, env: KindEnv): readonly RefSite[];
  /** Issues beyond the schema's; never throws. */
  validate?(value: J, env: KindEnv): readonly SceneIssue[];
  /** Per-doc caps; the hosted service enforces them. */
  limits?: { maxStateBytes: number; maxItems?: number };
};

export type InspectEnv = {
  /** The asset id at a project path, for references a file makes by name (an atlas's image). */
  idAt(path: AssetPath): AssetId | undefined;
  /** The path of the asset being inspected. */
  path: AssetPath;
};

export type InspectResult<M> =
  | { ok: true; meta: M; import?: Record<string, unknown> }
  | { ok: false; issue: SceneIssue /* code "import-failed" */ };

export type BlobKindDef<M = unknown, S = unknown> = KindBase & {
  storage: "blob";
  contentTypes: readonly string[];
  maxBytes: number;
  /** Import settings: every field optional with a default, so `{}` is valid. */
  settings: z.ZodType<S>;
  meta: z.ZodType<M>;
  /** Pure and deterministic: the same bytes and settings give the same meta everywhere, from headers alone. */
  inspect(bytes: Uint8Array, settings: S, env: InspectEnv): InspectResult<M>;
  refs?(entry: AssetEntry): readonly RefSite[];
};

/** Game code: listed read-only, never a doc. */
export type CodeKindDef = KindBase & { storage: "code" };

export type AssetKindDef = DocKindDef<any> | BlobKindDef<any, any> | CodeKindDef;

/** Identity at runtime; types the definition. Names are checked when a KindRegistry is built. */
export function defineAssetKind<K extends AssetKindDef>(def: K): K {
  return def;
}

/** `near`'s folder, or the project root. */
export function folderOf(near?: AssetPath): string {
  if (near === undefined) return "";
  const at = near.lastIndexOf("/");
  return at < 0 ? "" : near.slice(0, at);
}

/** `name` inside `folder` ("" is the root). */
export const joinFolder = (folder: string, name: string): string =>
  folder === "" ? name : `${folder}/${name}`;

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** UTF-16 code-unit order, as `Array.prototype.sort` orders strings: the same on every host and locale. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Path order, the key breaking a tie: how a project's assets of one kind are read in turn. */
export const byPathThenKey = (a: AssetEntry, b: AssetEntry): number =>
  byCodeUnit(a.path, b.path) || byCodeUnit(a.key, b.key);
