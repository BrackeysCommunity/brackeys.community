export const ENGINE_VERSION = "0.20.0";

/** The doc layout this engine writes (`meta.layout`); a doc or sync token without one is layout 1. */
export const COLLAB_LAYOUT_VERSION = 3;

/**
 * Whether a Rapier recording replays on another CPU architecture without a
 * warning. True since the cross-platform determinism check held on x86_64;
 * when false, a replay whose recorded `arch` is known and differs from here
 * carries `recording-other-platform`.
 */
export const REPLAY_ACROSS_PLATFORMS = true;
