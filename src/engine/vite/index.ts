/** Dev-server scenes: in-process Hocuspocus over the scene files, and the paths they live at. Node only; never part of a build. */
export { resolveScenePath, sceneNameOf, SCENE_NAME_PATTERN, ScenePathError } from "./scene-paths";
export {
  createSceneCollab,
  listenSceneCollab,
  SCENE_COLLAB_PATH,
  sceneCollabServer,
  type ListeningSceneCollab,
  type SceneCollab,
  type SceneCollabOptions,
  type SceneCollabPlugin,
} from "./collab-server";
export {
  createSceneFileAdapter,
  DISK_ORIGIN,
  SCENE_DOC_PREFIX,
  sceneDocName,
  sceneOfDocName,
  type DiskSync,
  type SceneFileAdapter,
  type SceneHome,
} from "./file-adapter";
export { SCENE_ROUTE } from "./handler";
export {
  prefabPath,
  prefabsDirOf,
  readPrefabFiles,
  writePrefabFiles,
  type PrefabFiles,
} from "./prefab-files";
