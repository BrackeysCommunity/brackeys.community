/**
 * The scene format's shared types. Pure types and constants, no imports: the
 * set of entity types, bulk keys, materials and issue codes a scene may use
 * comes from a registry (`game/define.ts`), not from this file.
 */

export const SCENE_FORMAT_VERSION = 3;

export type Pt = [x: number, y: number];
export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];
/** 16 lowercase hex characters over the canonical text. */
export type SceneHash = string;
/** An entity id, or a bulk reference `~<bulkKey>:<index>`, e.g. `~solid:ice:3`. */
export type Ref = string;
/** A dot path into an entity: `shape`, `path.speed`, `path.pts.1`. */
export type FieldPath = string;
/**
 * A path into one child of a prefab: the child's id (or `~key:index` for a
 * bulk child), a dot, then a field path: `door.path.speed`, `~solid:0.shape`.
 */
export type OverridePath = string;
/** A project asset's id (`ID_PATTERN`). */
export type AssetId = string;

/**
 * Keys a scene document has besides its bulk arrays, in canonical order.
 * Bulk keys follow them, sorted by code unit, then `entities`.
 */
export const SCENE_HEADER_KEYS = [
  "$schema",
  "v",
  "game",
  "name",
  "bounds",
  "settings",
  "assets",
  "groups",
  "instances",
] as const;
/** Top-level keys no bulk key may take. */
export const RESERVED_SCENE_KEYS: readonly string[] = [...SCENE_HEADER_KEYS, "entities"];

// ─── Shapes ──────────────────────────────────────────────
export type ShapeTuple =
  | ["box", cx: number, cy: number, hw: number, hh: number]
  | ["box", cx: number, cy: number, hw: number, hh: number, rotDeg: number]
  | ["circle", cx: number, cy: number, r: number]
  | ["capsule", cx: number, cy: number, halfLen: number, r: number]
  | ["capsule", cx: number, cy: number, halfLen: number, r: number, rotDeg: number]
  | ["poly", ...coords: number[]]
  | ["chain", ...coords: number[]];
export type ShapeObj =
  | { type: "box"; cx: number; cy: number; hw: number; hh: number; rotDeg: number }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "capsule"; cx: number; cy: number; halfLen: number; r: number; rotDeg: number }
  | { type: "poly"; pts: Pt[] }
  | { type: "chain"; pts: Pt[] };
export type ShapeType = ShapeObj["type"];
export type RectInput = { type: "rect"; left: number; top: number; right: number; bottom: number };
export type ShapeInput = ShapeTuple | ShapeObj | RectInput;
export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

// ─── Entities on disk ────────────────────────────────────
export type PathDef = { pts: Pt[]; mode: "ping_pong" | "loop"; speed: number; pauseMs?: number };

/** A registered entity type's name, e.g. `solid`, or a game's own `crate`. */
export type EntityTypeName = string;

/** Fields every entity has, whatever its type. */
export type EntityBase = {
  id: string;
  type: EntityTypeName;
  name?: string;
  /** A registry layer's name; omitted means `defaultLayer`'s. */
  layer?: string;
  /** Draw order within the layer: an integer, default 0. */
  z?: number;
  group?: string;
  off?: boolean;
};

/** An entity as written on disk. Its other fields are whatever its type's schema says. */
export type EntityDef = EntityBase & { [field: string]: unknown };

/** The two forms a bulk entry takes. */
export type BulkForm = "shape" | "point";
/** One entry of a bulk array: a shape tuple or a point. */
export type BulkEntry = ShapeTuple | Pt;
/**
 * A top-level array of id-less entries of one type: the type's name, or
 * `<type>:<material>` for a type whose bulk form takes materials
 * (`solid:ice`).
 */
export type BulkKey = string;

/**
 * A group: members store their geometry relative to `at`, so moving the
 * group is one edit to `at`. `rot` is quarter turns clockwise (y down) and
 * `flip` mirrors x before turning; absent is the identity.
 */
export type GroupDef = { at: Pt; rot?: 1 | 2 | 3; flip?: true; name?: string };

/**
 * One placement of a prefab. Its children load as entities with ids
 * `<id>/<childId>` (bulk children `<id>/~key:index`), translated by `at`
 * and then by the instance's group.
 */
export type InstanceDef = {
  id: string;
  prefab: string;
  at: Pt;
  /** Quarter turns clockwise (y down); absent is 0. */
  rot?: 1 | 2 | 3;
  /** Mirror x in the prefab's frame, before `rot`. */
  flip?: true;
  /** Added to every child's `z`. */
  z?: number;
  /** Values of the prefab's exposed parameters, by name. */
  params?: Record<string, unknown>;
  /**
   * Child fields that differ from the prefab, by `childId.field.path`. Each
   * value is in the frame of the prefab that owns the child: for a nested
   * child (`door-1/panel`), its own prefab's frame.
   */
  overrides?: Record<OverridePath, unknown>;
  name?: string;
  layer?: string;
  group?: string;
  off?: boolean;
};

/** The scene's one cell grid; the hex parameters match Tiled's. */
export type GridSettings =
  | { kind: "square"; cell: [w: number, h: number]; origin?: Pt }
  | {
      kind: "hex";
      /** The hex's bounding box, px (Tiled's tilewidth, tileheight). */
      cell: [w: number, h: number];
      /** The length of the flat sides, px (Tiled's hexsidelength). */
      side: number;
      stagger: "x" | "y";
      index: "odd" | "even";
      origin?: Pt;
    };

/** The engine's settings; a game's settings schema adds its own keys beside them. */
export type SceneSettings = {
  /** World gravity, px/s²; y is down. Omitted: the project's, else the game's default. */
  gravity?: Pt;
  /** "none" runs without Rapier; omitted resolves through the project and game defaults to "rapier". */
  physics?: "rapier" | "none";
  grid?: GridSettings;
  /** Reserved for projections; only the default exists. */
  view?: { projection: "orthogonal" };
  [key: string]: unknown;
};

/**
 * A scene document, the same in memory as on disk. Bulk arrays sit at the
 * top level under their bulk keys; read them through the registry.
 */
export type SceneDefinition = {
  $schema?: string;
  v: number;
  /** The game whose registry validates this file; omitted means engine primitives only. */
  game?: string;
  name: string;
  bounds: Bounds;
  settings?: SceneSettings;
  /** Assets only game code names, sorted and unique. */
  assets?: AssetId[];
  /** Declared groups by id. A member of a group stores geometry local to the group's `at`. */
  groups?: Record<string, GroupDef>;
  instances?: InstanceDef[];
  entities?: EntityDef[];
  [bulkKey: BulkKey]: unknown;
};

// ─── What the runtime loads ──────────────────────────────
/** On-disk field types as the runtime sees them: shape tuples become `ShapeObj`. */
export type RuntimeField<T> = T extends ShapeTuple ? ShapeObj : T;
export type RuntimeFields<F> = { [K in keyof F]: RuntimeField<F[K]> };

/**
 * One loadable entity: bulk entries expanded to `~key:index` ids, shapes
 * parsed, `off` entities and types that don't load (notes) dropped.
 */
export type RuntimeEntity<F extends object = { [field: string]: unknown }> = {
  id: string;
  type: EntityTypeName;
  /** Whole behavior blocks in registration order; present only when non-empty. */
  behaviors?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Draw order within the layer; present only when non-zero. */
  z?: number;
  /** The entity's layer after instance inheritance; present only when set. */
  layer?: string;
  /** The turns and flips of the instances and groups above it; present only when not the identity. */
  transform?: { turn: 0 | 1 | 2 | 3; flip: boolean };
} & RuntimeFields<F>;

/** The engine's settings with defaults applied, plus the game's as given. */
export type ResolvedSettings = {
  gravity: Pt;
  physics: "rapier" | "none";
  grid: GridSettings | null;
  view: { projection: "orthogonal" };
  [key: string]: unknown;
};

export type ExpandedScene = {
  name: string;
  game?: string;
  bounds: Bounds;
  settings: ResolvedSettings;
  /** In spawn order: the registry's spawn groups; within one, bulk first, then file order. */
  entities: RuntimeEntity[];
};

// ─── Issues ──────────────────────────────────────────────
export type Severity = "error" | "warn" | "info";
/** The engine's own codes. A game's codes are `<game-id>/<code>`. */
export const ENGINE_ISSUE_CODE_LIST = [
  // format
  "schema",
  "unknown-key",
  "unknown-type",
  "unknown-game",
  "bad-shape",
  "bad-id",
  "version-newer",
  // structural
  "dup-id",
  "dangling-ref",
  "ref-type",
  "poly-invalid",
  "chain-invalid",
  "path-invalid",
  "prefab-unknown",
  "path-degenerate",
  "non-integer",
  "out-of-bounds",
  "hidden-layer",
  "unused-override",
  "prefab-cycle",
  "prefab-depth",
  "variant-base-unknown",
  "param-unknown",
  "layer-unknown",
  "behavior-unknown",
  "behavior-forbidden",
  "behavior-missing",
  "grid-invalid",
  "ref-child-unknown",
  "physics-required",
  "physics-skipped",
  "nav-invalid",
  // physical
  "follower-hits-solid",
  "solid-overlap",
  "grid-unreachable",
  // ops
  "stale-base",
  "ref-not-found",
  "op-invalid",
  "id-taken",
  // project
  "asset-missing",
  "asset-kind",
  "asset-frame-unknown",
  "sprite-no-asset",
  "tick-rate-invalid",
  "asset-in-use",
  "asset-id-taken",
  "path-taken",
  "hash-mismatch",
  "code-skew",
  "asset-too-large",
  "import-failed",
  "quota-exceeded",
] as const;
export type EngineIssueCode = (typeof ENGINE_ISSUE_CODE_LIST)[number];
/** An engine code, or a game's `<game-id>/<code>`. */
export type IssueCode = EngineIssueCode | `${string}/${string}`;
export type SceneIssue = {
  severity: Severity;
  code: IssueCode;
  /** One sentence; names ids, not indices. */
  message: string;
  /**
   * JSON Pointer into the on-disk document, e.g. `/entities/3/path/pts/1`;
   * for an op that failed to apply, into its batch (`/ops/2/ref`).
   */
  path?: string;
  line?: number;
  entityIds: string[];
  at?: Pt;
  expected?: string;
  got?: string;
  hint?: string;
  fix?: OpBatch;
  /** Facts specific to the code, e.g. `code-skew`'s two schema hashes. */
  detail?: Record<string, unknown>;
};
export type IssueCodeInfo = {
  severity: Severity;
  summary: string;
  hint: string;
  /** The issue carries a `fix` batch whenever a mechanical repair exists; some instances have none. */
  fixable: boolean;
};

// ─── Ops ─────────────────────────────────────────────────
/** An entity to add: its type's fields, shapes in any `ShapeInput` form, id optional. */
export type EntityInput = Omit<EntityBase, "id"> & { id?: string; [field: string]: unknown };
/** An instance to add; without an id it gets `<prefab>-<n>`. */
export type InstanceInput = Omit<InstanceDef, "id"> & { id?: string };
/** One exposed parameter of a prefab. */
export type PrefabParam = {
  description: string;
  /** Override paths inside the prefab that the value feeds, e.g. "door.path.speed". */
  targets: OverridePath[];
  /** Shown in the inspector and used when an instance sets none; omitted, the targets' own values stand. */
  default?: unknown;
};
/** A prefab's content as a `definePrefab` op carries it: its children around a local origin. */
export type PrefabBody = {
  entities: EntityDef[];
  bulk?: Record<BulkKey, BulkEntry[]>;
  /** Nested instances. */
  instances?: InstanceDef[];
  contract?: unknown;
  /** A variant's base prefab. */
  base?: string;
  /** A variant's overrides of its base's children. */
  overrides?: Record<OverridePath, unknown>;
  /** Exposed parameters by name. */
  params?: Record<string, PrefabParam>;
  /** Assets only game code names. */
  assets?: AssetId[];
};
/** How deep prefabs may nest, through instances and variant bases. */
export const PREFAB_MAX_DEPTH = 8;
export const PREFAB_KIND = "prefab";
/** A prefab file, `<scenes dir>/prefabs/<id>.json`: a body plus who it is. */
export type Prefab = PrefabBody & {
  $schema?: string;
  kind: typeof PREFAB_KIND;
  /** The scene format version it was written at. */
  v: number;
  /** The game whose registry judges it; omitted, engine primitives only. */
  game?: string;
  id: string;
};
/** Prefabs by id. */
export type PrefabLibrary = ReadonlyMap<string, Prefab>;
export type SpotAnchor = "center" | "top" | "bottom" | "left" | "right";
/** One grid cell to paint: column, row, value (0 erases). */
export type CellEdit = [col: number, row: number, value: number];
/** A filled rectangle of cells, corners inclusive. */
export type CellRect = [c0: number, r0: number, c1: number, r1: number, value: number];
export type SceneOp =
  | { op: "add"; entity: EntityInput; index?: number }
  /** For a shape-form bulk key. */
  | { op: "addBulk"; key: BulkKey; shapes: ShapeInput[]; index?: number }
  /** For a point-form bulk key. */
  | { op: "addBulk"; key: BulkKey; points: Pt[]; index?: number }
  | { op: "update"; ref: Ref; set?: Record<FieldPath, unknown>; unset?: FieldPath[] }
  | { op: "move"; refs: Ref[]; by: Pt }
  | { op: "place"; ref: Ref; at: Pt; anchor?: SpotAnchor }
  | { op: "remove"; refs: Ref[] }
  | { op: "rename"; from: string; to: string }
  | { op: "promote"; ref: Ref; id: string }
  | { op: "demote"; id: string }
  | { op: "setScene"; set: { name?: string; bounds?: Bounds } }
  /** Paths into `settings`, e.g. `gravity` or a game's `rules.maxCrates`. */
  | { op: "setSettings"; set?: Record<FieldPath, unknown>; unset?: FieldPath[] }
  /** Moves entities or instances to `index` within their list, counted without them. */
  | { op: "reorder"; refs: Ref[]; index: number }
  | { op: "instantiate"; instance: InstanceInput; index?: number }
  /** Declares a group or changes it; `remove` drops a group no entity or instance is in. */
  | {
      op: "setGroup";
      id: string;
      at?: Pt;
      /** Absolute; 0 is written as absent. */
      rot?: 0 | 1 | 2 | 3;
      /** Absolute; false is written as absent. */
      flip?: boolean;
      name?: string | null;
      remove?: boolean;
    }
  /**
   * Sets an instance's overrides; with no `ref`, in a prefab's own document,
   * the prefab's own overrides of its variant base's children.
   */
  | { op: "override"; ref?: Ref; set: Record<OverridePath, unknown> }
  /** Drops overrides (the paths given, or every one) of an instance, or with no `ref` of the open prefab. */
  | { op: "revertOverride"; ref?: Ref; paths?: OverridePath[] }
  /**
   * Folds an instance's overrides (the paths given, or every one) into its
   * prefab, or into `to`, a deeper prefab in its chain.
   */
  | { op: "applyToPrefab"; ref: Ref; paths?: OverridePath[]; to?: string }
  /**
   * Replaces an instance with its own children, one level: entities and bulk
   * entries become plain entries, nested instances become instances.
   */
  | { op: "unpack"; ref: Ref }
  /**
   * Moves entities, bulk entries and instances (which become nested instances)
   * into a new prefab around `at` and puts one instance of it there.
   */
  | { op: "createPrefab"; refs: Ref[]; id: string; at?: Pt; instance?: string }
  /** Sets a prefab in the library, or deletes it with `null`. */
  | { op: "definePrefab"; id: string; prefab: PrefabBody | null }
  /** Turns and flips instances (by id) and groups (by id), composing onto what they have, about `about` (default each one's `at`). */
  | {
      op: "transform";
      refs?: string[];
      groups?: string[];
      turn?: 1 | 2 | 3 | -1;
      flip?: "x" | "y";
      about?: Pt;
    }
  /** Sets or shifts `z` on entities and instances; bulk entries refuse (promote first). */
  | { op: "setZ"; refs: Ref[]; z?: number; by?: number }
  /** Adds and removes ids in the scene's or prefab's `assets` header. */
  | { op: "useAssets"; add?: AssetId[]; remove?: AssetId[] }
  /** Paints cells of a grid field; value 0 erases. At most 65,536 cells per op. */
  | { op: "paintCells"; ref: Ref; field: string; cells?: CellEdit[]; rects?: CellRect[] }
  /** Prefab docs only: sets or clears the variant base. */
  | { op: "setPrefabBase"; base: string | null }
  /** Prefab docs only: declares, replaces or (null) removes a parameter. */
  | { op: "exposeParam"; name: string; param: PrefabParam | null }
  /** Sets (or with null, clears) one parameter on an instance. */
  | { op: "setParam"; ref: string; name: string; value: unknown };
export const OP_NAMES = [
  "add",
  "addBulk",
  "update",
  "move",
  "place",
  "remove",
  "rename",
  "promote",
  "demote",
  "setScene",
  "setSettings",
  "reorder",
  "instantiate",
  "setGroup",
  "override",
  "revertOverride",
  "applyToPrefab",
  "unpack",
  "createPrefab",
  "definePrefab",
  "transform",
  "setZ",
  "useAssets",
  "paintCells",
  "setPrefabBase",
  "exposeParam",
  "setParam",
] as const;
/** `actor` is "human", "agent", or a named agent. */
export type OpBatch = { label?: string; base?: SceneHash; actor?: string; ops: SceneOp[] };
export type SceneChange =
  | { kind: "added"; ref: Ref; type: EntityTypeName }
  | { kind: "removed"; ref: Ref; type: EntityTypeName }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "modified"; ref: Ref; field: FieldPath; from: unknown; to: unknown }
  | { kind: "moved"; ref: Ref; by: Pt }
  /** A bulk entry with the same tag and centre and a new size. */
  | { kind: "resized"; ref: Ref; from: BulkEntry; to: BulkEntry }
  | {
      kind: "scene";
      field:
        | "name"
        | "bounds"
        | "v"
        | "game"
        | "assets"
        | `settings.${string}`
        | `groups.${string}`;
      from: unknown;
      to: unknown;
    };
export type ApplyResult =
  | {
      ok: true;
      def: SceneDefinition;
      hash: SceneHash;
      /** The library after the batch, when it changed a prefab. */
      prefabs?: PrefabLibrary;
      /** Ids of the prefabs the batch set or deleted. */
      prefabsChanged?: string[];
      inverse: OpBatch;
      touched: Ref[];
      created: string[];
      /** Start-of-batch refs that now go by another ref, or `null` when removed. */
      remap: Record<Ref, Ref | null>;
      diff: SceneChange[];
      issues: SceneIssue[];
    }
  | { ok: false; hash: SceneHash; failedAt: number; issue: SceneIssue };
export type ApplyOptions = {
  validate?: "structural" | "none";
  /** The prefabs instances name; prefab ops read and change it. */
  prefabs?: PrefabLibrary;
  /** The prefab the document is a view of (a prefab doc read as a scene), so an op that nests instances refuses a cycle through it. */
  prefab?: string;
  /** The project the scene belongs to: its issues judge asset ids and sprite frames, as `validateScene` does. */
  project?: import("../project/types").ProjectView;
};
