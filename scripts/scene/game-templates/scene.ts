import type { SceneTemplate } from "@jams/engine/game";
import type { InputScriptV2 } from "@jams/engine/headless";
import {
  CHECKS_FORMAT_VERSION,
  formatChecks,
  formatInputScript,
  INPUT_SCRIPT_VERSION,
  snapToPixel,
  type ChecksFile,
} from "@jams/engine/scene";

import type { GameNames, GameOptions } from ".";

type Box = ["box", number, number, number, number];

/** Lays out a template in metres, every length on a whole world pixel at `pxPerMetre`. */
function layout(pxPerMetre: number) {
  const m = (n: number): number => snapToPixel(n, pxPerMetre);
  return {
    m,
    box: (cx: number, cy: number, hw: number, hh: number): Box => [
      "box",
      m(cx),
      m(cy),
      m(hw),
      m(hh),
    ],
  };
}

/**
 * The top-down room, 8 × 6 m: a wall down the middle from the top leaves a
 * gap at the bottom, the hero starts top-left and the goal is top-right.
 */
function topDownTemplate(pxPerMetre: number): SceneTemplate {
  const { m, box } = layout(pxPerMetre);
  return {
    bounds: [0, 0, m(8), m(6)],
    solid: [
      box(4, 0.1, 4, 0.1),
      box(4, 5.9, 4, 0.1),
      box(0.1, 3, 0.1, 2.8),
      box(7.9, 3, 0.1, 2.8),
      box(4, 2.1, 0.1, 1.9),
    ],
    entities: [
      { id: "hero", type: "hero", at: [m(1.5), m(1.5)] },
      { id: "goal", type: "sensor", shape: box(6.75, 1.5, 0.9, 0.5), tags: ["goal"] },
    ],
  };
}

/** The board's size in cells. */
export const BOARD = { cols: 10, rows: 8 };
/** Where the hero starts and the goal is, `[col, row]`. */
export const HERO_CELL: [number, number] = [2, 2];
export const GOAL_CELL: [number, number] = [7, 2];
/** The bottom of the dividing wall's gap, the row the path crosses on. */
const GAP_ROW = 5;

/**
 * The grid board, 10 × 8 cells: walls round the edge and a wall down column
 * 5 from row 1 to row 4, so the hero walks down, through the gap and back
 * up to the goal.
 */
function gridTemplate(cell: number, pxPerMetre: number): SceneTemplate {
  const { m, box } = layout(pxPerMetre);
  const { cols, rows } = BOARD;
  const at = (c: number, r: number): [number, number] => [m((c + 0.5) * cell), m((r + 0.5) * cell)];
  const w = cols * cell;
  const h = rows * cell;
  const half = cell / 2;
  return {
    bounds: [0, 0, m(w), m(h)],
    solid: [
      box(w / 2, half, w / 2, half),
      box(w / 2, h - half, w / 2, half),
      box(half, h / 2, half, h / 2 - cell),
      box(w - half, h / 2, half, h / 2 - cell),
      box(5.5 * cell, 3 * cell, half, 2 * cell),
    ],
    entities: [
      { id: "hero", type: "hero", at: at(...HERO_CELL) },
      {
        id: "goal",
        type: "sensor",
        shape: box(...at(...GOAL_CELL), 0.375 * cell, 0.375 * cell),
        tags: ["goal"],
      },
    ],
  };
}

/** What a new scene of the game starts with, and what `scenes/main.json` holds. */
export function sceneTemplateOf(options: GameOptions): SceneTemplate {
  if (options.preset === "top-down") return topDownTemplate(options.lengthUnit);
  return gridTemplate(options.grid?.cell ?? 1, options.lengthUnit);
}

/** `scenes/main.checks.json`: the scene validates, a path joins hero and goal on the grid, and the script wins. */
export function checksFile(options: GameOptions): string {
  const connected = options.preset !== "top-down" && options.physics === "none";
  const file: ChecksFile = {
    v: CHECKS_FORMAT_VERSION,
    checks: [
      { id: "valid", kind: "valid" },
      ...(connected
        ? [{ id: "goal-connected", kind: "connected", from: "hero", to: ["goal"] }]
        : []),
      { id: "goal-reached", kind: "reaches", script: "main.script.json", result: "won" },
    ],
  };
  return formatChecks(file);
}

/** The steps that walk the hero from its start to the goal, preset by preset. */
function stepsOf(options: GameOptions, names: GameNames): unknown[] {
  const reached = { event: `${names.id}:reached` };
  if (options.preset === "top-down") {
    return [
      { set: { move: [0, 1] }, for: 75 },
      { set: { move: [1, 0] }, for: 120 },
      { set: { move: [0, -1] }, until: reached, max: 240 },
    ];
  }
  const [hc] = HERO_CELL;
  const [gc, gr] = GOAL_CELL;
  if (options.preset === "grid") {
    return [
      { set: { move: [0, 1] }, until: { cell: [hc, GAP_ROW] }, max: 240 },
      { set: { move: [1, 0] }, until: { cell: [gc, GAP_ROW] }, max: 240 },
      { set: { move: [0, -1] }, until: reached, max: 240 },
    ];
  }
  const step = (dir: string, n: number) =>
    Array.from({ length: n }, () => ({ command: "step", args: { dir } }));
  // Commands queue while the hero walks; the wait lets the walk play out.
  return [
    ...step("down", GAP_ROW - HERO_CELL[1]),
    ...step("right", gc - hc),
    ...step("up", GAP_ROW - gr),
    { wait: 240 },
  ];
}

/** `scenes/main.script.json`: an input script that reaches the goal. */
export function scriptFile(options: GameOptions, names: GameNames): string {
  const script = {
    $schema: "../input-script.schema.json",
    v: INPUT_SCRIPT_VERSION,
    scene: "main",
    steps: stepsOf(options, names),
  } as unknown as InputScriptV2;
  return formatInputScript(script);
}
