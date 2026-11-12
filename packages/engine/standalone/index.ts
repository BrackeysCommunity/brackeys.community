/** The standalone host: boots a released game from its `release.json` in any browser page. No node:, no editor. */
export { bootStandalone, type StandaloneGame, type StandaloneOptions } from "./boot";
export { fetchReleaseTexts, type FetchText } from "./data";
export { showBootError, StandaloneBootError } from "./errors";
export { manifestRuntimeView, manifestView } from "./manifest-view";
