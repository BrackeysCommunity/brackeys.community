import type { IssueCodeDef } from "@jams/engine/game";

import { GRAPPLE_RANGE } from "./entities/grapple-anchor";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "./entities/player";

/** Half the height of the hazard `platformer/no-kill-plane`'s fix adds, metres. */
export const KILL_PLANE_HALF_HEIGHT = 0.08;

const PLAYER_BOX = `${PLAYER_WIDTH} × ${PLAYER_HEIGHT} m`;

/** The platformer's own issue codes; the engine's are in `ISSUE_CODES`. */
export const PLATFORMER_ISSUES = {
  "platformer/spawn-missing": {
    severity: "error",
    summary: "The scene has no spawn point.",
    hint: "Add one with an addBulk op on the spawn key; a spawn is the player's feet, so put it on top of a floor.",
    fixable: false,
  },
  "platformer/spawn-overlap": {
    severity: "error",
    summary: `Two spawns' ${PLAYER_BOX} player boxes overlap.`,
    hint: `Move one spawn at least ${PLAYER_WIDTH} m from the other horizontally or vertically.`,
    fixable: false,
  },
  "platformer/wind-rotation": {
    severity: "warn",
    summary: "A rotated wind zone; the player ignores wind rotation today.",
    hint: "Set rot to 0.",
    fixable: true,
  },
  "platformer/no-goal": {
    severity: "warn",
    summary: "The scene has no goal or exit, so a run can't finish.",
    hint: "Add a goal or exit entity.",
    fixable: false,
  },
  "platformer/no-kill-plane": {
    severity: "info",
    summary: "Nothing stops a fall: no hazard spans the bottom of the bounds.",
    hint: `Add a hazard across the full width of bounds near maxY, e.g. ["box", cx, maxY - ${KILL_PLANE_HALF_HEIGHT}, halfWidth, ${KILL_PLANE_HALF_HEIGHT}] (metres).`,
    fixable: true,
  },
  "platformer/spawn-in-solid": {
    severity: "error",
    summary: `A spawn's ${PLAYER_BOX} player box starts inside a solid, cloud or construct.`,
    hint: "Move the spawn onto a floor's top edge; the fix drops it onto the surface under the obstruction.",
    fixable: true,
  },
  "platformer/spawn-in-hazard": {
    severity: "error",
    summary: "A spawn's player box overlaps a hazard, so the run is lost on the first tick.",
    hint: "Move the spawn, or the hazard, so they are at least the player box apart.",
    fixable: false,
  },
  "platformer/spawn-floating": {
    severity: "warn",
    summary: "Nothing is under a spawn within the bounds, so the player falls from the start.",
    hint: "Put a floor under the spawn, or move the spawn onto one; a spawn is the player's feet.",
    fixable: false,
  },
  "platformer/anchor-in-solid": {
    severity: "warn",
    summary: "A grapple anchor sits inside a solid, cloud or construct.",
    hint: "Move the anchor into open air.",
    fixable: false,
  },
  "platformer/anchor-orphan": {
    severity: "warn",
    summary: `No surface to stand on within grapple range (${GRAPPLE_RANGE} m) of an anchor.`,
    hint: `Add a platform within ${GRAPPLE_RANGE} m of the anchor, or move the anchor nearer one.`,
    fixable: false,
  },
  "platformer/cloud-in-solid": {
    severity: "warn",
    summary: "A cloud overlaps a solid.",
    hint: "Move the cloud clear of the solid, or remove the one you don't need.",
    fixable: false,
  },
} as const satisfies Record<string, IssueCodeDef>;

export type PlatformerIssueCode = keyof typeof PLATFORMER_ISSUES;
