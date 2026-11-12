/**
 * What the editors on the engine project need beyond the engine: the project
 * names no game, so its scenes are edited under `createRegistry(null)` as the
 * dev server and the scene CLI judge them.
 */

/**
 * The scene an editor on the engine project opens when the URL names none:
 * the `start` of `packages/engine/scenes/scene-list.json`, as a hosted game's
 * editor opens its own. Games may not import the engine's files, so the
 * editor-host test holds the two equal.
 */
export const ENGINE_START_SCENE = "engine-yard";
