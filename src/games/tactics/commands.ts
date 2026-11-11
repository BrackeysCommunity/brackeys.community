import type { CommandDef } from "@jams/engine/game";
import { z } from "zod";

const unitId = z.string().min(1).describe("The unit's entity id.");
const cell = z.tuple([z.number().int(), z.number().int()]).describe("The cell, [col, row].");

const MoveArgs = z.strictObject({ unit: unitId, to: cell });
const AttackArgs = z.strictObject({
  unit: unitId,
  target: z.string().min(1).describe("The enemy unit's entity id."),
});
const WaitArgs = z.strictObject({ unit: unitId });

export const TACTICS_COMMANDS = {
  move: {
    description:
      "Walk a unit of the side to act to a cell in its reach; once per turn, before it acts.",
    args: MoveArgs,
  },
  attack: {
    description:
      "Strike an enemy in the unit's range (and in sight, for a class that needs it); ends the unit's turn.",
    args: AttackArgs,
  },
  wait: { description: "End the unit's turn without attacking.", args: WaitArgs },
  "end-turn": { description: "Hand the turn to the other side." },
} as const satisfies Readonly<Record<string, CommandDef>>;

export type TacticsCommand =
  | { name: "move"; args: z.infer<typeof MoveArgs> }
  | { name: "attack"; args: z.infer<typeof AttackArgs> }
  | { name: "wait"; args: z.infer<typeof WaitArgs> }
  | { name: "end-turn" };

const isEmptyObject = (v: unknown) =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;

/** A command as it arrives (a name and unchecked args), checked against its schema; null when it isn't one of the game's. */
export function parseTacticsCommand(c: { name: string; args?: unknown }): TacticsCommand | null {
  switch (c.name) {
    case "move": {
      const r = MoveArgs.safeParse(c.args);
      return r.success ? { name: "move", args: r.data } : null;
    }
    case "attack": {
      const r = AttackArgs.safeParse(c.args);
      return r.success ? { name: "attack", args: r.data } : null;
    }
    case "wait": {
      const r = WaitArgs.safeParse(c.args);
      return r.success ? { name: "wait", args: r.data } : null;
    }
    case "end-turn":
      return c.args === undefined || isEmptyObject(c.args) ? { name: "end-turn" } : null;
    default:
      return null;
  }
}
