import { z } from "zod";

import type { CommandDef } from "./types";

/** Engine commands; game command names may not start with "@". */
export const ENGINE_COMMANDS: Readonly<Record<"@elapsed", CommandDef>> = {
  "@elapsed": {
    description: "Wall time that passed while the game wasn't running, in ms.",
    args: z.strictObject({ ms: z.number().int().min(0) }),
  },
};

/** What a game's command names look like. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
