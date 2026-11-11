/** @experimental The editor on a shared doc with no DOM or renderer: session, keymap, the tool host and its tools, picking, snapping, gizmos, the clipboard and the inspector model. The file-based `createHistory` remains for tools that edit files. */
export { createEditorSession, labelFor, projectHistory } from "./session";
export type {
  DispatchOptions,
  EditorSession,
  EditorSessionEvent,
  EditorSessionOptions,
  SessionHistory,
} from "./session";
export {
  isolationBounds,
  openPrefabIsolation,
  type PrefabIsolation,
  type PrefabIsolationOptions,
} from "./isolation";
export { createHistory, type History, type HistoryEntry, type HistoryOptions } from "./history";
export {
  dropBatch,
  dropFragment,
  dropPreview,
  type AssetDrop,
  type DropOptions,
  type DropPreview,
} from "./asset-drop";
export { prune, remap, select, type SelectMode } from "./selection";
export { createEditorStore, setHover, type EditorMode, type EditorStoreState } from "./store";
export { buildOutline, INSTANCES_ROW, outlineOrder, type OutlineRow } from "./outline";
export {
  applyLevels,
  applyToPrefabBatch,
  asProjectBatch,
  childOverrides,
  createPrefabBatch,
  createVariantBatch,
  instanceOfRef,
  instancesOf,
  nestedInstanceOf,
  overridePathsOf,
  revertAllBatch,
  revertFieldBatch,
  unpackBatch,
  type CreateVariant,
} from "./prefab-commands";
export {
  fieldOp,
  inspectorFields,
  numberBounds,
  shapeSlots,
  withShapeSlot,
  type InspectorField,
  type NumberBounds,
  type ShapeSlot,
} from "./inspector";
export {
  buildInspectorModel,
  INSPECTOR_SECTIONS,
  instanceParamsModel,
  instanceTransformModel,
  instanceZBatch,
  modelBatch,
  modelOps,
  paramBatch,
  parseRelative,
  refCandidates,
  SECTION_TITLES,
  shapeConversions,
  type BehaviorOption,
  type BehaviorSectionId,
  type BehaviorSectionInfo,
  type EnumOption,
  type FieldWidget,
  type InspectorModel,
  type InstanceParamsModel,
  type InstanceTransformModel,
  type InspectorSectionId,
  type InspectorSectionModel,
  type ModelEdit,
  type ModelField,
  type ModelSectionId,
  type ParamModel,
  type ShapeConversion,
} from "./inspector-model";
export {
  defineEditorTool,
  DEFAULT_SNAP,
  SNAP_STEPS,
  type EditorTool,
  type EditorToolContext,
  type EditorToolDef,
  type GizmoHandle,
  type HandleKind,
  type IndexEntry,
  type OverlayTone,
  type SnapSettings,
  type SpatialIndex,
  type ToolKeyEvent,
  type ToolModifiers,
  type ToolOption,
  type ToolOverlay,
  type ToolPointerEvent,
} from "./tools";
export { ENGINE_TOOL_IDS, type EngineToolId } from "../game/types";
export {
  bulkGeometry,
  createSpatialIndex,
  DEFAULT_CELL,
  entityGeometry,
  geometryOfRef,
  type EditableSpatialIndex,
  type EditGeometry,
  type SpatialIndexOptions,
} from "./spatial-index";
export { defaultLayer } from "../scene/layers";
export {
  cycleHit,
  marqueeSelect,
  pickAt,
  POINT_PICK_PX,
  type PickLayers,
  type PickOptions,
} from "./picking";
export {
  roundPt,
  SNAP_PX,
  SNAP_REACH_PX,
  snapAngle,
  snapMove,
  snapPoint,
  type SnapGuide,
  type SnapMoveInput,
  type SnapMoveResult,
  type SnapTarget,
} from "./snap";
export * from "./gizmos";
export {
  copySelection,
  cutSelection,
  duplicateSelection,
  nextFreeId,
  pasteFragment,
  type PasteOptions,
  type PasteResult,
} from "./clipboard";
export {
  boundsCheck,
  placedShape,
  placementEditorTool,
  type PlacedTemplate,
  type PlacementEditorToolOptions,
  type PlacementTemplate,
} from "./placement";
export type { PlacementCheck } from "../placement";
export {
  createKeymap,
  ENGINE_KEYS,
  keyChord,
  normalizeChord,
  type EditorCommand,
  type EditorKeyEvent,
  type EngineKeyBinding,
  type KeyContext,
  type Keymap,
  type KeyMatch,
  type KeyScope,
} from "./keymap";
export type { GameEditorDef, GameKeyBinding, InspectorWidgetDef } from "../game/types";
export { attachBatch, attachFieldOf, isFollowerType } from "./attach";
export { docRefs, isBulkRef, lookupRef, referableEntities, type RefTarget } from "./refs";
export {
  fragmentBounds,
  fragmentOf,
  parseFragment,
  type ParseFragmentResult,
  type SceneFragment,
} from "../scene/fragment";

export type { Registry } from "../game/types";
export type { DocApplyResult } from "../collab/apply";
export type { PeerPresence } from "../collab/presence";
export type { RevertResult } from "../collab/revert";
export type { LogEntry, SceneOrigin, ScenePresence } from "../collab/types";
export type {
  ApplyOptions,
  ApplyResult,
  BulkEntry,
  BulkKey,
  EntityDef,
  EntityTypeName,
  OpBatch,
  Pt,
  Aabb,
  Ref,
  SceneChange,
  SceneDefinition,
  SceneHash,
  SceneIssue,
  SceneOp,
  ShapeObj,
  ShapeTuple,
} from "../scene/types";
export {
  createGesturePreview,
  expandRefs,
  type GesturePreview,
  type GesturePreviewOptions,
  type PreviewRuntime,
} from "./gesture";
export {
  builtinTools,
  createToolHost,
  MULTI_CLICK_MS,
  MULTI_CLICK_PX,
  toolKeyEventOf,
  WHEEL_ZOOM,
  type ToolHost,
  type ToolHostOptions,
  type ToolLayers,
} from "./tool-host";
export {
  COARSE_NUDGE_STEPS,
  deleteBatch,
  flipBatch,
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nextGroupName,
  nudgeBatch,
  nudgeDelta,
  quarterTurnTargets,
  rotateSelectionBatch,
  rotationPivot,
  selectAllRefs,
  selectionBounds,
  targetsOf,
  turnBatch,
  ungroupBatch,
  zOrderBatch,
  type QuarterTurnTargets,
} from "./commands";
export {
  boxTool,
  circleTool,
  createDrawTool,
  DEFAULT_DRAW_TYPE,
  DRAW_TYPE_COMMAND,
  drawBatch,
  drawnShape,
  drawTypeOptions,
  type DrawToolKind,
  type DrawToolOptions,
  type DrawTypeOption,
} from "./builtin/draw";
export {
  CLOSE_PX,
  createPenTool,
  lock45,
  penTool,
  PICK_TOL_PX,
  strokeFit,
  strokeShape,
  waypointsTool,
  type StrokeFit,
} from "./builtin/polyline";
export { DRAG_THRESHOLD_PX, selectTool } from "./builtin/select";
export { panTool, rotateTool } from "./builtin/transform";
