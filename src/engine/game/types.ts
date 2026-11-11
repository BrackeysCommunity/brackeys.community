import type { z } from "zod";

import type { BlendMode, SceneView } from "../context";
import type { AssetDrop } from "../editor/asset-drop";
import type { EditorToolDef } from "../editor/tools";
import type { InputState } from "../input/state";
import type { PhysicsWorld } from "../physics";
import type { AssetKindDef } from "../project/kinds";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, AssetKindName } from "../project/types";
import type { ResolutionPolicy } from "../resolution";
import type { GeometryWorld } from "../runtime/geometry-world";
import type { RuntimeGrid } from "../runtime/grid";
import type { RuntimeNav } from "../runtime/nav";
import type { PoseIndex } from "../runtime/poses";
import type { SpaceQuery } from "../runtime/space";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import type { AnalogSet, ScriptPointer } from "../scene/input-script";
import type { SceneLayerDef } from "../scene/layers";
import type {
  Aabb,
  BulkForm,
  BulkKey,
  Bounds,
  EntityDef,
  EntityTypeName,
  EntityInput,
  ExpandedScene,
  GridSettings,
  InstanceInput,
  IssueCodeInfo,
  OverridePath,
  PrefabLibrary,
  Pt,
  ResolvedSettings,
  RuntimeEntity,
  SceneDefinition,
  SceneIssue,
  SceneSettings,
  ShapeObj,
} from "../scene/types";
import type { Rng } from "../sim-kit/rng";
import type { AttachmentHub } from "../systems/attachments";
import type { ToolRouter } from "../tool-router";
import type { GameMode, InputAction, InputBinding, RapierModule, Vec2 } from "../types";
import type {
  BehaviorBlock,
  BehaviorDef,
  BehaviorName,
  BehaviorSystem,
  RegisteredBehavior,
} from "./behaviors";
import type { PadAxis, PadButton, PointerButton } from "./input-codes";
import type { ResolvedTime, TimeModel } from "./time";

export type { ResolvedTime, RuntimeGrid, RuntimeNav };

// ─── Primitives ──────────────────────────────────────────

/**
 * Entity types the engine always registers. A game type can name one as its
 * `base` to be spawned by the engine's system for it.
 */
export const PRIMITIVE_TYPES = [
  "solid",
  "sensor",
  "marker",
  "prop",
  "follower",
  "decor",
  "nav",
  "note",
] as const;
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
  /** The side actors land on, set with `oneWay: true`. */
  oneWaySide?: Side;
  /** The entity's own launch velocity on any contact; a material's is in `registry.materials`. */
  impulse?: Vec2;
  /** The entity whose body carries the collider when it isn't `entityId`'s own (an attached solid rides a follower). */
  carrier?: { entityId: string; type: string };
};

/** A side of an entity; it turns and flips with instance transforms. */
export type Side = "up" | "down" | "left" | "right";

/** Per-world lookup from collider handle (Rapier's or the geometry world's) to the entity that owns it. */
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
  /** Launch velocity on contact, m/s; y is down, so a bounce is negative y. */
  impulse?: Vec2;
  description: string;
  /** Wins over the entity type's style for a body of this material. */
  style?: Style;
  /** A sprite's tint when its block sets none, 0xRRGGBB. */
  tint?: number;
  /** A sprite's blend mode when its block sets none. */
  blend?: BlendMode;
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
  /**
   * After a load's or a spawn's entities of this type spawned and their
   * behaviors attached; ids in spawn order.
   */
  ready?(ids: readonly string[]): void;
  /**
   * Stop simulating `id`: colliders out of queries, visuals hidden, state
   * kept. Without it the runtime despawns the entity and keeps its record.
   */
  disable?(id: string): void;
  /** Simulate `id` again. Without it the runtime spawns it again from its record, state reset. */
  enable?(id: string): void;
}

/** Everything a scene system or a game's runtime hooks need, scoped to one runtime. */
export type EngineContext = {
  /** Null while the loaded scene runs without physics; `physicsOf` reads both or throws. */
  rapier: RapierModule | null;
  physics: PhysicsWorld | null;
  /** The engine's own colliders while the loaded scene has no physics; null under Rapier. */
  geometry: GeometryWorld | null;
  /** Point, shape, ray and sweep queries over whichever backend is loaded. */
  space: SpaceQuery;
  /** The run's clock; the same for every load of one runtime. */
  readonly time: ResolvedTime;
  /** Present when the loaded scene's resolved settings have a grid. */
  readonly grid: RuntimeGrid | null;
  /** Present when the loaded scene has walk areas. */
  readonly nav: RuntimeNav | null;
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
  /**
   * Colliders riding another entity's body: what `attach` on solids and
   * sensors goes through. Throws `PhysicsRequiredError` when physics is null.
   */
  attachments: AttachmentHub;
  /**
   * What this load is playing: `null` for an edit world. With `at`, the game
   * spawns its actor there instead of at its own spawn; the runtime has already
   * cast it along its `spawnShape`'s `cast` onto the first surface it meets.
   */
  readonly play: PlayStart | null;
  /**
   * The project's data, a frozen view; null for a run with no project (bare
   * scene tests). `GameInstance.reloadAssets` (art hot reload in the editor)
   * can replace it with a new frozen view mid-run, so read `ctx.project` at
   * use rather than caching it.
   */
  readonly project: ProjectRuntimeView | null;
  /** Every loaded entity's pose, written by the system that moves it. */
  poses: PoseIndex;
  /** A behavior's runtime system, as `system(type)` gives a type's. */
  behavior: <S extends BehaviorSystem = BehaviorSystem>(name: BehaviorName) => S | undefined;
  /** Texture sampling for a sprite whose texture's import sets no `filter`. */
  readonly sampling: "linear" | "nearest";
  /**
   * Spawns one entity now, through its type's system, and returns it live:
   * posed, its behaviors attached and `ready` run. Throws an `EngineError`
   * (`spawn-id-invalid`, `unknown-type`, `schema`, `physics-required`)
   * after undoing what it did.
   */
  spawn: <E extends RuntimeEntity = RuntimeEntity>(input: SpawnInput) => E;
  /**
   * Destroys an entity, or every child of an instance id. Inside a step it
   * happens at the end of the tick, after the game's `afterStep`; outside
   * one, at once.
   */
  destroy: (id: string) => void;
  /**
   * Immediate. A disabled entity skips its systems, behaviors, contacts,
   * queries and owned timers, and keeps its state.
   */
  setEnabled: (id: string, enabled: boolean) => void;
  /** False for a disabled entity and for one that doesn't exist. */
  enabled: (id: string) => boolean;
  exists: (id: string) => boolean;
  /** A live entity, loaded or spawned. */
  get: (id: string) => RuntimeEntity | undefined;
  /** True while Play's `timeOffsetMs` is being sought before tick 0. */
  readonly seeking: boolean;
  /** Subscriptions to this runtime's step events, delivered at the tick's dispatch points. */
  events: EventBus;
  /**
   * Places a prefab now, as a load would: the instance id is
   * `<prefab>#<n>` (or `opts.id`), its children `<id>/<child>`. Throws an
   * `EngineError` (`prefab-not-spawnable`, `spawn-id-invalid`). A
   * `prefab-not-spawnable` error's `cause` says why: an issue (`prefab-unknown`,
   * `prefab-cycle`, `prefab-depth`) or an `EngineError` (`physics-required`,
   * `unknown-type`), each with its `code`.
   */
  instantiate: (prefab: AssetId, at: Pt | Vec2, opts?: InstantiateOptions) => InstantiateResult;
  /** Tick-counted timers and coroutines, reset at each load. */
  timers: Timers;
  /**
   * Seeded at each load from `PlayOptions.seed`, else from the game's and
   * the scene's names; `fork(label)` gives a system its own stream. Engine
   * systems and behaviors never draw from it.
   */
  random: Rng;
  /** Entities by type, tag, area, point and distance, read from poses and shapes. */
  query: EntityQuery;
  /** Contact starts and ends between watched entities, raised as step events. */
  contacts: Contacts;
  /** Each seat's actions and pointer this tick, derived from the tick's input, so a replay rebuilds it exactly. */
  input: InputState;
};

// ─── Lifecycle ───────────────────────────────────────────

/**
 * An entity to spawn, as it is written in a scene file (shape tuples,
 * behaviors, `z`, `layer`), its id optional.
 */
export type SpawnInput = {
  type: EntityTypeName;
  /** `<name>#<label>`, the label not all digits; omitted, the next `<type>#<n>`. */
  id?: string;
  [field: string]: unknown;
};

/**
 * A runtime refusal with an issue code: `spawn-id-invalid`,
 * `prefab-not-spawnable`, `physics-required`, `unknown-type`, `schema`. A
 * playtest that hits one ends blocked at stage `"run"` with its code.
 */
export class EngineError extends Error {
  readonly code: string;
  readonly entityId?: string;
  constructor(code: string, message: string, entityId?: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    if (entityId !== undefined) this.entityId = entityId;
  }
}

/** Options for `EngineContext.events.on` and `once`. */
export type EventSubscribeOptions = {
  /** Only events whose `entityId` or `other` is this id, or a child of this instance id. */
  entity?: string;
  /** The subscription ends when this entity is destroyed. */
  owner?: string;
};

export interface EventBus {
  /**
   * Handlers run at the tick's two dispatch points (after the timers, and
   * after the end-of-tick destroys), in subscription order per event and
   * raise order across events. Returns the unsubscribe. Subscriptions end
   * at unload, so subscribe in `onLoad` or later.
   */
  on(type: string, handler: (e: StepEvent) => void, opts?: EventSubscribeOptions): () => void;
  /** As `on`, for the first matching event only. */
  once(type: string, handler: (e: StepEvent) => void, opts?: EventSubscribeOptions): () => void;
}

export type InstantiateOptions = {
  rot?: 0 | 1 | 2 | 3;
  flip?: boolean;
  z?: number;
  layer?: string;
  params?: Readonly<Record<string, unknown>>;
  overrides?: Readonly<Record<OverridePath, unknown>>;
  /** `<prefab>#<label>`; omitted, the next `<prefab>#<n>`. */
  id?: string;
};

/** The instance id and its children's ids, in spawn order. */
export type InstantiateResult = { id: string; entities: readonly string[] };

// ─── Timers ──────────────────────────────────────────────

/** Ticks, or milliseconds rounded to ticks once, at creation, with the run's tick rate. */
export type Delay = number | { ms: number };

/**
 * What a timer does when it falls due: a function, or an event it raises.
 * Only the event form can be saved with a snapshot.
 */
export type TimerAction = (() => void) | { emit: string; entityId?: string; data?: unknown };

/** What a coroutine yields: a delay to wait, or a predicate to wait on (checked each tick). */
export type CoroutineYield = Delay | (() => boolean);

export interface Timers {
  /** Runs `action` once after `delay`; returns the timer's id. */
  after(delay: Delay, action: TimerAction, opts?: { owner?: string }): number;
  /** Runs `action` every `period`, `times` times when given. */
  every(period: Delay, action: TimerAction, opts?: { owner?: string; times?: number }): number;
  /** Runs `co` from the next timer phase; a yielded delay waits, a yielded predicate waits until it holds. */
  start(co: () => Generator<CoroutineYield, void, void>, opts?: { owner?: string }): number;
  cancel(id: number): void;
  /** Timers and coroutines pending. */
  readonly size: number;
}

// ─── Queries and contacts ────────────────────────────────

export type EntitySelector = {
  type?: EntityTypeName | readonly EntityTypeName[];
  /** A value of the entity's `tagsField` fields. */
  tag?: string;
  /** Default true: only enabled entities. */
  enabled?: boolean;
};

export interface EntityQuery {
  /** In spawn order: load order, then spawns appended. */
  select(sel?: EntitySelector): readonly string[];
  byType(type: EntityTypeName): readonly string[];
  byTag(tag: string): readonly string[];
  count(sel?: EntitySelector): number;
  /** Entities whose world extent intersects `area`. */
  inArea(area: ShapeObj | Aabb, sel?: EntitySelector): readonly string[];
  at(p: Vec2, sel?: EntitySelector): readonly string[];
  /** Closest by extent; ties go to the earlier spawn. */
  nearest(p: Vec2, sel?: EntitySelector & { maxDist?: number }): string | undefined;
  /** The entity's shape moved by its pose's change since it spawned, or a point at its pose when it has no shape. */
  extent(id: string): ShapeObj | undefined;
}

/** An entity id, or every entity of a type or with a tag. */
export type ContactSelector = string | { type?: EntityTypeName; tag?: string };

export interface Contacts {
  /**
   * Raises `contact:start` and `contact:end` between `a` and `b` (anything
   * that isn't a sensor when omitted); returns the unwatch.
   */
  watch(a: ContactSelector, b?: ContactSelector): () => void;
}

/** Disabled entities handed out again before new ones spawn. */
export type Pool = {
  /** A free (disabled) entity, enabled; or a new one from `spawn` when none is free and `max` allows. */
  acquire(): string | null;
  /** Disables it and marks it free. */
  release(id: string): void;
  readonly free: number;
  readonly live: number;
};

/** The resolved start of a play world, as the game's `onLoad` reads it from `EngineContext.play`. */
export type PlayStart = {
  /** Where the centre of the game's `play.spawnShape` starts, already cast along its `cast` (not at all with zero gravity, `"none"` or a zero vector). */
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
  /** Live asset ids of these kinds in the project, for JSON Schema enums; empty without a project. */
  assets: (kinds: readonly AssetKindName[]) => readonly AssetId[];
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
   * Loads and spawns, but can't be placed in a scene: absent from the scene
   * schema, and `unknown-type` in a file. Game code makes it with `ctx.spawn`.
   */
  spawnOnly?: true;
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
  /**
   * Every entity of the type is one-way on this side (`true` is "up"), with
   * or without a `oneWay` field. A side the entity names wins; its `true` or
   * `false` keeps the type's side, as the solid system judges it. Declare it
   * when the type's system makes it one-way, so the editor and renderers
   * draw the landing side.
   */
  oneWay?: true | Side;
  inspector?: { label?: string; group?: string; order?: readonly string[] };
  /** Whether the type can load in a scene with physics "none"; default its base primitive's, else "optional". */
  physics?: "required" | "optional";
  /** Which behaviors this type always has, defaults, and refuses. */
  behaviors?: {
    /** Always present; a missing block loads as these defaults ({} for the behavior's own). */
    required?: Readonly<Record<BehaviorName, Record<string, unknown>>>;
    /** Field defaults for an optional behavior when an entity of this type carries it. */
    defaults?: Readonly<Record<BehaviorName, Record<string, unknown>>>;
    /** Refused on this type; "all" allows only `required`. */
    forbidden?: readonly BehaviorName[] | "all";
  };
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
  /** What a dropped asset becomes in this game's scenes; null falls back to the engine's. */
  assetDrop?: (drop: AssetDrop) => EntityInput | InstanceInput | null;
};

// ─── Physical validation and checks ──────────────────────

/** A collider found by a physical query. */
export type PhysicalHit = {
  tag: ColliderTag;
  /** The contact or impact point, world metres. */
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
  /** Null in a scene without physics; `space` answers on either backend. */
  rapier: RapierModule | null;
  physics: PhysicsWorld | null;
  tags: ColliderTags;
  space: SpaceQuery;
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
  /** Skipped, with an info issue, in a scene without physics. */
  needsPhysics?: boolean;
  run(env: PhysicalEnv): SceneIssue[];
};

/** Check kinds the engine runs itself; a game's are `<game-id>/<kind>`. */
export const ENGINE_CHECK_KINDS = ["valid", "reaches", "touches", "connected"] as const;
export type EngineCheckKind = (typeof ENGINE_CHECK_KINDS)[number];

/** What a `.checks.json` check runs against. */
export type CheckEnv = {
  def: SceneDefinition;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
  registry: Registry;
  /** Null when the host loaded no Rapier (a scene without physics needs none). */
  rapier?: RapierModule | null;
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

// ─── Input ───────────────────────────────────────────────

/** A button is down or up; an axis is −1…1; a vector lies in the unit disc. */
export type ActionKind = "button" | "axis" | "vector";

/** One device input an action listens to. */
export type Binding =
  /** A key by `KeyboardEvent.code`; on an axis or vector action, `value` (default 1) is what it contributes on `axis` (vector: "x" or "y"). `player` drives that seat whoever owns the keyboard. */
  | { device: "key"; code: string; value?: number; axis?: "x" | "y"; player?: number }
  | { device: "pad"; button: PadButton; value?: number; axis?: "x" | "y" }
  /** A stick as a vector action. */
  | { device: "pad"; stick: "left" | "right" }
  /** One stick axis or trigger as an axis action; `scale` -1 inverts. */
  | { device: "pad"; axis: PadAxis | "lt" | "rt"; scale?: number }
  | { device: "pointer"; button: PointerButton }
  /** An on-screen control declared in the input map. */
  | { device: "touch"; control: string };

/** An input device, as seats own them. */
export type DeviceId = "keyboard" | "pointer" | "touch" | `pad:${number}`;

/** Input seats and how devices take them. */
export type PlayersDef = {
  /** Seats, 1–8; default 1. */
  max: number;
  /**
   * auto: seat 0 owns keyboard, pointer and touch, and pads take free seats
   * in connection order; press: a device's first press takes the lowest free
   * seat; host: `GameInstance.input.assign`.
   */
  join: "auto" | "press" | "host";
};

/** A seat and the devices it owns. */
export type PlayerInfo = { index: number; devices: readonly DeviceId[]; joined: boolean };

/** How a game reads its input (`GameDefinition.input`). */
export type GameInputDef = {
  /** Default `{ max: 1, join: "auto" }`: every device drives seat 0. */
  players?: PlayersDef;
  /** Record sub-tick offsets (rhythm games); default false. */
  subTick?: boolean;
  /** Radial stick deadzone, 0…1; default 0.15. */
  deadzone?: number;
};

export type ActionDef = InputBinding & {
  description: string;
  /** Default "button". */
  kind?: ActionKind;
  /** Resolved from devices and every binding layer, but never delivered to the simulation or written to a recording. */
  ui?: true;
};

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
  /** After the systems' `beforeStep`, before the physics step; `commands` are the ones queued for this tick. */
  beforeStep?(dtMs: number, actions: InputAction[], commands: readonly GameCommand[]): void;
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
  /** turns/event: keep stepping at `rate` after the tick an input woke. Ignored for fixed. */
  busy?(): boolean;
  destroy?(): void;
};

// ─── Commands ────────────────────────────────────────────

/** A discrete message to the game, delivered on the next simulated tick. */
export type GameCommand = {
  /** A name in GameDefinition.commands, or an engine command ("@elapsed"). */
  name: string;
  /** Plain JSON, checked by the command's `args` schema. */
  args?: unknown;
  /** The seat that sent it; 0 when absent. */
  player?: number;
};

export type CommandDef = {
  description: string;
  /** Validates `args`; omitted, the command takes none. */
  args?: z.ZodType;
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
export const ENGINE_PREDICATES = ["event", "tick", "exists", "count"] as const;

/** What a game's outcome hook and script predicates see after each tick. */
export type PlayState<S = unknown> = {
  /** The tick just simulated, from 0. */
  tick: number;
  snapshot: S;
  /** This tick's events only; a game that needs history keeps it in its runtime and snapshot. */
  events: readonly StepEvent[];
  /** The live world after the tick: whether an entity exists (and is enabled), and how many match. */
  world: PlayWorld;
};

/** What `PlayState.world` answers about the entities live after a tick. */
export type PlayWorld = {
  /** True while `id` exists and is enabled; with `enabled: false`, while it exists at all. */
  exists(id: string, opts?: { enabled?: boolean }): boolean;
  count(sel: EntitySelector): number;
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

/** The actor's shape centred on its position; "play from here" casts it along `cast` onto the first surface it meets, within the scene bounds. */
export type SpawnShape = (
  | { type: "box"; hw: number; hh: number }
  | { type: "circle"; r: number }
  | { type: "capsule"; halfLen: number; r: number }
) & {
  /** How "play from here" settles the start: along gravity (default), not at all, or along a direction. */
  cast?: "gravity" | "none" | Pt;
};

/** The slice of the seeded generator (`@jams/engine/sim-kit`'s `Rng`) a macro generator draws from. */
export type MacroRandom = {
  /** A uniform integer in `[0, bound)`. */
  below(bound: number): number;
  /** A uniform integer in `[lo, hi]`. */
  range(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
};

/** One fuzz macro: actions held together for `ticks` ticks (an empty `hold` waits). */
export type Macro = {
  hold: readonly string[];
  ticks: number;
  /** Axis and vector values held with it. */
  set?: AnalogSet;
  /** A pointer move, press or drag over the macro's ticks. */
  pointer?: ScriptPointer;
};

/** How a game plays: what Play, `runPlaytest` and `fuzz` ask it. Every hook is optional. */
export type GamePlayDef<S = unknown, G = unknown> = {
  /** Cast from the cursor along its `cast` for "play from here"; without it `at` is used as given. */
  spawnShape?: SpawnShape;
  /** The position trails, stuck detection and fuzz follow; `null` while there is none. */
  focus?(snapshot: S): Vec2 | null;
  /** Actions that move the focus: holding one with under 4px of displacement over 120 ticks is `stuck`. */
  movementActions?: readonly string[];
  /** Results `outcome` may return; they can't reuse `ENGINE_RUN_RESULTS`. */
  results?: readonly string[];
  /** Called after every tick; a non-null result ends the run with it. The engine never decides one. */
  outcome?(state: PlayState<S>): GameOutcome | null;
  /** `until` predicates beside the engine's `ENGINE_PREDICATES`. */
  predicates?: Readonly<Record<string, ScriptPredicate<S>>>;
  /**
   * The next fuzz macro; omitted, fuzz holds one or two random button actions
   * for 4–60 ticks, and sets the game's axis and vector actions and moves the
   * pointer when it has them (`defaultFuzzMacro`); with `commands` and no
   * macro, fuzz sends one legal command per macro instead (every macro on a
   * turns clock, half otherwise).
   */
  macro?(rng: MacroRandom, actions: readonly string[]): Macro;
  /** The schema of `PlayOptions.game` (abilities and the like) and of an input script's `game` key. */
  options?: z.ZodType<G>;
  /** Event types a recording keeps as markers for the ghost; omitted, every event but `entity:*`. */
  markers?: readonly string[];
  /**
   * The commands a run may send now, in a stable order. Fuzz picks among
   * them; `scene step --legal` prints them. Before a run's first tick (fuzz's
   * first macro, a playtest that ran none) `state.tick` is -1 and `events` is
   * empty.
   */
  commands?(state: PlayState<S>): readonly GameCommand[];
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
  /** Queues a command for the next simulated tick; false (and a dev warning) when not playing, unknown, or its args don't parse. */
  send: (command: GameCommand) => boolean;
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
   * order (bulk first). Lists each of the game's loadable types once; a
   * primitive it leaves out spawns before every listed group, in primitive
   * order, except `decor` and `nav`, which then spawn last. Omitted means
   * each primitive, then each game type, in registration order.
   */
  spawnOrder?: readonly (EntityTypeName | readonly EntityTypeName[])[];
  /** Action names and default bindings, in the order tools list them. */
  actions: readonly ActionDef[];
  /** Seats, sub-tick offsets and the stick deadzone. */
  input?: GameInputDef;
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
  /** How the game's clock runs; omitted: fixed at 60. */
  time?: TimeModel;
  /** The game's world defaults, under the project's and each scene's settings. */
  world?: GameWorldDef;
  /** Commands the game accepts beside the engine's; names match `COMMAND_NAME_PATTERN`. */
  commands?: Readonly<Record<string, CommandDef>>;
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
  /** The game's behaviors, after the engine's in registration order; names are `<id>/<name>`. */
  behaviors?: readonly BehaviorDef[];
  /** Scene layers, bottom to top; replaces the engine's four defaults when given. */
  layers?: readonly SceneLayerDef[];
  /** The game's resolution policy, under the project's and the host's. */
  resolution?: Partial<ResolutionPolicy>;
};

/** A game's world defaults (`GameDefinition.world`). */
export type GameWorldDef = {
  physics?: "rapier" | "none";
  /** m/s²; y is down. */
  gravity?: Pt;
  grid?: GridSettings;
  /** Cells covered by these types' shapes become grid walls at load; default ["solid"], [] for none. */
  gridWalls?: readonly EntityTypeName[];
  /** px per metre: world metres to the resolution's virtual px; the simulation is in metres; default 100. */
  lengthUnit?: number;
};

/** What a type allows, requires and defaults among the registry's behaviors. */
export type BehaviorRules = {
  allowed: readonly BehaviorName[];
  required: ReadonlyMap<BehaviorName, BehaviorBlock>;
  defaults: ReadonlyMap<BehaviorName, BehaviorBlock>;
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
  /** The actions marked `ui: true`, in registration order; `actionNames` lists them too. */
  uiActionNames: readonly string[];
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
  /** `ENGINE_COMMANDS`, then the game's `commands`. */
  commands: ReadonlyMap<string, CommandDef>;
  commandNames: readonly string[];
  /** The game's time model before project overrides, else the engine default. */
  time: TimeModel;
  /** `ENGINE_CHECK_KINDS`, then the game's `checks` keys. */
  checkKinds: readonly string[];
  /** The game's physical checks; the engine's own run first and aren't listed. */
  physicalChecks: readonly PhysicalCheck[];
  /** The game's inspector widgets by id. */
  widgets: ReadonlyMap<string, InspectorWidgetDef>;
  /** The engine's behaviors, then the game's. */
  behaviors: ReadonlyMap<BehaviorName, RegisteredBehavior>;
  /** Registration order: what attach, step and detach follow. */
  behaviorNames: readonly BehaviorName[];
  behaviorRules: (type: EntityTypeName) => BehaviorRules;
  /** Scene layers, bottom to top: the game's, or `DEFAULT_LAYERS`. */
  layers: readonly SceneLayerDef[];
  /** The primitives-only registry: itself without a game, else built once beside it. */
  primitives: Registry;
  /** `urn:jams-engine:scene:v<SCENE_FORMAT_VERSION>`, or `urn:jams-engine:scene:<game>:v<SCENE_FORMAT_VERSION>`. */
  schemaId: string;
};
