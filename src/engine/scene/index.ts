/** Scene format v2: parse, validate, format, hash, expand, prefabs, and the `SceneOp` command language. Server-safe. */
export * from "./types";
export { createRegistry, RegistryError } from "../game/define";
export type { Registry } from "../game/types";
export { ENGINE_REGISTRY_ID } from "../game/types";
export {
  entitySchemaFor,
  fieldKind,
  geometryFields,
  ID_PATTERN,
  sceneGameOf,
  sceneRegistry,
  GroupSchema,
  InstanceSchema,
  OVERRIDE_PATH,
  sceneSchemaFor,
  unknownGameIssue,
  type FieldKind,
} from "./schema";
export {
  entityIssues,
  parseScene,
  parseSceneOrThrow,
  pointerLines,
  SceneParseError,
  SceneVersionError,
  suggestType,
  type ParseSceneResult,
} from "./parse";
export { parseShape, shapeToTuple, ShapeTupleSchema, type ParseShapeResult } from "./shapes";
export {
  aabb,
  aabbUnion,
  boxCorners,
  centroid,
  closestOnSegment,
  containedInRect,
  containsPoint,
  convexHull,
  intersectsRect,
  isConvex,
  nearestSegment,
  nearestVertex,
  rotateShape,
  shapeVertices,
  topSpan,
  translateShape,
} from "./shape-geometry";
export { shapeIsClosed, shapeOutline, type PathCommand } from "./shape-outline";
export {
  bulkEntries,
  bulkId,
  bulkKeysOf,
  bulkKeyType,
  expandScene,
  isExpandedScene,
  parseBulkId,
  type ExpandOptions,
} from "./expand";
export {
  CHILD_SEPARATOR,
  childRef,
  groupOrigin,
  instanceOrigin,
  localChild,
  localChildren,
  parseChildRef,
  resolveScene,
  resolveSceneDetailed,
  splitOverridePath,
  type LocalChild,
  type ResolvedOrigin,
  type ResolvedScene,
} from "./resolve";
export {
  formatPrefabs,
  parsePrefab,
  prefabBody,
  prefabLibrary,
  prefabOf,
  prefabScene,
  PREFABS_DIR,
  prefabSchemaFor,
  prefabsUsedBy,
  sceneBody,
  sceneHashWith,
  type ParsePrefabResult,
} from "./prefab";
export { createScene, EMPTY_SCENE_TEMPLATE } from "./create";
export { comparePointers, formatPrefab, formatScene } from "./format";
export { hashText, sceneHash } from "./hash";
export { migrate, MIGRATIONS, type MigrateResult, type Migration } from "./migrate";
export { closest } from "./did-you-mean";
export { validateScene, type ValidateOptions } from "./validate";
export { ISSUE_CODES, jsonPointer, makeIssue } from "./issues";
export {
  fragmentJsonSchema,
  prefabJsonSchema,
  sceneJsonSchema,
  SCHEMA_ID_BASE,
  schemaIdFor,
  undescribedProperties,
  untitledEntityFields,
} from "./json-schema";
export { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
export { applyOps, toSourceBatch } from "./ops";
export { opBatchSchemaFor, opsJsonSchema, opsSchemaId, sceneOpSchemaFor } from "./ops-schema";
export { describeChange, diffScenes } from "./diff";
export {
  FRAGMENT_KIND,
  fragmentBounds,
  fragmentOf,
  fragmentSchemaFor,
  nextFreeId,
  parseFragment,
  placeFragment,
  takenIds,
  type ParseFragmentResult,
  type PlacedFragment,
  type SceneFragment,
} from "./fragment";
export {
  CHECKS_FORMAT_VERSION,
  CHECKS_SUFFIX,
  checksJsonSchema,
  checksPathOf,
  checksSchemaFor,
  checksSchemaId,
  DEFAULT_TOUCH_ROLLOUTS,
  DEFAULT_TOUCH_SEED,
  DEFAULT_TOUCH_TICKS,
  MAX_TOUCH_ROLLOUTS,
  parseChecks,
  type ChecksFile,
  type ChecksIssue,
  type GameCheck,
  type ParseChecksResult,
  type ReachesCheck,
  type SceneCheck,
  type TouchesCheck,
  type ValidCheck,
} from "./checks";
export { diffToOps } from "./diff-to-ops";
export {
  renderSceneSvg,
  SCENE_SVG_MAX_SIZE,
  sceneViewport,
  type SceneLabels,
  type SceneSvgOptions,
  type SceneViewport,
} from "./svg";
export {
  DEFAULT_ASCII_TAG_CHARS,
  formatAsciiMap,
  renderSceneAscii,
  sceneAsciiMap,
  type SceneAsciiMap,
  type SceneAsciiOptions,
} from "./ascii";
export type { OverlayPoint, SceneOverlay, SceneRegionOptions } from "./render-geometry";
export {
  parseRecording,
  RECORDING_SCHEMA_ID,
  RECORDING_TRAIL_EVERY,
  RECORDING_VERSION,
  recordingJsonSchema,
  runRecordingSchema,
  type ParseRecordingResult,
  type RecordingIssue,
  type RecordingMarker,
  type RunRecording,
} from "./recording-schema";
export {
  DEFAULT_SCRIPT_MAX_TICKS,
  DEFAULT_UNTIL_MAX,
  INPUT_SCRIPT_VERSION,
  inputScriptJsonSchema,
  inputScriptSchemaFor,
  inputScriptSchemaId,
  inputScriptSchemasFor,
  MAX_SCRIPT_TICKS,
  type InputScriptSchemas,
} from "./input-script";
