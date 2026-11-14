/** Scene format v2: parse, validate, format, hash, expand, prefabs, and the `SceneOp` command language. Server-safe. */
export * from "./types";
export { createRegistry, isSpawnOnly, placeableTypes, RegistryError } from "../game/define";
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
  spawnSchemaFor,
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
  type ParseOptions,
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
  raycastShape,
  rotateShape,
  shapeAtPose,
  shapesIntersect,
  shapeVertices,
  topSpan,
  translateShape,
} from "./shape-geometry";
export { createSpatialHash, type SpatialHash } from "./spatial-hash";
export { resolveTime } from "../game/time";
export { shapeIsClosed, shapeOutline, type PathCommand } from "./shape-outline";
export {
  bulkEntries,
  bulkId,
  bulkKeysOf,
  behaviorBlocks,
  bulkKeyType,
  defaultPhysics,
  expandInstance,
  expandScene,
  isExpandedScene,
  parseBulkId,
  resolveSettings,
  scenePhysics,
  type ExpandOptions,
  type SettingsSources,
} from "./expand";
export {
  CHILD_SEPARATOR,
  childRef,
  gridTurns,
  groupOrigin,
  groupTransform,
  instanceOrigin,
  instanceSteps,
  instanceTransform,
  localChild,
  localChildren,
  parseChildRef,
  placeChildren,
  resolvePrefab,
  resolveScene,
  resolveSceneDetailed,
  splitChildRef,
  splitOverridePath,
  type BulkPlacement,
  type LocalChild,
  type PlacedChild,
  type PrefabResolution,
  type ResolvedOrigin,
  type ResolvedPrefab,
  type ResolvedScene,
  type ResolveOptions,
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
export {
  applyPt,
  applyVec,
  compose,
  composeDihedral,
  dihedral,
  dihedralOf,
  flipWorld,
  IDENTITY_2D,
  invert,
  inverseTurn,
  isIdentityTurn,
  translation,
  turnOf,
  type Dihedral,
  type Transform2D,
} from "./transform";
export { translateEntityDef } from "./translate";
export { DEFAULT_LAYERS, defaultLayer, type SceneLayerDef } from "./layers";
export {
  canonicalGrid,
  CHUNK_KEY_PATTERN,
  compareChunkKeys,
  decodeRow,
  encodeRow,
  GRID_CHUNK,
  GRID_MAX_VALUE,
  GRID_ROW_PATTERN,
  gridCellBounds,
  gridProblems,
  isGridValue,
  paintGrid,
  parseChunkKey,
  readCell,
  transformGrid,
  type ChunkKey,
  type GridCells,
  type GridProblem,
  type GridRow,
} from "./grid";
export { INSTANCE_OVERRIDE_FIELDS, isInstanceOverrideField, splitFieldPath } from "./field-path";
export {
  CHECKS_LAYOUT,
  comparePointers,
  formatChecks,
  formatInputScript,
  formatPrefab,
  formatScene,
  INPUT_SCRIPT_LAYOUT,
} from "./format";
export { hashText, sceneHash } from "./hash";
export {
  isMigrationRefusal,
  migrate,
  MIGRATIONS,
  type MigrateEnv,
  type MigrateResult,
  type Migration,
  type MigrationRefusal,
} from "./migrate";
export {
  isWholePixel,
  LENGTH_UNITS,
  lengthDecimals,
  pxToMetres,
  roundLength,
  snapToPixel,
  type LengthUnitName,
} from "./units";
export { closest, didYouMean } from "./did-you-mean";
export {
  sublevelIssue,
  validateScene,
  type SublevelJudgeOptions,
  type SublevelSettings,
  type ValidateOptions,
} from "./validate";
export {
  isErrorIssue,
  ISSUE_CODES,
  jsonPointer,
  liveIssue,
  makeIssue,
  type LiveIssueInput,
  type LiveSwapPhase,
} from "./issues";
export { diffExpanded } from "./expanded-diff";
export { plural } from "./plural";
export { SHORT_ID_LENGTH, shortId } from "./short-id";
export {
  fragmentJsonSchema,
  layerNames,
  prefabJsonSchema,
  sceneJsonSchema,
  SCHEMA_ID_BASE,
  schemaIdFor,
  undescribedProperties,
  untitledEntityFields,
  type JsonSchemaOptions,
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
  DEFAULT_BLOCKED_BY,
  DEFAULT_TOUCH_ROLLOUTS,
  DEFAULT_TOUCH_SEED,
  DEFAULT_TOUCH_TICKS,
  MAX_TOUCH_ROLLOUTS,
  parseChecks,
  type CheckCell,
  type CheckPlace,
  type ChecksFile,
  type ChecksIssue,
  type ConnectedCheck,
  type GameCheck,
  type ParseChecksResult,
  type ReachesCheck,
  type SceneCheck,
  type TouchesCheck,
  type ValidCheck,
} from "./checks";
export { diffPrefabToOps, diffToOps } from "./diff-to-ops";
export {
  renderSceneSvg,
  SCENE_GRID_MAX_CELLS,
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
export { projectSpriteAssets, sceneSprites, spriteBoxOf } from "./render-geometry";
export type {
  DrawnSprite,
  OverlayPoint,
  SceneOverlay,
  SceneRegionOptions,
  SceneSprite,
  SpriteAssetLookup,
  SpritePoseSource,
} from "./render-geometry";
export {
  migrateRecordingV1,
  parseRecording,
  RECORDING_SCHEMA_ID,
  RECORDING_TRAIL_EVERY,
  RECORDING_VERSION,
  recordingJsonSchema,
  runRecordingSchema,
  runRecordingV1Schema,
  type ParseRecordingResult,
  type RecordedSwap,
  type RecordingCommand,
  type RecordingIssue,
  type RecordingMarker,
  type RecordingPlatform,
  type RecordingStream,
  type RunRecording,
  type RunRecordingV1,
  type RunRecordingV2,
  type SeatEvent,
  type SystemEvent,
} from "./recording-schema";
export {
  DEFAULT_SCRIPT_MAX_TICKS,
  DEFAULT_UNTIL_MAX,
  INPUT_SCRIPT_MIGRATIONS,
  INPUT_SCRIPT_VERSION,
  inputScriptJsonSchema,
  inputScriptSchemaFor,
  inputScriptSchemaId,
  inputScriptSchemasFor,
  MAX_SCRIPT_TICKS,
  migrateInputScript,
  parseInputScript,
  scriptSeatLimit,
  scriptShapeIssues,
  worldPointSchema,
  type AnalogSet,
  type CountMatch,
  type ExistsMatch,
  type InputScriptSchemas,
  type MigrateInputScriptResult,
  type ParseInputScriptResult,
  type ScriptPointer,
} from "./input-script";
