/**
 * @experimental A game's DOM UI over the canvas: the mount seam a project
 * file's `ui` key names, and helpers for framework-free HUDs.
 */
export { bindText, bindToWorld, watchView } from "./bind";
export {
  CAPTION_MS_DEFAULT,
  createCaptions,
  type CaptionsOptions,
  type GameCaptions,
} from "./captions";
export {
  createDialogueBox,
  createTextLog,
  type DialogueBoxOptions,
  type TextLogOptions,
} from "./dialogue";
export { createUiLayer, mountUi, uiAssetUrl, type BlobUrl } from "./layer";
export { renderRichText } from "./rich-dom";
export type { MountUi, UiAssetUrl, UiContext, UiHandle } from "./types";
