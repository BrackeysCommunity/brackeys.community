export const SCENE_FORMAT_VERSION = 1;

export type Pt = [x: number, y: number];
export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];
/** 16 lowercase hex characters over the canonical text. */
export type SceneHash = string;
/** An entity id, or a bulk reference `~<bulkKey>:<index>`, e.g. `~solid:ice:3`. */
export type Ref = string;
/** A dot path into an entity: `shape`, `path.speed`, `path.pts.1`. */
export type FieldPath = string;

export const BEHAVIORS = [
  "solid",
  "cloud",
  "mover",
  "anchor",
  "sensor",
  "prop",
  "construct",
  "note",
] as const;
export type Behavior = (typeof BEHAVIORS)[number];
export const MATERIALS = ["ice", "chocolate", "trampoline"] as const;
export type Material = (typeof MATERIALS)[number];
export const SENSOR_KINDS = ["goal", "exit", "hazard"] as const;
export type SensorKind = (typeof SENSOR_KINDS)[number];
export const CONSTRUCT_TYPES = [
  "bridge",
  "bounce_pad",
  "wind_zone",
  "grapple_anchor",
  "light_orb",
  "shield_barrier",
] as const;
export type SceneConstructType = (typeof CONSTRUCT_TYPES)[number];
export const LAYERS = ["terrain", "gameplay", "decor", "editor"] as const;
export type Layer = (typeof LAYERS)[number];
export const SHAPE_BULK_KEYS = [
  "solid",
  "solid:ice",
  "solid:chocolate",
  "solid:trampoline",
  "cloud",
] as const;
export type ShapeBulkKey = (typeof SHAPE_BULK_KEYS)[number];
export type BulkKey = ShapeBulkKey | "anchor";
export const BULK_KEYS: readonly BulkKey[] = [...SHAPE_BULK_KEYS, "anchor"];

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
type EntityBase = { id: string; name?: string; layer?: Layer; group?: string; off?: boolean };
export type SolidDef = EntityBase & { b: "solid"; shape: ShapeTuple; material?: Material };
export type CloudDef = EntityBase & { b: "cloud"; shape: ShapeTuple };
/** `shape` is local to the current path point, usually centred on 0, 0. */
export type MoverDef = EntityBase & {
  b: "mover";
  shape: ShapeTuple;
  path: PathDef;
  material?: Material;
};
export type AnchorDef = EntityBase & { b: "anchor"; at: Pt };
export type SensorDef = EntityBase & { b: "sensor"; kind: SensorKind; shape: ShapeTuple };
export type PropDef = EntityBase & {
  b: "prop";
  shape: ShapeTuple;
  density: number;
  restitution: number;
  friction?: number;
};
/** `rot` is integer degrees. */
export type ConstructDef = EntityBase & {
  b: "construct";
  type: SceneConstructType;
  at: Pt;
  rot?: number;
};
export type NoteDef = EntityBase & { b: "note"; at: Pt; text: string };
export type EntityDef =
  | SolidDef
  | CloudDef
  | MoverDef
  | AnchorDef
  | SensorDef
  | PropDef
  | ConstructDef
  | NoteDef;

export type SceneDefinition = {
  $schema?: string;
  v: number;
  name: string;
  bounds: Bounds;
  /** The player's feet. */
  spawn: Pt[];
  solid?: ShapeTuple[];
  "solid:ice"?: ShapeTuple[];
  "solid:chocolate"?: ShapeTuple[];
  "solid:trampoline"?: ShapeTuple[];
  cloud?: ShapeTuple[];
  anchor?: Pt[];
  entities?: EntityDef[];
};

// ─── What the runtime loads ──────────────────────────────
type RuntimeBase = { id: string };
export type RuntimeEntity =
  | (RuntimeBase & { b: "solid"; shape: ShapeObj; material?: Material })
  | (RuntimeBase & { b: "cloud"; shape: ShapeObj })
  | (RuntimeBase & { b: "mover"; shape: ShapeObj; path: PathDef; material?: Material })
  | (RuntimeBase & { b: "anchor"; at: Pt })
  | (RuntimeBase & { b: "sensor"; kind: SensorKind; shape: ShapeObj })
  | (RuntimeBase & {
      b: "prop";
      shape: ShapeObj;
      density: number;
      restitution: number;
      friction?: number;
    })
  | (RuntimeBase & { b: "construct"; type: SceneConstructType; at: Pt; rot: number });
export type RuntimeBehavior = RuntimeEntity["b"];
/** Spawn order: solid, cloud, sensor, prop, mover, anchor, construct. Within one, bulk first, then file order. */
export const SPAWN_ORDER: readonly RuntimeBehavior[] = [
  "solid",
  "cloud",
  "sensor",
  "prop",
  "mover",
  "anchor",
  "construct",
];
export type ExpandedScene = {
  name: string;
  bounds: Bounds;
  spawn: Pt[];
  entities: RuntimeEntity[];
};

// ─── Issues ──────────────────────────────────────────────
export type Severity = "error" | "warn" | "info";
export const ISSUE_CODE_LIST = [
  // format
  "schema",
  "unknown-key",
  "bad-shape",
  "bad-id",
  "version-newer",
  // structural
  "dup-id",
  "dangling-ref",
  "ref-type",
  "spawn-missing",
  "spawn-overlap",
  "poly-invalid",
  "chain-invalid",
  "path-invalid",
  "prefab-unknown",
  "path-degenerate",
  "non-integer",
  "out-of-bounds",
  "wind-rotation",
  "no-goal",
  "no-kill-plane",
  "hidden-layer",
  "unused-override",
  // ops
  "stale-base",
  "ref-not-found",
  "op-invalid",
  "id-taken",
] as const;
export type IssueCode = (typeof ISSUE_CODE_LIST)[number];
export type SceneIssue = {
  severity: Severity;
  code: IssueCode;
  /** One sentence; names ids, not indices. */
  message: string;
  /** JSON Pointer into the on-disk document, e.g. `/entities/3/path/pts/1`. */
  path?: string;
  line?: number;
  entityIds: string[];
  at?: Pt;
  expected?: string;
  got?: string;
  hint?: string;
  fix?: OpBatch;
};

// ─── Ops ─────────────────────────────────────────────────
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type WithShapeInput<T> = T extends { shape: ShapeTuple }
  ? Omit<T, "shape"> & { shape: ShapeInput }
  : T;
export type EntityInput = WithShapeInput<DistributiveOmit<EntityDef, "id">> & { id?: string };
export type SpotAnchor = "center" | "top" | "bottom" | "left" | "right";
export type SceneOp =
  | { op: "add"; entity: EntityInput; index?: number }
  | { op: "addBulk"; key: ShapeBulkKey; shapes: ShapeInput[]; index?: number }
  | { op: "addBulk"; key: "anchor"; points: Pt[]; index?: number }
  | { op: "update"; ref: Ref; set?: Record<FieldPath, unknown>; unset?: FieldPath[] }
  | { op: "move"; refs: Ref[]; by: Pt }
  | { op: "place"; ref: Ref; at: Pt; anchor?: SpotAnchor }
  | { op: "remove"; refs: Ref[] }
  | { op: "rename"; from: string; to: string }
  | { op: "promote"; ref: Ref; id: string }
  | { op: "demote"; id: string }
  | { op: "setSpawn"; index?: number; at: Pt }
  | { op: "removeSpawn"; index: number }
  | { op: "setScene"; set: { name?: string; bounds?: Bounds } };
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
  "setSpawn",
  "removeSpawn",
  "setScene",
] as const;
/** `actor` is "human", "agent", or a named agent. */
export type OpBatch = { label?: string; base?: SceneHash; actor?: string; ops: SceneOp[] };
export type SceneChange =
  | { kind: "added"; ref: Ref; behavior: Behavior | "spawn" }
  | { kind: "removed"; ref: Ref; behavior: Behavior | "spawn" }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "modified"; ref: Ref; field: FieldPath; from: unknown; to: unknown }
  | { kind: "moved"; ref: Ref; by: Pt }
  | { kind: "scene"; field: "name" | "bounds" | "spawn" | "v"; from: unknown; to: unknown };
export type ApplyResult =
  | {
      ok: true;
      def: SceneDefinition;
      hash: SceneHash;
      inverse: OpBatch;
      touched: Ref[];
      created: string[];
      /** Start-of-batch refs that now go by another ref, or `null` when removed. */
      remap: Record<Ref, Ref | null>;
      diff: SceneChange[];
      issues: SceneIssue[];
    }
  | { ok: false; hash: SceneHash; failedAt: number; issue: SceneIssue };
export type ApplyOptions = { validate?: "structural" | "none" };
