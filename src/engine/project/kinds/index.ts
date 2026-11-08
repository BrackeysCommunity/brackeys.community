import { atlasKind } from "./atlas";
import { audioKind } from "./audio";
import { checksKind } from "./checks";
import { codeKind } from "./code";
import { dataTableKind } from "./data-table";
import type { AssetKindDef } from "./define";
import { fontKind } from "./font";
import { gameSettingsKind } from "./game-settings";
import { inputScriptKind } from "./input-script";
import { materialKind } from "./material";
import { prefabKind } from "./prefab";
import { recordingKind } from "./recording";
import { sceneKind } from "./scene";
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
export { INPUT_SCRIPT_SUFFIX, inputScriptKind } from "./input-script";
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
export { sceneKind } from "./scene";
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
  checksKind,
  textureKind,
  atlasKind,
  fontKind,
  audioKind,
  recordingKind,
  codeKind,
];
