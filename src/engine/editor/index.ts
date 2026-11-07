/** @experimental The editor on a shared doc with no DOM or renderer: session, keymap, the tool host and its tools, picking, snapping, gizmos, the clipboard and the inspector model. The file-based `createHistory` remains for tools that edit files. */
export { createEditorSession, labelFor } from "./session";
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
export { prune, remap, select, type SelectMode } from "./selection";
export { createEditorStore, type EditorMode, type EditorStoreState } from "./store";
export { buildOutline, INSTANCES_ROW, outlineOrder, type OutlineRow } from "./outline";
export {
  applyToPrefabBatch,
  childOverrides,
  createPrefabBatch,
  instanceOfRef,
  instancesOf,
  revertAllBatch,
  revertFieldBatch,
  unpackBatch,
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
  modelBatch,
  modelOps,
  parseRelative,
  refCandidates,
  SECTION_TITLES,
  shapeConversions,
  type EnumOption,
  type FieldWidget,
  type InspectorModel,
  type InspectorSectionId,
  type InspectorSectionModel,
  type ModelEdit,
  type ModelField,
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
  type ToolOverlay,
  type ToolPointerEvent,
} from "./tools";
export { ENGINE_TOOL_IDS, type EngineToolId } from "../game/types";
export {
  bulkGeometry,
  createSpatialIndex,
  DEFAULT_CELL,
  defaultLayer,
  entityGeometry,
  geometryOfRef,
  type EditableSpatialIndex,
  type EditGeometry,
  type SpatialIndexOptions,
} from "./spatial-index";
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
export { docRefs, isBulkRef, lookupRef, type RefTarget } from "./refs";
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
  Layer,
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
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nextGroupName,
  nudgeBatch,
  nudgeDelta,
  rotateSelectionBatch,
  rotationPivot,
  selectAllRefs,
  selectionBounds,
  targetsOf,
  ungroupBatch,
} from "./commands";
export {
  boxTool,
  circleTool,
  createDrawTool,
  DEFAULT_DRAW_TYPE,
  drawBatch,
  drawnShape,
  type DrawToolOptions,
} from "./builtin/draw";
export {
  CLOSE_PX,
  createPenTool,
  lock45,
  penTool,
  PICK_TOL_PX,
  strokeShape,
  waypointsTool,
} from "./builtin/polyline";
export { DRAG_THRESHOLD_PX, selectTool } from "./builtin/select";
export { panTool, rotateTool } from "./builtin/transform";
