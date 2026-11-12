export const ENGINE_VERSION = "0.14.0";

/**
 * The doc layout this engine writes, stored as `meta.layout`. A doc with no
 * `meta.layout` is layout 1, and so is a sync token with no `l` claim.
 * Layout 2 moved prefabs out of the scene doc into docs of their own;
 * layout 3 renamed the record keys to `@z` and `@bulk` and added the
 * `assets` map, nested behaviors and params, grid rows and the prefab doc's
 * `params`, `overrides` and `instances`.
 */
export const COLLAB_LAYOUT_VERSION = 3;

/**
 * Whether a Rapier recording replays on another CPU architecture without a
 * warning. True since the cross-platform determinism check held on x86_64;
 * when false, a replay whose recorded `arch` is known and differs from here
 * carries `recording-other-platform`.
 */
export const REPLAY_ACROSS_PLATFORMS = true;
