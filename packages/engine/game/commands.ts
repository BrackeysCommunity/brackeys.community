import { z } from "zod";

import type { CommandDef, GameCommand } from "./types";

/** The engine command a script's or a check's `nav` sends: the `nav-agent` system reads it at the start of the tick. */
export const NAV_COMMAND = "@nav";

/** The player's calibrated audio-input latency; delivered with the next tick, never waking a turns or event game on its own. */
export const LATENCY_COMMAND = "@latency";
/** The largest `@latency` either way, ms. */
export const LATENCY_MS_LIMIT = 500;
/** Shows the active dialogue's next line. */
export const DIALOGUE_ADVANCE_COMMAND = "@dialogue-advance";
/** Picks one of the active dialogue's visible, enabled choices. */
export const DIALOGUE_CHOOSE_COMMAND = "@dialogue-choose";

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

const dialogueChooseArgs = z.strictObject({
  choice: z.number().int().min(0).describe("The choice's index in the dialogue's view."),
});

/** `@dialogue-advance`, from `player` when given. */
export const dialogueAdvance = (player?: number): GameCommand => ({
  name: DIALOGUE_ADVANCE_COMMAND,
  ...(player !== undefined && { player }),
});

/** `@dialogue-choose` for the choice at `choice` in the view, from `player` when given. */
export const dialogueChoose = (choice: number, player?: number): GameCommand => ({
  name: DIALOGUE_CHOOSE_COMMAND,
  args: { choice },
  ...(player !== undefined && { player }),
});

/** The choice a `@dialogue-choose` names, or null when its args don't parse. */
export const dialogueChoiceOf = (command: GameCommand): number | null => {
  const parsed = dialogueChooseArgs.safeParse(command.args);
  return parsed.success ? parsed.data.choice : null;
};

export type EngineCommandName =
  | "@elapsed"
  | typeof NAV_COMMAND
  | typeof LATENCY_COMMAND
  | typeof DIALOGUE_ADVANCE_COMMAND
  | typeof DIALOGUE_CHOOSE_COMMAND;

/** Engine commands; game command names may not start with "@". */
export const ENGINE_COMMANDS: Readonly<Record<EngineCommandName, CommandDef>> = {
  "@elapsed": {
    description: "Wall time that passed while the game wasn't running, in ms.",
    args: z.strictObject({ ms: z.number().int().min(0) }),
  },
  [NAV_COMMAND]: {
    description:
      "Sends a nav agent to a point, world m, or after an entity; refused for an entity without a nav-agent.",
    args: navDestinationSchema,
  },
  [LATENCY_COMMAND]: {
    description: "The player's calibrated audio-input latency, ms.",
    args: z.strictObject({
      ms: z
        .number()
        .int()
        .min(-LATENCY_MS_LIMIT)
        .max(LATENCY_MS_LIMIT)
        .describe("Positive when input arrives after the sound it answers.")
        .meta({ unit: "ms" }),
    }),
  },
  [DIALOGUE_ADVANCE_COMMAND]: {
    description: "Shows the next line of the active dialogue.",
  },
  [DIALOGUE_CHOOSE_COMMAND]: {
    description: "Picks a visible, enabled choice of the active dialogue.",
    args: dialogueChooseArgs,
  },
};

/** Whether `name` is one of the dialogue's commands, which the dialogue system takes before the game's `beforeStep`. */
export const isDialogueCommand = (name: string): boolean =>
  name === DIALOGUE_ADVANCE_COMMAND || name === DIALOGUE_CHOOSE_COMMAND;

/** What a game's command names look like. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
