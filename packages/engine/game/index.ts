/**
 * @experimental The game-authoring API: define a game's entity types,
 * materials, actions and hooks, and write the systems that spawn them.
 */
export {
  createRegistry,
  defineEntityType,
  defineGame,
  RegistryError,
  withProject,
  type CreateRegistryOptions,
  type ProjectMaterialDef,
} from "./define";
export type { EntityOf } from "./define";
export {
  BEHAVIOR_NAME_PATTERN,
  defineBehavior,
  handleType,
  type BehaviorBlock,
  type BehaviorDef,
  type BehaviorName,
  type BehaviorSystem,
  type BehaviorSystemFactory,
  type BlockOf,
  type Bound,
  type HandleType,
  type RegisteredBehavior,
} from "./behaviors";
export type { BehaviorKey, Entity, HandleOf } from "./entity";
export {
  defineScript,
  Script,
  type ScriptClass,
  type ScriptDef,
  type ScriptHooks,
  type ScriptSelf,
} from "./script";
export {
  SPRITE,
  SPRITE_FALLBACK_SIZE,
  spriteGeometry,
  type FrameRect,
  type SpriteAssetInfo,
  type SpriteBlock,
  type SpriteGeometry,
  type SpriteHandle,
} from "./behaviors/sprite";
export { OCCUPANT, type OccupantBlock, type OccupantHandle } from "./behaviors/occupant";
export { LIFETIME, type LifetimeBlock, type LifetimeHandle } from "./behaviors/lifetime";
export {
  COLLIDER,
  type ColliderBlock,
  type ColliderHandle,
  type ColliderSystem,
} from "./behaviors/collider";
export { BODY, BODY_KINDS, type BodyBlock, type BodyHandle, type BodyKind } from "./behaviors/body";
export {
  PLAYER_INPUT,
  type PlayerInputBlock,
  type PlayerInputHandle,
} from "./behaviors/player-input";
export {
  CHARACTER_TOP_DOWN,
  type CharacterHandle,
  type CharacterIntent,
  type CharacterSystem,
  type CharacterTopDownBlock,
} from "./behaviors/character-top-down";
export { CHARACTER_SIDE_VIEW, type CharacterSideViewBlock } from "./behaviors/character-side-view";
export {
  CAMERA_TARGET,
  type CameraTargetBlock,
  type CameraTargetHandle,
} from "./behaviors/camera-target";
export { ANIM, type AnimBlock, type AnimHandle } from "./behaviors/anim";
export {
  EASE_NAMES,
  TWEEN,
  tweenSpecSchema,
  type EaseName,
  type TweenBlock,
  type TweenChannel,
  type TweenHandle,
  type TweenSpec,
} from "./behaviors/tween";
export { EMITTER, type EmitterBlock, type EmitterHandle } from "./behaviors/emitter";
export { ease } from "../anim/ease";
export { overlapFrameShapes } from "../anim/shapes";
export { clipFrameAt, resolveClips, type ClipSource, type ResolvedClip } from "../anim/clips";
export type { Tweens } from "../anim/tweens";
export { ANIM_END, ANIM_FRAME } from "../runtime/behaviors/anim";
export { TWEEN_END } from "../runtime/behaviors/tween";
export type { AnimContext, AnimState, AnimSystem } from "../runtime/behaviors/anim";
export type { TweenSystem, UnsaveableTween } from "../runtime/behaviors/tween";
export { CAMERA_RIG_SCHEMA, type CameraRigDef } from "./primitives";
export type { CameraFrame, CameraTargetSpec } from "../camera/rig";
export type {
  AudioRequest,
  BurstOptions,
  CameraRequest,
  EffectRequest,
  FlashOptions,
  PresentationQueue,
  PresentedRequest,
  PresentRequest,
} from "../runtime/present";
export {
  SPAWNER,
  type SpawnerBlock,
  type SpawnerHandle,
  type SpawnerSystem,
} from "./behaviors/spawner";
export {
  NAV_AGENT,
  type NavAgentBlock,
  type NavAgentHandle,
  type NavAgentSystem,
} from "./behaviors/nav-agent";
export {
  PATH_FOLLOW,
  type PathFollowBlock,
  type PathFollowHandle,
  type PathFollowSystem,
} from "./behaviors/path-follow";
export {
  FORCE_AREA,
  type ForceAreaBlock,
  type ForceAreaHandle,
  type ForceAreaSystem,
} from "./behaviors/force-area";
export {
  JOINT,
  JOINT_KINDS,
  type JointBlock,
  type JointHandle,
  type JointKind,
  type JointSystem,
} from "./behaviors/joint";
export { inputFor, type PlayerInputSystem, type SeatInput } from "./input-for";
export {
  isRuntimeId,
  parseRuntimeId,
  parseSublevelId,
  RUNTIME_ID_PATTERN,
  runtimeId,
  SUBLEVEL_ID_PATTERN,
  sublevelId,
} from "./runtime-ids";
export {
  flowIssue,
  type FlowRequest,
  type FlowUse,
  type LibraryScene,
  type SceneLibrary,
  type SceneListEntry,
  type SublevelInfo,
  type SublevelOptions,
  type SublevelResult,
  type TransitionSpec,
} from "./flow";
export {
  DEFAULT_SAVE_LIMITS,
  effectiveSaveLimits,
  formatSaveFile,
  GRID_STEP_SAVE_OWNER,
  MAX_BROWSER_SAVE_LIMITS,
  MOTION_SAVE_OWNER,
  parseSaveFile,
  SAVE_RANDOM_KEY,
  SAVE_SCHEMA_ID,
  SAVE_VERSION,
  saveFileBytes,
  saveFileSchema,
  SLOT_MAX_LENGTH,
  SLOT_PATTERN,
  SLOT_RULE,
  type ParseSaveResult,
  type SavedSystems,
  type SavedTimer,
  type SaveDepth,
  type SaveFile,
  type SaveGameData,
  type SaveLimits,
  type SaveLimitsStore,
  type SaveMeta,
  type WorldState,
} from "./save-file";
export {
  angleField,
  assetField,
  AssetIdSchema,
  assetKindsOf,
  BASE_FIELDS,
  BODY_SHAPE_TYPES,
  bodyShapeField,
  CHILD_REF_PATTERN,
  gridField,
  gridFieldInfo,
  ID_PATTERN,
  isPolygonField,
  materialField,
  mirrorField,
  PathSchema,
  pointField,
  polygonField,
  PtSchema,
  refField,
  shapeField,
  sideField,
  SIDES,
  tagsField,
  vectorField,
  type GridFieldInfo,
} from "./fields";
export { DEFAULT_LAYERS, type SceneLayerDef } from "../scene/layers";
export { primitiveFields } from "./primitives";
export {
  DEFAULT_ACTIONS,
  DEFAULT_GRAVITY,
  DEFAULT_LENGTH_UNIT,
  DEFAULT_PHYSICS,
  DEFAULT_SPAWN_CAST,
  DEFAULT_TICK_RATE,
  DEFAULT_TIME,
  SIDE_VIEW_CONTROLLER,
  TOP_DOWN_CONTROLLER,
} from "./defaults";
export {
  MAX_TICK_RATE,
  MIN_TICK_RATE,
  resolveTime,
  tickRateProblem,
  ticksFor,
  wholeTicksIn,
  type ResolvedTime,
  type TimeKind,
  type TimeModel,
} from "./time";
export { PhysicsRequiredError, physicsOf } from "./physics-of";
export { lengthUnitOf, pxPerMetreOf, scaleLengths } from "./units";
export {
  KEY_CODES,
  KEY_TO_CODE,
  PAD_AXES,
  PAD_BUTTONS,
  POINTER_BUTTONS,
  pointerBit,
  type PadAxis,
  type PadButton,
  type PointerButton,
} from "./input-codes";
export {
  ACTION_KINDS,
  bindingProblems,
  declaredBindings,
  isUiAction,
  keysProblems,
  playersProblems,
  type BindingContext,
  type BindingProblem,
} from "./input-bindings";
export { bindingKeyLabel, keycapLabel, pointerButtonLabel } from "../input/keycaps";
export type { InputState, PointerState } from "../input/state";
export {
  COMMAND_NAME_PATTERN,
  ENGINE_COMMANDS,
  NAV_COMMAND,
  type NavDestination,
} from "./commands";
export {
  ENGINE_CHECK_KINDS,
  ENGINE_COLLISION_GROUPS,
  ENGINE_PREDICATES,
  ENGINE_REGISTRY_ID,
  ENGINE_RUN_RESULTS,
  ENGINE_TOOL_IDS,
  EngineError,
  PRIMITIVE_TYPES,
  scopedRef,
} from "./types";
export type {
  ActionDef,
  ActionKind,
  BasePrimitive,
  Binding,
  BehaviorRules,
  BodyControl,
  BulkKeyInfo,
  CheckEnv,
  CheckKindDef,
  CheckVerdict,
  ColliderTag,
  CommandDef,
  ColliderTags,
  ContactSelector,
  Contacts,
  CoroutineYield,
  Delay,
  DeviceId,
  EngineCheckKind,
  EngineCollisionGroup,
  EngineContext,
  EngineRunResult,
  EntityTypeDef,
  FieldEnv,
  GameAttachment,
  GameCommand,
  GameDefinition,
  GameEditorDef,
  GameInputDef,
  GameKeyBinding,
  GameOutcome,
  GamePlayDef,
  GameRuntime,
  GameShell,
  GameTableDef,
  GameWorldDef,
  EngineToolId,
  FlowContext,
  GamePersistDef,
  GameSavesDef,
  JsonValue,
  LiveContext,
  PersistContext,
  SaveRequest,
  SavesContext,
  EntityQuery,
  EntitySelector,
  EventBus,
  EventSubscribeOptions,
  InspectorWidgetDef,
  InstantiateOptions,
  InstantiateResult,
  IssueCodeDef,
  Macro,
  MacroRandom,
  MaterialDef,
  PhysicalCheck,
  PhysicalEnv,
  PhysicalHit,
  PlayerInfo,
  PlayersDef,
  PlayStart,
  PlayState,
  PlayWorld,
  Pool,
  PrimitiveType,
  RegisteredType,
  Registry,
  RunResult,
  SceneSystem,
  SceneTree,
  ScriptPredicate,
  SceneTemplate,
  SceneValidator,
  Side,
  SpawnInput,
  SpawnShape,
  Style,
  SystemFactory,
  TimerAction,
  Timers,
} from "./types";
export {
  arrivalWords,
  capitalise,
  clampTiming,
  DEFAULT_SWAP_TIMING,
  LIVE_CHECK_AGAIN_TICKS,
  LIVE_DEFAULTS,
  releasePromoteMessage,
  releaseReplacesMessage,
  releaseRollbackMessage,
  sceneVersionName,
  SWAP_STRATEGY_WORDS,
  SWAP_TIMINGS,
  swapTimingSchema,
  versionName,
  type LiveDeclaration,
  type SceneDiff,
  type SceneSwap,
  type SwapSide,
  type SwapStrategy,
  type SwapTiming,
} from "./live";
export { createPool } from "../runtime/pool";
export type { AssetKindDef } from "../project/kinds";
export type { ProjectRuntimeView } from "../project/runtime-view";
export { composePose, relativePose } from "../runtime/poses";
export type { Pose, PoseIndex } from "../runtime/poses";
export { castSpawn, type CastResult, type CastSpawnOptions } from "../runtime/cast";
export { spawnPose } from "../runtime/spawn-pose";

// ─── System authoring ────────────────────────────────────
export { DRAW_LAYERS } from "../context";
export type { DrawLayer, SceneView, ViewLayer, ViewLayerHandle } from "../context";
export { createSensorCollider } from "../collisions";
export { degToRad, posedBodyDesc, shapeColliderDesc, shapePose } from "../physics";
export type { CharacterControllerOptions, PhysicsWorld } from "../physics";
export {
  advanceAlongPath,
  advanceWaypoint,
  initialWaypointState,
  interpolatePosition,
  pathPosition,
  pathWaypoints,
  readPathPlace,
  savePathPlace,
  seekAlongPath,
} from "../systems/path-follower";
export { carrierDelta, createFollowerSystem } from "../systems/path-follower";
export type { Attachment, AttachmentHub } from "../systems/attachments";
export type {
  FollowerOptions,
  FollowerSystem,
  PathPlace,
  WaypointMode,
  WaypointState,
} from "../systems/path-follower";
export { createDecorSystem } from "../systems/decor";
export type { DecorEntity } from "../systems/decor";
export { createDataSystem } from "../systems/data";
export type { DataSystem } from "../systems/data";
export { createMarkerSystem } from "../systems/marker";
export type { MarkerEntity, MarkerSystem } from "../systems/marker";
export { createNavSystem, isNavSystem } from "../systems/nav";
export type { NavEntity, NavPolygon, NavSystem } from "../systems/nav";
export {
  bodyLocalShape,
  createOverlapTracker,
  createPropSystem,
  createSensorSystem,
  createSolidSystem,
  drawEntity,
  forgetOneWayActor,
  moveBodyNow,
  oneWayPasses,
  restoreOverlaps,
  saveOverlaps,
  styleOf,
} from "../systems/bodies";
export type {
  OverlapTracker,
  Overlaps,
  OwnedBody,
  SensorSystem,
  SolidOptions,
  SolidSystem,
  VisualOptions,
} from "../systems/bodies";
export { kinematicBodyEntry, rapierBodyEntry, registerBody } from "../runtime/bodies-control";
export type { BodyEntry, BodyStandIn, KinematicMotion } from "../runtime/bodies-control";
export { parseShape } from "../scene/shapes";
export type { ParseShapeResult } from "../scene/shapes";
export { drawShape, traceShape } from "../render/draw-shape";
export { clamp, clampVec2, distanceVec2, lerp, lerpVec2, rotate } from "../math";
export type {
  LoadFailureReason,
  SceneRuntimeHandle,
  StepEvent,
  StepResult,
} from "../runtime/types";
export type { GeometryColliderDesc, GeometryWorld } from "../runtime/geometry-world";
export type { SpaceCastHit, SpaceFilter, SpaceHit, SpaceQuery } from "../runtime/space";
export { gridMissingIssue, gridPlace, gridRoute, sceneGrid } from "../runtime/grid";
export type { GridPlace, RuntimeGrid } from "../runtime/grid";
export type { GridSettings } from "../scene/types";
export type { RuntimeNav } from "../runtime/nav";

// ─── Grids, motion and navigation ────────────────────────
export {
  boundsCells,
  cellKey,
  cellOf,
  createOccupancy,
  fieldOfView,
  findPath,
  flowField,
  gridGeometry,
  inCellBounds,
  lineOfSight,
  sameCell,
  type Cell,
  type CellBounds,
  type CellKey,
  type FlowField,
  type GridGeometry,
  type GridPath,
  type GridPathOptions,
  type Occupancy,
} from "../grid/index";
export {
  createGridStepper,
  createMotionBody,
  createSideViewController,
  createTopDownController,
  type GridStepper,
  type MotionBody,
  type MotionBodyOptions,
  type MotionResult,
  type SideViewController,
  type SideViewEnv,
  type SideViewIntent,
  type SideViewOptions,
  type SideViewResult,
  type TopDownController,
  type TopDownOptions,
} from "../motion/index";
export {
  buildNavMesh,
  navContains,
  navNearest,
  navPath,
  type NavIssue,
  type NavMesh,
} from "../nav/index";
export {
  CONTACT_END,
  CHARACTER_JUMPED,
  CHARACTER_LANDED,
  CHARACTER_LEFT_GROUND,
  CONTACT_START,
  ENTITY_DESTROYED,
  ENTITY_DISABLED,
  ENTITY_ENABLED,
  ENTITY_SPAWNED,
  NAV_ARRIVED,
  NAV_BLOCKED,
  PLAYER_JOINED,
  PLAYER_LEFT,
  SENSOR_ENTER,
  SENSOR_EXIT,
  SPAWNER_SPAWNED,
} from "../runtime/types";
export {
  TOOL_PRIORITY,
  type PointerKind,
  type ToolConsumer,
  type ToolEvent,
  type ToolRouter,
} from "../tool-router";
export type { EditorToolDef } from "../editor/tools";
export {
  createPlacementTool,
  DEFAULT_ROTATE_STEP,
  type PlacementCheck,
  type PlacementDraw,
  type PlacementGhost,
  type PlacementTool,
  type PlacementToolOptions,
} from "../placement";
