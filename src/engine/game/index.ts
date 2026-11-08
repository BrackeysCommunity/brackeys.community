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
  materialField,
  mirrorField,
  PathSchema,
  pointField,
  PtSchema,
  refField,
  shapeField,
  tagsField,
  vectorField,
  type GridFieldInfo,
} from "./fields";
export { DEFAULT_LAYERS, type SceneLayerDef } from "../scene/layers";
export { DEFAULT_GRAVITY, primitiveFields } from "./primitives";
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
  ColliderTags,
  EngineCheckKind,
  EngineCollisionGroup,
  EngineContext,
  EngineRunResult,
  EntityTypeDef,
  FieldEnv,
  GameAttachment,
  GameDefinition,
  GameEditorDef,
  GameKeyBinding,
  GameOutcome,
  GamePlayDef,
  GameRuntime,
  GameShell,
  GameTableDef,
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
  SpawnShape,
  Style,
  SystemFactory,
} from "./types";
export type { AssetKindDef } from "../project/kinds";
export type { ProjectRuntimeView } from "../project/runtime-view";
export type { Pose, PoseIndex } from "../runtime/poses";
export { spawnPose } from "../runtime/poses";

// ─── System authoring ────────────────────────────────────
export { DRAW_LAYERS } from "../context";
export type { DrawLayer, SceneView, ViewLayer, ViewLayerHandle } from "../context";
export { createSensorCollider } from "../collisions";
export { degToRad, posedBodyDesc, shapeColliderDesc, shapePose } from "../physics";
export type { PhysicsWorld } from "../physics";
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
export type { SceneRuntimeHandle, StepEvent, StepResult } from "../runtime/types";
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
