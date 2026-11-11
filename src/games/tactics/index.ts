import { defineGame, type GamePlayDef } from "@jams/engine/game";

import { TACTICS_ACTIONS } from "./actions";
import { TACTICS_COMMANDS } from "./commands";
import { TACTICS_PLAY } from "./play";
import {
  createTacticsRuntime,
  initialProgress,
  STAIR_TYPE,
  TACTICS_FLOW_COMMANDS,
  TACTICS_PROGRESS,
  TACTICS_SETTINGS,
  UNIT_CLASS_TABLE,
  WALK_TICKS,
  type TacticsRunSnapshot,
} from "./runtime";
import { TACTICS_TEMPLATE } from "./template";
import { ROUGH_TYPE, TACTICS_GRID, UNIT_CLASS_ROW, UNIT_TYPE } from "./types";

/**
 * The rules' play hooks, around the flow: the menu and result scenes list
 * their one command, and a level that has asked for the next scene gives no
 * verdict, so a run that follows flow goes on into it.
 */
const play: GamePlayDef<TacticsRunSnapshot> = {
  ...TACTICS_PLAY,
  outcome: (state) =>
    state.snapshot.screen !== undefined || state.snapshot.next !== undefined
      ? null
      : (TACTICS_PLAY.outcome?.(state) ?? null),
  commands(state) {
    const { screen, next } = state.snapshot;
    if (next !== undefined) return [];
    if (screen === "menu") return [{ name: "start" }];
    if (screen === "result") return [{ name: "menu" }];
    return TACTICS_PLAY.commands?.(state) ?? [];
  },
};

/**
 * A turn-based skirmish on a 12 × 8 square grid with no physics: the blue
 * side (the player) moves each unit once a turn, then attacks or waits;
 * `end-turn` hands over to the red side, which the game plays on ticks.
 * A menu leads into the levels, and each level's end into a result scene.
 * A listed level autosaves its world at each turn start.
 */
export const tacticsGame = defineGame<TacticsRunSnapshot>({
  id: "tactics",
  // One-metre cells drawn at 48 px each.
  world: {
    physics: "none",
    gravity: [0, 0],
    grid: TACTICS_GRID,
    gridWalls: ["solid"],
    lengthUnit: 48,
  },
  time: { kind: "turns", rate: 60 },
  types: [UNIT_TYPE, ROUGH_TYPE, STAIR_TYPE],
  // The primitives, walls among them, spawn first, so units land on a built board.
  spawnOrder: ["rough", "stair", "unit"],
  actions: TACTICS_ACTIONS,
  commands: { ...TACTICS_COMMANDS, ...TACTICS_FLOW_COMMANDS },
  tables: {
    [UNIT_CLASS_TABLE]: { description: "Stats per unit class.", row: UNIT_CLASS_ROW },
  },
  projectSettings: TACTICS_SETTINGS,
  resolution: {
    virtual: { width: 576, height: 384 },
    fit: "letterbox",
    integer: true,
    sampling: "nearest",
    pixelSnap: true,
  },
  template: TACTICS_TEMPLATE,
  configHash: JSON.stringify({ walkTicks: WALK_TICKS }),
  createRuntime: createTacticsRuntime,
  play,
  persist: { initial: initialProgress, schema: TACTICS_PROGRESS },
  saves: { version: 1 },
});

export { TACTICS_ACTIONS } from "./actions";
export { parseTacticsCommand, TACTICS_COMMANDS, type TacticsCommand } from "./commands";
export { TACTICS_PLAY } from "./play";
export {
  createTacticsRuntime,
  initialProgress,
  MENU_SCENE,
  nextLevel,
  RESULT_SCENE,
  STAIR_TYPE,
  TACTICS_FADE,
  TACTICS_AUTOSAVE_SLOT,
  TACTICS_FELL,
  TACTICS_FLOW_COMMANDS,
  TACTICS_LEVELS,
  TACTICS_OPENED,
  TACTICS_PROGRESS,
  TACTICS_HIT,
  TACTICS_REFUSED,
  TACTICS_SETTINGS,
  TACTICS_TURN,
  UNIT_CLASS_TABLE,
  WALK_TICKS,
  worldBoard,
  type StairEntity,
  type TacticsFlowSlice,
  type TacticsProgress,
  type TacticsRunSnapshot,
  type TacticsScreen,
  type TacticsWalk,
} from "./runtime";
export { TACTICS_TEMPLATE } from "./template";
export {
  BOARD_COLS,
  BOARD_ROWS,
  ROUGH_TYPE,
  STEP_COST,
  TACTICS_GRID,
  TACTICS_SIDES,
  tacticsBoard,
  UNIT_CLASS_ROW,
  UNIT_TYPE,
  type RoughEntity,
  type Side,
  type TacticsBoard,
  type TacticsGridData,
  type TacticsSlice,
  type TacticsSnapshot,
  type UnitClass,
  type UnitClasses,
  type UnitEntity,
  type UnitState,
} from "./types";
