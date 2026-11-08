/** Dev-server projects: in-process Hocuspocus over each project's files, the dev file adapter, file batches and the paths they live at. Node only; never part of a build. */
export { DEV_CACHE_ROOT, defaultCacheDir, fileContentStore } from "./content-store";
export { resolveScenePath, sceneNameOf, SCENE_NAME_PATTERN, ScenePathError } from "./scene-paths";
export { applyProjectBatchToFiles, snapshotFiles, type FileApplyOptions } from "./apply-files";
export {
  ASSET_CHANGED,
  createSceneCollab,
  listenSceneCollab,
  SCENE_COLLAB_PATH,
  sceneCollabServer,
  type AssetChangedMessage,
  type ListeningSceneCollab,
  type SceneCollab,
  type SceneCollabOptions,
  type SceneCollabPlugin,
} from "./collab-server";
export { PROJECT_ROUTE, SCENE_ROUTE } from "./handler";
export {
  codeModules,
  createProjectFileAdapter,
  DISK_ORIGIN,
  gameRegisters,
  isCodePath,
  MOVE_SETTLE_MS,
  pairDiskEvents,
  PERSISTED_ORIGIN,
  prefabPath,
  prefabsDirOf,
  readFileProject,
  readPrefabFiles,
  readProjectPrefabFiles,
  type AssetChange,
  type BlobRepair,
  type DiskChange,
  type DiskEvent,
  type DiskSync,
  type FileProject,
  type PrefabFiles,
  type ProjectDiskSync,
  type ProjectFileAdapter,
  type ProjectFileAdapterOptions,
  type ProjectProblem,
  type ProjectScan,
  type ProjectSync,
} from "./project-files";
