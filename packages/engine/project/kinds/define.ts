import type { z } from "zod";

import type { Registry } from "../../game/types";
import { makeIssue } from "../../scene/issues";
import type { Migration, MigrateEnv } from "../../scene/migrate";
import type { SceneIssue } from "../../scene/types";
import type { RefSite } from "../refs";
import type { AssetEntry, AssetId, AssetKindName, AssetPath, ProjectView } from "../types";
import type { InputMapFile } from "./input-map";

/** What a kind's schema, defaults and checks may depend on. */
export type KindEnv = {
  registry: Registry;
  project: ProjectView | null;
  /**
   * The project's prefabs by id, parsed, for a host that holds their docs:
   * a scene or prefab migration reads the fields its instances override.
   */
  prefab?: MigrateEnv["prefab"];
  /**
   * The project's input map as a run reads it (`kindInputMap`), for a host
   * that holds its doc: an input script's tracks drive the seats its
   * `players` give, over the game's.
   */
  inputMap?: Pick<InputMapFile, "players"> | null;
};

/** The migration env of a kind's file: the registry, and the project's prefabs when the host gave them. */
export function kindMigrateEnv(env: KindEnv): MigrateEnv {
  return env.prefab ? { registry: env.registry, prefab: env.prefab } : { registry: env.registry };
}

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

/**
 * Other docs as a kind's `crossValidate` reads them; `ProjectRuntimeView`'s
 * `docs` and `doc` are a lookup over its runtime docs.
 */
export type DocLookup = {
  /** Every live asset id of a kind, in path order. */
  ids: (kind: AssetKindName) => readonly AssetId[];
  /** A doc's parsed, migrated value; undefined when missing or invalid. */
  read: <T = unknown>(kind: AssetKindName, id: AssetId) => T | undefined;
};

/**
 * A `DocLookup` over parsed docs by kind, then id. `ids` gives a kind's
 * ids from `ids` when given (every live entry, parsed or not), else the
 * ids `byKind` holds, in its map's order.
 */
export function docLookup(
  byKind: ReadonlyMap<AssetKindName, ReadonlyMap<AssetId, unknown>>,
  ids?: ReadonlyMap<AssetKindName, readonly AssetId[]>,
): DocLookup {
  const listed = new Map<AssetKindName, readonly AssetId[]>();
  for (const [kind, list] of ids ?? []) listed.set(kind, Object.freeze([...list]));
  if (!ids) for (const [kind, docs] of byKind) listed.set(kind, Object.freeze([...docs.keys()]));
  const none: readonly AssetId[] = Object.freeze([]);
  return {
    ids: (kind) => listed.get(kind) ?? none,
    read: <T = unknown>(kind: AssetKindName, id: AssetId) =>
      byKind.get(kind)?.get(id) as T | undefined,
  };
}

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
  /** Issues that need other docs' contents (an animation's atlas tags); never throws. */
  crossValidate?(value: J, lookup: DocLookup, env: KindEnv): readonly SceneIssue[];
  /**
   * Game code or an engine system reads this kind while a game runs: it
   * loads into the runtime view and ships in every export. "sim": its data
   * can change what a run does, so it joins the run's hash; "view":
   * presentation only.
   */
  runtime?: "sim" | "view";
  /**
   * The references a scene's first-frame bundle follows through a doc of
   * this kind that an entity names; default every `refs` site. A kind whose
   * blobs load on demand (a sound's non-preloaded clips) leaves those out.
   */
  bundleRefs?(value: J, env: KindEnv): readonly RefSite[];
  /** Per-doc caps; the hosted service enforces them. */
  limits?: { maxStateBytes: number; maxItems?: number };
  /**
   * 1 when a project holds at most one asset of this kind: the first live
   * one by path is in effect, a later one reports `asset-kind`, and an op
   * that would add a second is refused.
   */
  perProject?: 1;
  /** How a one-per-project kind's issues name its asset; defaults from `kind`. */
  perProjectWords?: PerProjectWords;
};

/** The words a one-per-project kind's `asset-kind` issues use. */
export type PerProjectWords = {
  /** After "a second": default `<kind> asset`. */
  noun: string;
  /** After "the project already has its": default `noun`. */
  held?: string;
  /** What the hint moves into the first one: default "contents". */
  contents?: string;
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
  /** Bumped when `inspect` learns more. Sidecars don't record it yet, so nothing re-inspects by it. */
  metaVersion?: number;
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

/** Whether game code or an engine system reads `def`'s docs while a game runs (`DocKindDef.runtime`). */
export const isRuntimeKind = (def: AssetKindDef | undefined): def is DocKindDef<any> =>
  def?.storage === "doc" && def.runtime !== undefined;

/** The names of `kinds`' runtime kinds, in registration order: what a runtime view loads and an export ships. */
export function runtimeKindNames(kinds: { list(): readonly AssetKindDef[] }): AssetKindName[] {
  return kinds
    .list()
    .filter(isRuntimeKind)
    .map((def) => def.kind);
}

/** Whether a project holds at most one asset of `def`'s kind. */
export const isPerProject = (def: AssetKindDef | undefined): def is DocKindDef<any> =>
  def?.storage === "doc" && def.perProject === 1;

function perProjectWords(def: DocKindDef<any>): Required<PerProjectWords> {
  const noun = def.perProjectWords?.noun ?? `${def.kind} asset`;
  return {
    noun,
    held: def.perProjectWords?.held ?? noun,
    contents: def.perProjectWords?.contents ?? "contents",
  };
}

/** The project's live assets of `kind`, the one in effect (first by path) first. */
export function perProjectEntries(view: ProjectView, kind: AssetKindName): AssetEntry[] {
  return [...view.byId.values()].filter((e) => e.kind === kind).sort(byPathThenKey);
}

/** `asset-kind` for every live asset of a one-per-project kind after the first by path; none for other kinds. */
export function perProjectIssues(view: ProjectView, def: AssetKindDef): SceneIssue[] {
  if (!isPerProject(def)) return [];
  const words = perProjectWords(def);
  const [first, ...extra] = perProjectEntries(view, def.kind);
  return extra.map((entry) =>
    makeIssue("asset-kind", {
      message: `"${entry.id}" is a second ${words.noun}; "${first!.id}" (${first!.path}) is the project's`,
      entityIds: [entry.key],
      got: entry.path,
      hint: `Move its ${words.contents} into "${first!.id}" and delete it.`,
    }),
  );
}

/** `perProjectIssues` for every kind of `kinds`, in their order. */
export function onePerProjectIssues(
  view: ProjectView,
  kinds: { list(): readonly AssetKindDef[] },
): SceneIssue[] {
  return kinds.list().flatMap((def) => perProjectIssues(view, def));
}

/**
 * Why adding an asset of `def`'s kind is refused: the one the project
 * already holds, and the message naming it. Null when the kind allows many
 * or the project holds none.
 */
export function perProjectHeld(
  view: ProjectView,
  def: AssetKindDef | undefined,
): { held: AssetEntry; message: string } | null {
  if (!isPerProject(def)) return null;
  const [held] = perProjectEntries(view, def.kind);
  if (!held) return null;
  return {
    held,
    message: `the project already has its ${perProjectWords(def).held}, "${held.id}" (${held.path}); a project has at most one`,
  };
}
