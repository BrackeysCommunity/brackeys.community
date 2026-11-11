import { atlasKind } from "./atlas";
import { audioKind } from "./audio";
import { checksKind } from "./checks";
import { codeKind } from "./code";
import { dataTableKind } from "./data-table";
import type { AssetKindDef } from "./define";
import { fontKind } from "./font";
import { gameSettingsKind } from "./game-settings";
import { inputMapKind } from "./input-map";
import { inputScriptKind } from "./input-script";
import { materialKind } from "./material";
import { prefabKind } from "./prefab";
import { recordingKind } from "./recording";
import { saveKind } from "./save";
import { sceneKind } from "./scene";
import { sceneListKind } from "./scene-list";
import { textureKind } from "./texture";

export {
  ATLAS_KIND,
  ATLAS_SUFFIX,
  atlasKind,
  atlasMetaSchema,
  atlasSettingsSchema,
  type AtlasMeta,
  type AtlasSettings,
  type AtlasTool,
} from "./atlas";
export {
  AUDIO_KIND,
  audioKind,
  audioMetaSchema,
  audioSettingsSchema,
  type AudioMeta,
  type AudioSettings,
} from "./audio";
export { checksKind } from "./checks";
export { codeKind } from "./code";
export {
  DATA_TABLE_KIND,
  DATA_TABLE_SCHEMA_ID,
  DATA_TABLE_VERSION,
  dataTableIssues,
  dataTableKind,
  rowSchemaOf,
  tableAssets,
  type DataTableFile,
  type DataTableRow,
} from "./data-table";
export {
  FONT_KIND,
  fontKind,
  fontMetaSchema,
  fontSettingsSchema,
  type FontFormat,
  type FontMeta,
  type FontSettings,
} from "./font";
export {
  GAME_SETTINGS_KIND,
  GAME_SETTINGS_SCHEMA_ID,
  GAME_SETTINGS_VERSION,
  gameSettingsEntries,
  gameSettingsIssues,
  gameSettingsKind,
  gameSettingsValues,
  type GameSettingsFile,
} from "./game-settings";
export {
  INPUT_MAP_KIND,
  INPUT_MAP_SCHEMA_ID,
  INPUT_MAP_VERSION,
  inputMapEntries,
  inputMapIssues,
  inputMapKind,
  inputMapProblems,
  usableInputMap,
  type InputMapFile,
  type InputMapProblem,
  type InputMapTouchControl,
} from "./input-map";
export { INPUT_SCRIPT_SUFFIX, inputScriptKind, kindInputMap } from "./input-script";
export {
  MATERIAL_KIND,
  MATERIAL_SCHEMA_ID,
  MATERIAL_VERSION,
  materialKind,
  materialSchema,
  projectMaterialOf,
  type MaterialFile,
} from "./material";
export { prefabKind } from "./prefab";
export {
  RECORDING_KIND,
  RECORDING_SUFFIX,
  recordingKind,
  recordingMetaSchema,
  recordingSettingsSchema,
  type RecordingMeta,
  type RecordingSettings,
} from "./recording";
export {
  SAVE_FIXTURE_MAX_BYTES,
  SAVE_KIND,
  SAVE_SUFFIX,
  saveFixtureMetaSchema,
  saveFixtureSettingsSchema,
  saveKind,
  type SaveFixtureMeta,
  type SaveFixtureSettings,
} from "./save";
export { sceneKind } from "./scene";
export {
  SCENE_LIST_KIND,
  SCENE_LIST_SCHEMA_ID,
  SCENE_LIST_VERSION,
  sceneListEntries,
  sceneListFlow,
  sceneListIssues,
  sceneListKind,
  type SceneListEntry,
  type SceneListFile,
  type SceneListFlow,
} from "./scene-list";
export {
  TEXTURE_KIND,
  textureKind,
  textureMetaSchema,
  textureSettingsSchema,
  type TextureFormat,
  type TextureMeta,
  type TextureSettings,
} from "./texture";

/** The engine's asset kinds, in the order a kind registry lists them before a game's. */
export const ENGINE_ASSET_KINDS: readonly AssetKindDef[] = [
  sceneKind,
  prefabKind,
  materialKind,
  gameSettingsKind,
  dataTableKind,
  inputScriptKind,
  inputMapKind,
  sceneListKind,
  checksKind,
  textureKind,
  atlasKind,
  fontKind,
  audioKind,
  recordingKind,
  saveKind,
  codeKind,
];
