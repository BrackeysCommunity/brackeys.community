/** The shared scene document: the `Y.Doc` layout, conversions, live writes, binding, undo and presence, plus the project-wide undo, log and presence and the declarative kinds' layout codecs. Transport-agnostic; the host supplies a provider. */
export * from "./types";
export {
  assetsMap,
  bucketOf,
  bulkRecord,
  contentMaps,
  docLayout,
  docMeta,
  docPrefabs,
  docToScene,
  ENTITIES_BUCKET,
  entitiesMap,
  entityRecord,
  gridRowKey,
  groupsMap,
  instanceRecord,
  instancesMap,
  isLayoutKey,
  isPrefabDoc,
  metaMap,
  paramsMap,
  patchMap,
  patchRecord,
  prefabHeaderMap,
  prefabOverridesMap,
  prefabSceneBounds,
  prefabsMap,
  readAssets,
  readDoc,
  recordFields,
  recordMap,
  recordOf,
  sceneMap,
  sceneToDoc,
  settingsMap,
  writeAssets,
  type DocView,
  type PrefabDocHeader,
  type ReadDocOptions,
  type SceneToDocOptions,
} from "./convert";
export {
  docToPrefab,
  PREFAB_HEADER_KEY,
  prefabPatch,
  prefabPathNear,
  prefabToDoc,
  type PrefabPatchOptions,
  type PrefabToDocOptions,
} from "./prefab-doc";
export {
  EMPTY_PREFAB_SOURCE,
  localPrefabSource,
  sessionPrefabSource,
  staticPrefabSource,
  type PrefabSource,
  type SessionPrefabSource,
  type SessionPrefabSourceOptions,
} from "./prefab-source";
export {
  migrateDocLayout,
  migrateLayout,
  projectDocWriter,
  type DocLayoutMigration,
  type LayoutMigration,
  type ProjectDocWriterOptions,
  type ProjectWriter,
} from "./migrate-layout";
export { migrateDoc, type MigrateDocOptions } from "./migrate";
export { buildAtFrom, stampWins } from "./build-stamp";
export { randomKey, sequentialKeys, type KeyGen } from "./keys";
export { assignZ, compareZ } from "./order";
export {
  applyOpsToDoc,
  headerOf,
  patchGroup,
  refsOfView,
  SCENE_ONLY_OPS,
  type DocApplyOptions,
  type DocApplyResult,
  type PrefabChange,
  type PrefabDocPlan,
  type PrefabDocWrite,
  type PrefabDocWriter,
} from "./apply";
export { LOG_CAP, fingerprint, observeLog, readLog, stableJson } from "./log";
export { createSceneUndo, type SceneUndo, type SelectionMeta } from "./undo";
export {
  createUndoCoordinator,
  UNDO_CAP,
  type StepSelection,
  type UndoCoordinator,
  type UndoneStep,
} from "./undo-coordinator";
export {
  appendProjectLog,
  historyRows,
  observeProjectLog,
  projectLogFor,
  readProjectLog,
  type HistoryRow,
  type ProjectLogInput,
} from "./project-log";
export {
  appendHistory,
  ENTRY_NESTED_FIELDS,
  PROJECT_LAYOUT_VERSION,
  PROJECT_MAPS,
  projectAssetsMap,
  projectBuildMap,
  projectCodeMap,
  projectHistoryMap,
  projectMetaMap,
  readEntry,
  readProject,
  seedProjectDoc,
  writeEntry,
  writeProjectState,
} from "./project-doc";
export {
  actorId,
  applyProjectBatch,
  applyRegistryBatch,
  applyRepairs,
  reinspectBlobs,
  type ProjectApplyOptions,
  type RegistryApplyOptions,
  type RegistryApplyResult,
  type ReinspectResult,
  type RepairResult,
} from "./project-apply";
export {
  CONTENT_KEY_PREFIX,
  contentLogKey,
  revertEntry,
  revertOpenProjectEntry,
  revertProblem,
  revertProjectEntry,
  type ProjectRevertResult,
  type RevertOptions,
  type RevertResult,
} from "./revert";
export {
  createProjectSession,
  memoryDocHost,
  NO_PREFAB_WRITER,
  type CodeSkewIssue,
  type MemoryDocClient,
  type MemoryDocHost,
  type OpenDoc,
  type OpenedDoc,
  type PrefabPlan,
  type PrefabWriteRequest,
  type PrefabWriter,
  type ProjectSession,
  type ProjectSessionEvent,
  type ProjectSessionOptions,
  type SessionDoc,
} from "./project-session";
export {
  bindSceneDoc,
  expandLenient,
  type BindableRuntime,
  type BindOptions,
  type SceneBinding,
} from "./bind";
export {
  validateDoc,
  watchIssues,
  type IssueProject,
  type IssueWatch,
  type WatchIssuesOptions,
} from "./watch-issues";
export { observePeers, peers, selectionsByKey, setPresence, type PeerPresence } from "./presence";
export {
  observeProjectPeers,
  projectPeers,
  projectPeersByDoc,
  setProjectPresence,
  type ProjectPeer,
} from "./project-presence";
export {
  CONTENT_MAP,
  contentMap,
  fieldLayout,
  KEYED_ITEM,
  KEYED_Z,
  layoutFromDoc,
  layoutPatch,
  layoutToDoc,
  type LayoutWriteOptions,
} from "./layout";
