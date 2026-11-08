/**
 * The shared scene document: how a scene lives in a `Y.Doc`, who wrote a
 * change, and what presence carries. Pure types and constants.
 *
 * ```
 * doc.getMap("entities")  key → Y.Map   one per entity or bulk entry
 * doc.getMap("settings")  key → value   the scene's settings, one atomic value per top-level key
 * doc.getMap("scene")     name, bounds and any other header value a batch can change
 * doc.getMap("meta")      schemaVersion, layout, game, $schema, project, key: fixed after seeding
 * doc.getMap("groups")    group id → Y.Map { at, name? }
 * doc.getMap("instances") key → Y.Map    one per prefab instance: id, prefab, at, z, overrides (Y.Map), …
 * doc.getArray("log")     LogEntry[]    who changed what, capped, written with each batch
 * ```
 *
 * A prefab is a doc of its own (`./prefab-doc`): `meta` with kind "prefab",
 * a `prefab` header map and `entities`, laid out exactly as a scene's.
 */
import type { BulkKey, Pt, SceneOp } from "../scene/types";

export const DOC_MAPS = {
  entities: "entities",
  settings: "settings",
  scene: "scene",
  meta: "meta",
  groups: "groups",
  instances: "instances",
  /** Layout 1 only: the scene's prefabs, one atomic value each; `migrateLayout` moves them to prefab docs. */
  prefabs: "prefabs",
  /** A prefab doc's header: id and contract. */
  prefab: "prefab",
} as const;
export const LOG_ARRAY = "log";

/**
 * Fields of an entity's `Y.Map` that the layout owns. Every other key is one
 * of the entity's own fields: `shape`, `at` and anything array- or
 * object-valued is one atomic value (last writer wins), and `path` is a
 * nested `Y.Map` of `pts` (atomic), `mode`, `speed` and `pauseMs`.
 */
export const Z_FIELD = "z";
/** Set on bulk entries only: the bulk key whose array the entry is written to. */
export const BULK_FIELD = "bulk";
export const PATH_FIELD = "path";
/** On instances: a nested `Y.Map` of override key → value, so concurrent overrides of different fields merge. */
export const OVERRIDES_FIELD = "overrides";
/** Fields held as a nested `Y.Map`, patched key by key. */
export const NESTED_FIELDS: readonly string[] = [PATH_FIELD, OVERRIDES_FIELD];

/**
 * An entity as plain JSON, the way its `Y.Map` holds it: `z`, `bulk` for a
 * bulk entry (with `type` and its one geometry field), otherwise the
 * entity's on-disk fields (`id`, `type`, …) with `path` as a plain object.
 */
export type EntityRecord = {
  z: string;
  bulk?: BulkKey;
  type?: string;
  [field: string]: unknown;
};

/** `meta`: what a doc was seeded with. Only the server writes it. */
export type SceneDocMeta = {
  /** The scene format `v` the doc holds, after any migration at load. */
  schemaVersion: number;
  /** The collab layout it was seeded with; absent on a layout-1 doc. */
  layout?: number;
  /** "prefab" on a prefab doc; absent on a scene doc. */
  kind?: string;
  game?: string;
  $schema?: string;
  /** The project and registry key the doc belongs to, when its seeder knew them. */
  project?: string;
  key?: string;
};

/**
 * The doc layout this engine writes, stored as `meta.layout`. A doc with no
 * `meta.layout` is layout 1, and so is a sync token with no `l` claim.
 * Layout 2 moved prefabs out of the scene doc into docs of their own.
 */
export const COLLAB_LAYOUT_VERSION = 2;

/**
 * Who made a transaction. Yjs origins never leave the client, so the doc's
 * `log` records the actor for everyone else. Undo tracks one origin object
 * by identity: create it once per client and pass the same object to every
 * write. `repair` is the project's one writer (the dev server or the hosted
 * service) fixing paths, ids, hashes or quota.
 */
export type DocOrigin =
  | { kind: "user"; userId: string; name?: string }
  | { kind: "agent"; agentId: string; onBehalfOf?: string }
  | { kind: "disk" }
  | { kind: "migration" }
  | { kind: "repair"; reason: string };

export type SceneOrigin = DocOrigin;

/** The actor as a history row names it. */
export function actorLabel(origin: DocOrigin): string {
  switch (origin.kind) {
    case "user":
      return origin.name ?? origin.userId;
    case "agent":
      return origin.onBehalfOf ? `${origin.agentId} for ${origin.onBehalfOf}` : origin.agentId;
    case "disk":
      return "disk";
    case "migration":
      return "migration";
    case "repair":
      return `repair (${origin.reason})`;
  }
}

/** Pseudo-keys a log entry uses for the two non-entity maps it can touch. */
export const SETTINGS_KEY = "@settings";
export const SCENE_KEY = "@scene";
/** Log keys for the other maps: `@instance:<key>`, `@group:<id>`, `@prefab:<id>`. */
export const INSTANCE_KEY_PREFIX = "@instance:";
export const GROUP_KEY_PREFIX = "@group:";
export const PREFAB_KEY_PREFIX = "@prefab:";

/**
 * One batch, as every client's history shows it. `before` holds each touched
 * key's state before the batch (`null`: it didn't exist) and `after` a
 * fingerprint of its state after (`null`: removed), so Revert can restore
 * `before` once it has checked nothing changed since. An entry too large to
 * keep whole drops both and can't be reverted.
 */
export type LogEntry = {
  id: string;
  actor: DocOrigin;
  label: string;
  /** ms since the epoch, the writer's clock. */
  at: number;
  keys: string[];
  ops?: SceneOp["op"][];
  before?: Record<string, unknown>;
  after?: Record<string, string | null>;
  /** `undo`, `redo` or `revert` when the entry records one of those rather than a batch. */
  kind?: "batch" | "undo" | "redo" | "revert";
  /** What a migration left as it was, and why. Notes, never issue codes. */
  warnings?: LogWarning[];
};

/** A note on a log entry, such as `prefab-diverged` from a layout migration. */
export type LogWarning = { code: string; message: string; ids?: string[] };

/** One batch that wrote two or more docs, in the project doc's log: each doc keeps its own entry too. */
export type ProjectLogEntry = {
  id: string;
  actor: DocOrigin;
  label: string;
  at: number;
  /** Each doc's own log entry id for this batch, in write order. */
  docs: { doc: string; entry: string }[];
};

/**
 * What each client publishes through awareness. None of it is in the doc.
 * Selection names entity keys, which stay put while bulk refs shift.
 */
export type ScenePresence = {
  user: { id: string; name: string; color: string };
  selection: string[];
  /** World coordinates. */
  cursor?: Pt;
  tool?: string;
  /** A drag in progress: the keys being dragged and the offset so far. */
  ghost?: { keys: string[]; by: Pt };
  mode: "edit" | "play";
};

/**
 * The part of a y-protocols `Awareness` the presence helpers use, typed
 * structurally so the engine never imports a provider package.
 */
export type AwarenessLike = {
  clientID: number;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: "change", cb: (...args: unknown[]) => void): void;
  off(event: "change", cb: (...args: unknown[]) => void): void;
};

/** The awareness field presence is published under. */
export const PRESENCE_FIELD = "scene";

/** What each client publishes through the project doc's awareness: where it is, not what it selects. */
export type ProjectPresence = {
  user: { id: string; name: string; color: string };
  /** The doc this client is looking at, or null on the project overview. */
  doc: string | null;
  mode: "edit" | "play";
};

/** The awareness field project presence is published under. */
export const PROJECT_PRESENCE_FIELD = "project";
