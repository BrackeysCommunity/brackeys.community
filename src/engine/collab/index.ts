/** The shared scene document: the `Y.Doc` layout, conversions, live writes, binding, undo and presence. Transport-agnostic; the host supplies a provider. */
export * from "./types";
export {
  bucketOf,
  bulkRecord,
  contentMaps,
  docMeta,
  docPrefabs,
  docToScene,
  ENTITIES_BUCKET,
  entitiesMap,
  entityRecord,
  groupsMap,
  instanceRecord,
  instancesMap,
  metaMap,
  patchRecord,
  prefabsMap,
  readDoc,
  recordMap,
  recordOf,
  sceneMap,
  sceneToDoc,
  settingsMap,
  type DocView,
  type SceneToDocOptions,
} from "./convert";
export { migrateDoc, type MigrateDocOptions } from "./migrate";
export { randomKey, sequentialKeys, type KeyGen } from "./keys";
export { assignZ, compareZ } from "./order";
export {
  applyOpsToDoc,
  headerOf,
  refsOfView,
  type DocApplyOptions,
  type DocApplyResult,
} from "./apply";
export { LOG_CAP, fingerprint, observeLog, readLog, stableJson } from "./log";
export { createSceneUndo, type SceneUndo, type SelectionMeta } from "./undo";
export { revertEntry, type RevertResult } from "./revert";
export {
  bindSceneDoc,
  expandLenient,
  type BindableRuntime,
  type BindOptions,
  type SceneBinding,
} from "./bind";
export { validateDoc, watchIssues, type IssueWatch, type WatchIssuesOptions } from "./watch-issues";
export { observePeers, peers, selectionsByKey, setPresence, type PeerPresence } from "./presence";
