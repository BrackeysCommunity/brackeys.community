import type { GameKeyBinding } from "@jams/engine/game";

import { CONSTRUCT_CONFIGS, CONSTRUCT_TYPES } from "./entities/shaper-constructs";

/** The editor tool that places Shaper constructs as scene entities. */
export const CONSTRUCTS_TOOL = "constructs";

/** Edit-mode keys: 1-6 pick a construct for the constructs tool. */
export const PLATFORMER_EDIT_KEYS: readonly GameKeyBinding[] = CONSTRUCT_TYPES.map(
  (type): GameKeyBinding => ({
    key: String(CONSTRUCT_CONFIGS[type].hotkey),
    scope: "edit",
    command: `tool:${CONSTRUCTS_TOOL}:${type}`,
    description: `Place a ${CONSTRUCT_CONFIGS[type].label}`,
  }),
);
