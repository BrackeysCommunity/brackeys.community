import type { SceneIssue } from "../scene/types";

/** A project's id: ID_PATTERN (`/^[a-z0-9][a-z0-9-]{0,47}$/`), unique on the site. */
export type ProjectId = string;
/** An asset's id: ID_PATTERN, unique among the project's live assets; changed only by changeAssetId. */
export type AssetId = string;
/** An asset's registry key: never changes. Its first id for assets seeded from files, `randomKey()` for created ones. */
export type AssetKey = string;
/**
 * Project-relative POSIX path including the file name: no leading "/", no
 * "." or ".." segments, no "\\", segments match /^[A-Za-z0-9._ -]{1,96}$/,
 * at most 255 characters. Case-sensitive, but two live paths that differ
 * only in case are `path-taken` (macOS and Windows checkouts).
 */
export type AssetPath = string;
/** 64 lowercase hex characters: SHA-256 of a blob's bytes or a doc's canonical UTF-8 text. */
export type Sha256 = string;
/** A kind's name: ID_PATTERN for the engine's, `<gameId>/<name>` for a game's. */
export type AssetKindName = string;

// ─── The project file ────────────────────────────────────

/** The file at a project's root that names it, its game module and which files are assets and code. Never co-edited. */
export const PROJECT_FILE = "jams.project.json";

export type ProjectFile = {
  $schema?: string;
  kind: "project";
  v: 1;
  id: ProjectId;
  name: string;
  /** The module that exports the GameDefinition, relative to this file; null for an engine-only project. */
  game: { module: string; export: string } | null;
  /** The module that exports the game's DOM UI (a `MountUi`), relative to this file; hosts mount it, the CLI never imports it. */
  ui?: { module: string; export: string };
  /** Globs of files that may be assets; default ["**"]. */
  assets?: string[];
  /** Globs of code modules the tree lists read-only; default ["**\/*.ts", "**\/*.tsx"]. */
  code?: string[];
  /** Extra excludes beside the fixed ones (`*.schema.json`, `*.asset.json`, the project file, `__tests__`, `node_modules`, `dist`). */
  ignore?: string[];
};

// ─── The registry ────────────────────────────────────────

export type Licence = {
  /** An SPDX id ("CC-BY-4.0") or "proprietary". */
  spdx?: string;
  author?: string;
  /** Where it came from: a URL or a description. */
  source?: string;
  /** The exact credit line the licence asks for; the credits page prints it. */
  attribution?: string;
};

/** One registry entry as plain JSON. In the doc, `import` and `licence` are nested Y.Maps (per-field merge); the rest are atomic. */
export type AssetEntry = {
  key: AssetKey;
  id: AssetId;
  kind: AssetKindName;
  path: AssetPath;
  /** Display name; absent means the path's stem. */
  name?: string;
  /** Blob kinds: the current content. */
  sha256?: Sha256;
  bytes?: number;
  /** Blob kinds: what the kind's inspect derived; never hand-edited. */
  meta?: Record<string, unknown>;
  /** Blob kinds: import settings. */
  import?: Record<string, unknown>;
  licence?: Licence;
  created: { at: number; by: string };
  /** In the trash: the entry's doc or blob is kept so a restore brings it back. */
  deleted?: { at: number; by: string };
};

/**
 * One record in a blob asset's hash history, oldest first. A hash gets an
 * entry when the asset first takes it and again each time it is replaced,
 * so a hash's newest `at` is when it last stopped being current (or first
 * became current, while it still is).
 */
export type HashHistoryEntry = { sha256: Sha256; bytes: number; at: number; by: string };

/** What a code module registers, as the tree lists it. */
export type CodeModuleInfo = {
  registers: { types?: string[]; kinds?: string[]; tables?: string[]; materials?: string[] };
};

/** One kind's schema hash as the newest build that wrote it saw it; a client with another hash and an older build is read-only on that kind. */
export type BuildStamp = { hash: Sha256; buildAt: number; engine: string };

/** Plain-JSON state of a project doc; what `./project` functions take. */
export type ProjectState = {
  meta: { projectId: ProjectId; layout: number; name: string };
  assets: Readonly<Record<AssetKey, AssetEntry>>;
  history: Readonly<Record<AssetKey, readonly HashHistoryEntry[]>>;
  code: Readonly<Record<string, CodeModuleInfo>>;
  build: Readonly<Record<AssetKindName, BuildStamp>>;
};

/** The resolved view every reader uses. */
export type ProjectView = {
  state: ProjectState;
  /** Live entries by id; for a duplicated id, the first by (created.at, key). */
  byId: ReadonlyMap<AssetId, AssetEntry>;
  byPath: ReadonlyMap<AssetPath, AssetEntry>;
  byKey: ReadonlyMap<AssetKey, AssetEntry>;
  deleted: readonly AssetEntry[];
  /** `asset-id-taken`, `path-taken`, `asset-kind` (an unregistered kind), with keys in `entityIds`. */
  issues: readonly SceneIssue[];
  /** The repairs a server would write: key → { id?, path? }. */
  repairs: ReadonlyMap<AssetKey, { id?: AssetId; path?: AssetPath }>;
  tree(): ProjectTreeNode[];
  /**
   * The game-settings asset's `engine` block, set by a reader that holds its
   * doc (`projectView` alone reads no docs). Validation resolves a scene's
   * physics and grid through it, as Play does.
   */
  engine?: Readonly<Record<string, unknown>>;
};

export type ProjectTreeNode =
  | { type: "folder"; path: string; children: ProjectTreeNode[] }
  | { type: "asset"; entry: AssetEntry }
  | { type: "code"; path: string; info: CodeModuleInfo };
