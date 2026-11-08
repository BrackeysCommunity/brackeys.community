import type { z } from "zod";

import type { SceneView } from "../context";
import type { EditorToolDef } from "../editor/tools";
import type { PhysicsWorld } from "../physics";
import type { AssetKindDef } from "../project/kinds";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import type {
  BulkForm,
  BulkKey,
  Bounds,
  EntityDef,
  EntityTypeName,
  ExpandedScene,
  IssueCodeInfo,
  PrefabLibrary,
  ResolvedSettings,
  RuntimeEntity,
  SceneDefinition,
  SceneIssue,
  SceneSettings,
  ShapeObj,
} from "../scene/types";
import type { AttachmentHub } from "../systems/attachments";
import type { ToolRouter } from "../tool-router";
import type { GameMode, InputAction, InputBinding, RapierModule, Vec2 } from "../types";

// ─── Primitives ──────────────────────────────────────────

/**
 * Entity types the engine always registers. A game type can name one as its
 * `base` to be spawned by the engine's system for it.
 */
export const PRIMITIVE_TYPES = ["solid", "sensor", "marker", "prop", "follower", "note"] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];
/** Primitives with a runtime system; `note` never loads. */
export type BasePrimitive = Exclude<PrimitiveType, "note">;

/** Collision groups the primitives use. A game adds its own beside them. */
export const ENGINE_COLLISION_GROUPS = ["static", "dynamic", "sensor"] as const;
export type EngineCollisionGroup = (typeof ENGINE_COLLISION_GROUPS)[number];

/** The registry id of a registry without a game. */
export const ENGINE_REGISTRY_ID = "engine";

// ─── Colliders ───────────────────────────────────────────

/** What the runtime knows about a collider it created. */
export type ColliderTag = {
  entityId: string;
  /** The registered type of the entity that owns it, or a game's own label (`avatar`). */
  type: string;
  material?: string;
  tags?: readonly string[];
  /** One-way: actors pass up through it and land on top. */
  oneWay?: boolean;
  /** The entity's own launch velocity on any contact; a material's is in `registry.materials`. */
  impulse?: Vec2;
  /** The entity whose body carries the collider when it isn't `entityId`'s own (an attached solid rides a follower). */
  carrier?: { entityId: string; type: string };
};

/** Per-world lookup from Rapier collider handle to the entity that owns it. */
export type ColliderTags = {
  set: (handle: number, tag: ColliderTag) => void;
  get: (handle: number) => ColliderTag | undefined;
  delete: (handle: number) => void;
  clear: () => void;
  readonly size: number;
  handlesOf: (entityId: string) => number[];
};

/** A fallback look until there is art (`50` Q13). Colors are 0xRRGGBB. */
export type Style = {
  fill?: number;
  stroke?: number;
  alpha?: number;
  /** The stroke's own alpha; `alpha` when omitted. */
  strokeAlpha?: number;
  strokeWidth?: number;
};

export type MaterialDef = {
  friction: number;
  restitution: number;
  /** Launch velocity on contact, px/s; y is down, so a bounce is negative y. */
  impulse?: Vec2;
  description: string;
  /** Wins over the entity type's style for a body of this material. */
  style?: Style;
};

// ─── Systems ─────────────────────────────────────────────

/**
 * One entity type's slice of a scene. A system owns the bodies, colliders,
 * tags and visuals it creates and never reads another system's geometry.
 */
export interface SceneSystem<E extends RuntimeEntity = RuntimeEntity> {
  spawn(e: E): void;
  /** Idempotent: an unknown id is a no-op. */
  despawn(id: string): void;
  clear(): void;
  /** Fast path for an edit; without it the runtime despawns and respawns. */
  update?(e: E, prev: E): void;
  /** Back to t = 0 without respawning. */
  reset?(): void;
  /**
   * Moves time-driven state on by `ms` before tick 0 (Play's `timeOffsetMs`),
   * exactly as stepping that long would, and places bodies there.
   */
  seek?(ms: number): void;
  /** Live entities, scene and runtime alike. */
  size(): number;
  /** Before the game's `beforeStep`, in spawn order. */
  beforeStep?(dtMs: number): void;
  /** After the physics step, in spawn order, before the game's `afterStep`. */
  afterStep?(dtMs: number): void;
}

/** Everything a scene system or a game's runtime hooks need, scoped to one runtime. */
export type EngineContext = {
  rapier: RapierModule;
  physics: PhysicsWorld;
  view: SceneView | null;
  tags: ColliderTags;
  registry: Registry;
  dev: boolean;
  bounds: Bounds;
  settings: ResolvedSettings;
  /** `settings.gravity` as a vector; the physics world uses the same value. */
  gravity: Vec2;
  /** The tick being simulated, counting from 0 after each load. */
  readonly tick: number;
  /** Raise an event in the current tick's `StepResult`. */
  emit: (event: Omit<StepEvent, "tick">) => void;
  /** The system that spawns `type`, for a game's hooks to drive. */
  system: <S extends SceneSystem = SceneSystem>(type: EntityTypeName) => S | undefined;
  /** Colliders riding another entity's body: what `attach` on solids and sensors goes through. */
  attachments: AttachmentHub;
  /**
   * What this load is playing: `null` for an edit world. With `at`, the game
   * spawns its actor there instead of at its own spawn; the runtime has already
   * cast it onto the first surface below.
   */
  readonly play: PlayStart | null;
  /** The project's data as of load; null for a run with no project (bare scene tests). Frozen for the run. */
  readonly project: ProjectRuntimeView | null;
};

/** The resolved start of a play world, as the game's `onLoad` reads it from `EngineContext.play`. */
export type PlayStart = {
  /** Where the centre of the game's `play.spawnShape` starts. */
  at?: Vec2;
  timeOffsetMs: number;
  /** The game's own options (`GamePlayDef.options`), already parsed. */
  game?: unknown;
};

export type SystemFactory<E extends RuntimeEntity = RuntimeEntity> = (
  ctx: EngineContext,
  type: RegisteredType,
) => SceneSystem<E>;

// ─── Entity types ────────────────────────────────────────

/** What a type's field schema may depend on: the registry's names. */
export type FieldEnv = {
  /** Registered material names, in registration order. */
  materials: readonly string[];
  /** The registered materials themselves, for descriptions. */
  materialDefs: ReadonlyMap<string, MaterialDef>;
  /** Registered type names, in registration order. */
  types: readonly string[];
};

export type EntityTypeDef<F extends z.ZodRawShape = z.ZodRawShape> = {
  type: EntityTypeName;
  /** One sentence for the JSON Schema, `codes`, `show` and the inspector. */
  description: string;
  /**
   * The type's own fields. `id`, `type`, `name`, `layer`, `group` and `off`
   * are added by the engine. Written as a function when a field depends on
   * the registry (a material enum).
   */
  fields: F | ((env: FieldEnv) => F);
  /** The primitive whose engine system spawns this type; the fields must include the primitive's. */
  base?: BasePrimitive;
  /** Required unless `base` is set or `loads` is false. */
  system?: SystemFactory;
  /** False for editor-only types (notes): kept on disk, dropped by `expandScene`. */
  loads?: boolean;
  /**
   * An id-less top-level array under the type's name. `shape` entries fill
   * the `shape` field and `point` entries the `at` field; with `materials`,
   * `<type>:<material>` keys exist for every registered material.
   */
  bulk?: { form: BulkForm; materials?: boolean; description: string };
  /** Fields that name other entities, and the types they may name. */
  refs?: { field: string; targets: readonly EntityTypeName[] }[];
  style?: Style;
  /** One character for the scene's ASCII map; omitted, the base primitive's, else the type's first letter. */
  ascii?: string;
  inspector?: { label?: string; group?: string; order?: readonly string[] };
};

export type RegisteredType = EntityTypeDef & {
  /** `engine` for primitives, else the game's id. */
  origin: string;
  /** The type's fields resolved against this registry. */
  shape: z.ZodRawShape;
};

export type BulkKeyInfo = {
  key: BulkKey;
  type: EntityTypeName;
  form: BulkForm;
  /** `shape` or `at`. */
  field: "shape" | "at";
  material?: string;
};

// ─── Validation ──────────────────────────────────────────

export type IssueCodeDef = IssueCodeInfo;

/** A game's structural check, run after the engine's on a schema-valid scene. */
export type SceneValidator = (
  def: SceneDefinition,
  env: { registry: Registry; lines?: ReadonlyMap<string, number> },
) => SceneIssue[];

// ─── Editor extension points ─────────────────────────────

/** The engine's own editor tools; a game's tools can't reuse these ids. */
export const ENGINE_TOOL_IDS = [
  "select",
  "pan",
  "box",
  "circle",
  "pen",
  "waypoints",
  "rotate",
] as const;
export type EngineToolId = (typeof ENGINE_TOOL_IDS)[number];

/**
 * How the inspector draws a field a game marks with `.meta({ widget: id })`.
 * The engine only describes the widget and the site renders it, so a game
 * never ships UI code (React stays in the site).
 */
export type InspectorWidgetDef =
  | { kind: "slider"; min: number; max: number; step?: number; unit?: string }
  | {
      kind: "choice";
      options: readonly { value: string | number; label: string; description?: string }[];
    }
  | { kind: "color" }
  /** Shown, not edited: computed or runtime-owned values. */
  | { kind: "readonly"; format?: "text" | "json" };

/** A game's additions to the editor. */
export type GameEditorDef = {
  /**
   * Tools beside the engine's, loaded only when an editor opens (a dynamic
   * `import()`), so editor code never reaches a game's play bundle. A tool
   * is picked by an edit-scope `editorKeys` binding whose command is
   * `tool:<id>`, or by a host button.
   */
  tools?: () => Promise<readonly EditorToolDef[]>;
  /** Widgets by id, as fields name them in `meta.widget`. */
  widgets?: Readonly<Record<string, InspectorWidgetDef>>;
};

// ─── Physical validation and checks ──────────────────────

/** A collider found by a physical query. */
export type PhysicalHit = {
  tag: ColliderTag;
  /** The contact or impact point, world px. */
  at: Vec2;
};

/**
 * What a physical check sees: the scene loaded into a world that is never
 * stepped (the editor's edit world, or a headless one for `validate
 * --physical`), with shape queries over it.
 */
export type PhysicalEnv = {
  def: SceneDefinition;
  scene: ExpandedScene;
  registry: Registry;
  rapier: RapierModule;
  physics: PhysicsWorld;
  tags: ColliderTags;
  /** Colliders overlapping `shape` (world coordinates); sensors only with `sensors: true`. */
  overlaps(
    shape: ShapeObj,
    opts?: { sensors?: boolean; exclude?: readonly string[] },
  ): PhysicalHit[];
  /** The first collider `shape` hits when swept by `by`; sensors never count. */
  cast(
    shape: ShapeObj,
    by: Vec2,
    opts?: { exclude?: readonly string[] },
  ): (PhysicalHit & { toi: number }) | null;
};

/** A check that needs the physics world (`spawn-in-solid`); issue codes are the game's own. */
export type PhysicalCheck = {
  id: string;
  description: string;
  run(env: PhysicalEnv): SceneIssue[];
};

/** Check kinds the engine runs itself; a game's are `<game-id>/<kind>`. */
export const ENGINE_CHECK_KINDS = ["valid", "reaches", "touches"] as const;
export type EngineCheckKind = (typeof ENGINE_CHECK_KINDS)[number];

/** What a `.checks.json` check runs against. */
export type CheckEnv = {
  def: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  registry: Registry;
  rapier: RapierModule;
  /** Reads a file a check names (an input script), relative to the checks file. */
  readFile(path: string): string;
};

/** A check's outcome: pass or fail, in a sentence, with what it measured. */
export type CheckVerdict = { pass: boolean; message: string; detail?: unknown };

/** A check kind a game adds to `.checks.json` (the platformer's `beatable`). */
export type CheckKindDef<A = unknown> = {
  description: string;
  /** The check's own fields beside `id`, `kind` and `skip`. */
  arg: z.ZodType<A>;
  run(arg: A, env: CheckEnv): CheckVerdict;
};

// ─── Games ───────────────────────────────────────────────

export type ActionDef = InputBinding & { description: string };

/** What a new scene starts with: everything but its header (`$schema`, `v`, `game`, `name`). */
export type SceneTemplate = {
  bounds: Bounds;
  settings?: SceneSettings;
  entities?: EntityDef[];
  [bulkKey: BulkKey]: unknown;
};

/** A game's per-runtime state and hooks, created once per runtime. */
export type GameRuntime<S = unknown> = {
  /** After every entity spawned, before the first step; spawn actors here. */
  onLoad?(scene: ExpandedScene): void;
  /** Before `onLoad` of the next scene, and on destroy. Remove what `onLoad` made. */
  onUnload?(): void;
  /** After the systems' `beforeStep`, before the physics step. */
  beforeStep?(dtMs: number, actions: InputAction[]): void;
  /** After the systems' `afterStep`; `events` holds this tick's events so far. */
  afterStep?(dtMs: number, events: readonly StepEvent[]): void;
  /** What `StepResult.game` and `ProbeReport.final` carry; plain JSON. */
  snapshot(): S;
  /** Where the shell's camera follows; `null` keeps it still. */
  cameraTarget?(): Vec2 | null;
  /** The game's slice of the shell's store, read once per tick. Return the same object when nothing changed. */
  storeSlice?(): unknown;
  /** What the game's debug layers read each tick. */
  debugInfo?(): unknown;
  destroy?(): void;
};

// ─── Play and playtests ──────────────────────────────────

/**
 * Run results the engine decides itself; a game declares the rest in
 * `play.results`. `quit` is a browser run stopped before any outcome.
 */
export const ENGINE_RUN_RESULTS = ["timeout", "script-end", "stuck", "quit"] as const;
export type EngineRunResult = (typeof ENGINE_RUN_RESULTS)[number];
/** How a run ended: an engine result, or one the game declares (`won`, `died`). */
export type RunResult = EngineRunResult | (string & {});

/** `until` predicates the engine provides; a game's predicates can't take these names. */
export const ENGINE_PREDICATES = ["event", "tick"] as const;

/** What a game's outcome hook and script predicates see after each tick. */
export type PlayState<S = unknown> = {
  /** The tick just simulated, from 0. */
  tick: number;
  snapshot: S;
  /** This tick's events only; a game that needs history keeps it in its runtime and snapshot. */
  events: readonly StepEvent[];
};

/** A game's verdict: one of its declared `results`, with what caused it. */
export type GameOutcome = { result: string; cause?: string; entityId?: string };

/** A game's `until` predicate for input scripts, e.g. `{ "grounded": true }`. */
export type ScriptPredicate<S = unknown> = {
  description: string;
  /** The value the predicate takes in a script; its JSON Schema goes into the game's input-script schema. */
  arg: z.ZodType;
  /** `arg` has already been parsed by `arg`. */
  test(arg: unknown, state: PlayState<S>): boolean;
};

/** The actor's shape centred on its position; "play from here" casts it down onto the first surface. */
export type SpawnShape =
  | { type: "box"; hw: number; hh: number }
  | { type: "circle"; r: number }
  | { type: "capsule"; halfLen: number; r: number };

/** The slice of the seeded generator (`@jams/engine/sim-kit`'s `Rng`) a macro generator draws from. */
export type MacroRandom = {
  /** A uniform integer in `[0, bound)`. */
  below(bound: number): number;
  /** A uniform integer in `[lo, hi]`. */
  range(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
};

/** One fuzz macro: actions held together for `ticks` ticks (an empty `hold` waits). */
export type Macro = { hold: readonly string[]; ticks: number };

/** How a game plays: what Play, `runPlaytest` and `fuzz` ask it. Every hook is optional. */
export type GamePlayDef<S = unknown, G = unknown> = {
  /** Cast down from the cursor for "play from here"; without it `at` is used as given. */
  spawnShape?: SpawnShape;
  /** The position trails, stuck detection and fuzz follow; `null` while there is none. */
  focus?(snapshot: S): Vec2 | null;
  /** Actions that move the focus: holding one with under 4px of displacement over 120 ticks is `stuck`. */
  movementActions?: readonly string[];
  /** Results `outcome` may return; they can't reuse `ENGINE_RUN_RESULTS`. */
  results?: readonly string[];
  /** Called after every tick; a non-null result ends the run with it. The engine never decides one. */
  outcome?(state: PlayState<S>): GameOutcome | null;
  /** `until` predicates beside the engine's `event` and `tick`. */
  predicates?: Readonly<Record<string, ScriptPredicate<S>>>;
  /** The next fuzz macro; omitted, fuzz holds one or two random actions for 4–60 ticks. */
  macro?(rng: MacroRandom, actions: readonly string[]): Macro;
  /** The schema of `PlayOptions.game` (abilities and the like) and of an input script's `game` key. */
  options?: z.ZodType<G>;
  /** Event types a recording keeps as markers for the ghost; omitted, it keeps every event. */
  markers?: readonly string[];
};

/**
 * A key the game binds in the editor's keymap (a palette of the game's own
 * tools). `key` is a chord: optional `Shift+`, `Alt+` and `Mod+` (Ctrl or
 * Cmd) prefixes, in that order, then a `KeyboardEvent.key` (single
 * characters lowercase): `"1"`, `"Tab"`, `"Mod+g"`. An engine binding in the
 * same scope wins and the game's is reported as shadowed.
 */
export type GameKeyBinding = {
  key: string;
  scope: "edit" | "play";
  /** Delivered to `GameAttachment.onCommand`. */
  command: string;
  description: string;
};

/** The parts of the browser shell a game attaches its play-mode tools to. */
export type GameShell = {
  /** The current scene's view, the one the runtime's systems draw into. */
  view: SceneView;
  /** Play-mode tools register here as `TOOL_PRIORITY.game` consumers. */
  router: ToolRouter;
  dev: boolean;
  getMode: () => GameMode;
};

export type GameAttachment = {
  /** Each shell tick in play mode, before the runtime steps. */
  onTick?(dtMs: number, mouseWorld: Vec2): void;
  onModeChange?(mode: GameMode): void;
  /** A command from the game's `editorKeys` (or a host button); false when it didn't apply. */
  onCommand?(command: string): boolean;
  /** Escape in play mode: true when the game had something of its own to cancel, so play goes on. */
  onCancel?(): boolean;
  destroy(): void;
};

/** A data table a game declares: what a row of that table holds beside its `id`. */
export type GameTableDef = { description: string; row: z.ZodRawShape };

export type GameDefinition<S = unknown, G = unknown> = {
  /** Matches the id pattern; `engine` is reserved. Prefixes the game's issue codes. */
  id: string;
  /** The game's entity types. Primitives are always present and can't be redefined. */
  types: readonly EntityTypeDef[];
  /**
   * Spawn groups in order; types inside one group spawn together in file
   * order (bulk first). Lists every loadable type once. Omitted means each
   * primitive, then each game type, in registration order.
   */
  spawnOrder?: readonly (EntityTypeName | readonly EntityTypeName[])[];
  /** Action names and default bindings, in the order tools list them. */
  actions: readonly ActionDef[];
  /** Fields the game adds to the scene's `settings`; must not redefine `gravity`. */
  settings?: z.ZodRawShape;
  /**
   * The fields of a prefab's `contract`: what the game promises about a
   * prefab (entry and exit surfaces, required abilities, a proof run).
   * Without them a prefab can't carry a contract.
   */
  prefabContract?: z.ZodRawShape;
  materials?: Readonly<Record<string, MaterialDef>>;
  /**
   * Groups beside the engine's, or more interactions for an engine group
   * (`dynamic: { collidesWith: ["sensor"] }`). Interaction is symmetric, so
   * one side listing the other is enough.
   */
  collisionGroups?: Readonly<Record<string, { collidesWith: readonly string[] }>>;
  /** Keys are `<id>/<code>`. */
  issues?: Readonly<Record<string, IssueCodeDef>>;
  validators?: readonly SceneValidator[];
  /** What a new scene of this game starts with; it should validate without errors. */
  template?: SceneTemplate;
  /** Hashes the game's tuning into `ProbeReport.configHash`. */
  configHash?: string;
  createRuntime(ctx: EngineContext): GameRuntime<S>;
  /** Play, playtest and fuzz hooks: outcome, focus, predicates, macros, spawn shape. */
  play?: GamePlayDef<S, G>;
  /** Keys the game adds to the editor's keymap; engine bindings win. */
  editorKeys?: readonly GameKeyBinding[];
  /** Play-mode tools in the browser shell, attached after each load. */
  attach?(shell: GameShell, runtime: SceneRuntimeHandle): GameAttachment;
  /** Edit-mode tools and inspector widgets. */
  editor?: GameEditorDef;
  /** Checks that need the physics world, run after the engine's by `validatePhysical`. */
  physicalChecks?: readonly PhysicalCheck[];
  /** `.checks.json` kinds, keyed `<id>/<kind>`. */
  checks?: Readonly<Record<string, CheckKindDef>>;
  /** The game's own asset kinds; names are `<gameId>/<name>`, layouts declarative only. */
  assetKinds?: readonly AssetKindDef[];
  /** Data-table schemas by table name. */
  tables?: Readonly<Record<string, GameTableDef>>;
  /** Fields the game adds to the project's game-settings doc. */
  projectSettings?: z.ZodRawShape;
};

// ─── Registry ────────────────────────────────────────────

/** Primitives plus one game's types, materials, actions, groups and codes. */
export type Registry = {
  /** The game's id, or `engine` without one. */
  id: string;
  game: GameDefinition | null;
  /** Primitives first, then the game's types, in registration order. */
  types: ReadonlyMap<EntityTypeName, RegisteredType>;
  typeNames: readonly EntityTypeName[];
  spawnGroups: readonly (readonly EntityTypeName[])[];
  /** The index into `spawnGroups` of a loadable type; undefined for one that never loads. */
  spawnGroupOf: (type: EntityTypeName) => number | undefined;
  /** Every bulk key, in spawn order, a type's plain key before its material keys. */
  bulkKeys: readonly BulkKeyInfo[];
  bulkKey: (key: BulkKey) => BulkKeyInfo | undefined;
  materials: ReadonlyMap<string, MaterialDef>;
  materialNames: readonly string[];
  actions: readonly ActionDef[];
  actionNames: readonly string[];
  /** Packed Rapier `InteractionGroups` for a group name; throws on an unknown one. */
  collisionGroups: (name: string) => number;
  collisionGroupNames: readonly string[];
  /** The engine's codes, then the game's. */
  issueCodes: Readonly<Record<string, IssueCodeInfo>>;
  validators: readonly SceneValidator[];
  /** The engine's settings fields plus the game's. */
  settings: z.ZodRawShape;
  /** The game's `prefabContract` fields; empty without a game or one that declares none. */
  prefabContract: z.ZodRawShape;
  /** `ENGINE_RUN_RESULTS`, then the game's `play.results`. */
  runResults: readonly string[];
  /** `ENGINE_PREDICATES`, then the game's `play.predicates` keys. */
  predicateNames: readonly string[];
  /** `ENGINE_CHECK_KINDS`, then the game's `checks` keys. */
  checkKinds: readonly string[];
  /** The game's physical checks; the engine's own run first and aren't listed. */
  physicalChecks: readonly PhysicalCheck[];
  /** The game's inspector widgets by id. */
  widgets: ReadonlyMap<string, InspectorWidgetDef>;
  /** The primitives-only registry: itself without a game, else built once beside it. */
  primitives: Registry;
  /** `urn:jams-engine:scene:v1`, or `urn:jams-engine:scene:<game>:v1`. */
  schemaId: string;
};
