import { z } from "zod";

import type { CommandDef } from "./types";

/** The engine command a script's or a check's `nav` sends: the `nav-agent` system reads it at the start of the tick. */
export const NAV_COMMAND = "@nav";

/** Where a `nav` step, a check's `nav` or the `@nav` command sends a nav agent. */
export type NavDestination = {
  /** The nav agent's entity id. */
  id: string;
  /** A point, world m, or an entity id it follows. */
  to: [x: number, y: number] | string;
};

/** A nav agent and where it walks: a point in world metres or another entity's id. */
export const navDestinationSchema: z.ZodType<NavDestination> = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .describe("The entity carrying the nav-agent, e.g. `guard`, or a spawned `guard#1`."),
    to: z
      .union([
        z
          .tuple([
            z.number().describe("x in world metres.").meta({ unit: "m" }),
            z.number().describe("y in world metres; y is down.").meta({ unit: "m" }),
          ])
          .describe("A point [x, y] in world metres.")
          .meta({ unit: "m" }),
        z.string().min(1).describe("Another entity's id: the agent follows it as it moves."),
      ])
      .describe("Where it walks: a point in world metres, or an entity it follows."),
  })
  .describe(
    "Sends a nav agent to a point or after an entity, as `setDestination` does: it plans at once and raises nav:arrived or nav:blocked.",
  )
  .meta({ id: "NavDestination" });

/** Engine commands; game command names may not start with "@". */
export const ENGINE_COMMANDS: Readonly<Record<"@elapsed" | typeof NAV_COMMAND, CommandDef>> = {
  "@elapsed": {
    description: "Wall time that passed while the game wasn't running, in ms.",
    args: z.strictObject({ ms: z.number().int().min(0) }),
  },
  [NAV_COMMAND]: {
    description:
      "Sends a nav agent to a point, world m, or after an entity; refused for an entity without a nav-agent.",
    args: navDestinationSchema,
  },
};

/** What a game's command names look like. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
