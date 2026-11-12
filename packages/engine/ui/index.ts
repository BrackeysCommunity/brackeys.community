/**
 * @experimental A game's DOM UI over the canvas: the mount seam a project
 * file's `ui` key names, and helpers for framework-free HUDs.
 */
export { bindText, bindToWorld, watchView } from "./bind";
export { createUiLayer, mountUi } from "./layer";
export type { MountUi, UiContext, UiHandle } from "./types";
