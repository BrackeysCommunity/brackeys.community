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
  type BehaviorBlock,
  type BehaviorDef,
  type BehaviorName,
  type BehaviorSystem,
  type BehaviorSystemFactory,
  type RegisteredBehavior,
} from "./behaviors";
export {
  SPRITE,
  SPRITE_FALLBACK_SIZE,
  spriteGeometry,
  type FrameRect,
  type SpriteAssetInfo,
  type SpriteBlock,
  type SpriteGeometry,
} from "./behaviors/sprite";
export { OCCUPANT, type OccupantBlock } from "./behaviors/occupant";
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
  DEFAULT_GRAVITY,
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
  type ResolvedTime,
  type TimeKind,
  type TimeModel,
} from "./time";
export { PhysicsRequiredError, physicsOf } from "./physics-of";
export { COMMAND_NAME_PATTERN, ENGINE_COMMANDS } from "./commands";
export {
  ENGINE_CHECK_KINDS,
  ENGINE_COLLISION_GROUPS,
  ENGINE_PREDICATES,
  ENGINE_REGISTRY_ID,
  ENGINE_RUN_RESULTS,
  ENGINE_TOOL_IDS,
  PRIMITIVE_TYPES,
} from "./types";
export type {
  ActionDef,
  BasePrimitive,
  BehaviorRules,
  BulkKeyInfo,
  CheckEnv,
  CheckKindDef,
  CheckVerdict,
  ColliderTag,
  CommandDef,
  ColliderTags,
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
  GameKeyBinding,
  GameOutcome,
  GamePlayDef,
  GameRuntime,
  GameShell,
  GameTableDef,
  GameWorldDef,
  EngineToolId,
  InspectorWidgetDef,
  IssueCodeDef,
  Macro,
  MacroRandom,
  MaterialDef,
  PhysicalCheck,
  PhysicalEnv,
  PhysicalHit,
  PlayStart,
  PlayState,
  PrimitiveType,
  RegisteredType,
  Registry,
  RunResult,
  SceneSystem,
  ScriptPredicate,
  SceneTemplate,
  SceneValidator,
  Side,
  SpawnShape,
  Style,
  SystemFactory,
} from "./types";
export type { AssetKindDef } from "../project/kinds";
export type { ProjectRuntimeView } from "../project/runtime-view";
export type { Pose, PoseIndex } from "../runtime/poses";
export { spawnPose } from "../runtime/spawn-pose";

// ─── System authoring ────────────────────────────────────
export { DRAW_LAYERS } from "../context";
export type { DrawLayer, SceneView, ViewLayer, ViewLayerHandle } from "../context";
export { createSensorCollider } from "../collisions";
export { degToRad, posedBodyDesc, shapeColliderDesc, shapePose } from "../physics";
export type { CharacterControllerOptions, PhysicsWorld } from "../physics";
export {
  advanceWaypoint,
  initialWaypointState,
  interpolatePosition,
} from "../systems/path-follower";
export { carrierDelta, createFollowerSystem } from "../systems/path-follower";
export type { Attachment, AttachmentHub } from "../systems/attachments";
export type {
  FollowerOptions,
  FollowerSystem,
  WaypointMode,
  WaypointState,
} from "../systems/path-follower";
export { createDecorSystem } from "../systems/decor";
export type { DecorEntity } from "../systems/decor";
export { createMarkerSystem } from "../systems/marker";
export type { MarkerEntity, MarkerSystem } from "../systems/marker";
export { createNavSystem, isNavSystem } from "../systems/nav";
export type { NavEntity, NavPolygon, NavSystem } from "../systems/nav";
export {
  bodyLocalShape,
  createPropSystem,
  createSensorSystem,
  createSolidSystem,
  drawEntity,
  styleOf,
} from "../systems/bodies";
export type { SensorSystem, SolidOptions, SolidSystem, VisualOptions } from "../systems/bodies";
export { drawShape, traceShape } from "../render/draw-shape";
export { clamp, clampVec2, distanceVec2, lerp, lerpVec2 } from "../math";
export type {
  LoadFailureReason,
  SceneRuntimeHandle,
  StepEvent,
  StepResult,
} from "../runtime/types";
export type { GeometryColliderDesc, GeometryWorld } from "../runtime/geometry-world";
export type { SpaceCastHit, SpaceFilter, SpaceHit, SpaceQuery } from "../runtime/space";
export { sceneGrid } from "../runtime/grid";
export type { RuntimeGrid } from "../runtime/grid";
export type { RuntimeNav } from "../runtime/nav";

// ─── Grids, motion and navigation ────────────────────────
export {
  cellKey,
  cellOf,
  createOccupancy,
  fieldOfView,
  findPath,
  flowField,
  gridGeometry,
  lineOfSight,
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
  createTopDownController,
  type GridStepper,
  type MotionBody,
  type MotionBodyOptions,
  type MotionResult,
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
export { SENSOR_ENTER, SENSOR_EXIT } from "../runtime/types";
export { TOOL_PRIORITY, type ToolConsumer, type ToolEvent, type ToolRouter } from "../tool-router";
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
