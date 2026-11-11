/**
 * The browser smoke's physics-free run, shared by the page and the runner,
 * which plays it under Bun for the digest every browser must reproduce: a
 * walker stepped cell to cell on a square grid, carrying a motion body on
 * the geometry backend through axis-aligned walls and two sensors, played
 * and replayed headless. Rapier comes only through a counting loader, asked
 * only when the scene's physics resolves to it, so the count shows it was
 * never loaded.
 */
import { createGame } from "@jams/engine";
import {
  createGridStepper,
  createRegistry,
  createMotionBody,
  defineEntityType,
  defineGame,
  pointField,
  SENSOR_ENTER,
  type EngineContext,
  type GameDefinition,
  type GridStepper,
  type MotionBody,
} from "@jams/engine/game";
import {
  replayRecording,
  runPlaytest,
  type InputScript,
  type PlaytestReport,
  type RapierModule,
} from "@jams/engine/headless";
import {
  hashText,
  scenePhysics,
  type ExpandedScene,
  type Pt,
  type SceneDefinition,
} from "@jams/engine/scene";

import { PHYSICS_FREE_RESULT, SHELL_TICKS, type PhysicsFreeRun } from "../browser-compare";

export const GRID_GAME_ID = "smoke-grid";
export const GRID_SCENE = "smoke-grid-yard";
export const WALKER = "walker";
export const GATE = "gate";
export const GOAL = "goal";

/** Metres: 32 px at the default 100 px per metre. */
const CELL = 0.32;
const COLUMNS = 8;
const ROWS = 5;
const MS_PER_STEP = 100;
/** Half the walker's body, metres: smaller than a cell, so it reaches a sensor only on that sensor's cell. */
const BODY_HALF = 0.1;

type Cell = [col: number, row: number];

const DIRECTIONS: Readonly<Record<string, Cell>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

export type GridSnapshot = {
  cell: Cell | null;
  at: { x: number; y: number } | null;
  moving: boolean;
  /** Steps the grid turned down: a wall or the scene's edge in the way. */
  refused: number;
} | null;

const centre = (c: number, r: number): Pt => [c * CELL + CELL / 2, r * CELL + CELL / 2];
const box = (id: string, type: string, c: number, r: number, half: number) => {
  const [x, y] = centre(c, r);
  return { id, type, shape: ["box", x, y, half, half] };
};

const walkerType = defineEntityType({
  type: WALKER,
  description: "Steps one cell per arrow press; carries a motion body that the sensors see.",
  base: "marker",
  fields: { at: pointField("The cell it starts on, by its centre.") },
});

/** A game written only against `@jams/engine/game` that never needs Rapier. */
export const gridGame = defineGame<GridSnapshot>({
  id: GRID_GAME_ID,
  types: [walkerType],
  world: { physics: "none" },
  actions: [
    { action: "left", keys: ["ArrowLeft"], description: "Step left." },
    { action: "right", keys: ["ArrowRight"], description: "Step right." },
    { action: "up", keys: ["ArrowUp"], description: "Step up." },
    { action: "down", keys: ["ArrowDown"], description: "Step down." },
  ],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  play: {
    focus: (s) => s?.at ?? null,
    results: [PHYSICS_FREE_RESULT],
    outcome: ({ events }) => {
      const hit = events.find(
        (e) => e.type === SENSOR_ENTER && e.entityId === GOAL && e.other === WALKER,
      );
      return hit ? { result: PHYSICS_FREE_RESULT, entityId: GOAL } : null;
    },
  },
  createRuntime(ctx: EngineContext) {
    let scene: ExpandedScene | null = null;
    let stepper: GridStepper | null = null;
    let body: MotionBody | null = null;
    let refused = 0;

    // The grid is built after onLoad, so the walker starts on the first tick.
    function start(): boolean {
      if (stepper) return true;
      const grid = ctx.grid;
      const walker = scene?.entities.find((e) => e.type === WALKER);
      if (!grid || !walker) return false;
      const [x, y] = walker.at as Pt;
      body = createMotionBody(
        ctx,
        { id: walker.id, type: walker.type },
        { x, y },
        {
          shape: { type: "box", cx: 0, cy: 0, hw: BODY_HALF, hh: BODY_HALF, rotDeg: 0 },
        },
      );
      stepper = createGridStepper(ctx, walker.id, {
        start: grid.geometry.cellAt([x, y]),
        msPerStep: MS_PER_STEP,
        body,
        occupy: true,
      });
      return true;
    }

    return {
      onLoad(next) {
        scene = next;
      },
      onUnload() {
        scene = null;
        stepper = null;
        body = null;
        refused = 0;
      },
      beforeStep(dtMs, actions) {
        if (!start() || !stepper) return;
        for (const a of actions) {
          const dir = DIRECTIONS[a.action];
          if (!a.pressed || !dir || stepper.moving()) continue;
          const [c, r] = stepper.cell();
          if (!stepper.step([c + dir[0], r + dir[1]])) refused++;
        }
        stepper.update(dtMs);
      },
      snapshot() {
        if (!stepper) return null;
        const [c, r] = stepper.cell();
        return { cell: [c, r], at: body?.position() ?? null, moving: stepper.moving(), refused };
      },
    };
  },
});

/*
 * Columns 0–7 by rows 0–4; W walker, # wall, g the gate sensor, G the goal sensor.
 *
 *   . . . . . . . .
 *   . W . . g . G .
 *   . . # . . . . .
 *   . . . . # . . .
 *   . . . . . . . .
 */
export const gridScene: SceneDefinition = {
  v: 4,
  game: GRID_GAME_ID,
  name: GRID_SCENE,
  bounds: [0, 0, COLUMNS * CELL, ROWS * CELL],
  settings: { physics: "none", grid: { kind: "square", cell: [CELL, CELL] } },
  entities: [
    box("wall-north", "solid", 2, 2, CELL / 2),
    box("wall-south", "solid", 4, 3, CELL / 2),
    box(GATE, "sensor", 4, 1, CELL / 2),
    box(GOAL, "sensor", 6, 1, CELL / 4),
    { id: WALKER, type: WALKER, at: centre(1, 1) },
  ],
};

/** A press, then enough slots for the step it starts to finish. */
const move = (action: string) => [{ press: action }, { wait: 8 }];

/** Down, a refusal at the north wall, round the south one, up and east through the gate onto the goal. */
export const gridScript: InputScript = {
  v: 1,
  steps: [
    ...move("down"),
    ...move("right"),
    ...move("down"),
    ...move("right"),
    ...move("right"),
    ...move("right"),
    ...move("up"),
    ...move("up"),
    ...move("right"),
    ...move("right"),
    ...move("right"),
    { wait: 20 },
  ],
};

/** A Rapier loader that counts its calls. */
export type RapierSpy = { load: () => Promise<RapierModule>; calls: () => number };

export function rapierSpy(load: () => Promise<RapierModule>): RapierSpy {
  let calls = 0;
  return {
    load: () => {
      calls++;
      return load();
    },
    calls: () => calls,
  };
}

function blocked(what: string, run: { stage: string; issues: unknown; scriptIssues: unknown }) {
  return new Error(
    `${what} blocked at ${run.stage}: ${JSON.stringify({ issues: run.issues, scriptIssues: run.scriptIssues })}`,
  );
}

/** What the run is pinned by: how it ended, what it emitted, where the walker went and stood. */
export function physicsFreeDigest(report: PlaytestReport): string {
  return hashText(
    JSON.stringify([
      report.outcome,
      report.ticks,
      report.slots,
      report.recording.end,
      report.events,
      report.trail.pts,
      report.final,
    ]),
  );
}

/** Plays and replays the grid scene headless; Rapier is asked of `load` only for a Rapier scene. */
export async function runPhysicsFree(
  load: () => Promise<RapierModule>,
  scene: SceneDefinition = gridScene,
): Promise<PhysicsFreeRun> {
  const game = gridGame as GameDefinition;
  const physics = scenePhysics(scene, createRegistry(game));
  const rapier = physics === "rapier" ? await load() : null;
  const report = runPlaytest({ rapier, game, scene, script: gridScript });
  if (report.blocked) throw blocked("the physics-free playtest", report);
  const replay = replayRecording({ rapier, game, scene, recording: report.recording });
  if (replay.blocked) throw blocked("the physics-free replay", replay);
  return {
    physics,
    ticks: report.ticks,
    result: report.outcome.result,
    replayMatches: replay.matches,
    digest: physicsFreeDigest(report),
  };
}

/**
 * Starts the grid game in a shell on a canvas, with `load` as its
 * `GameConfig.rapier`, and steps it `SHELL_TICKS` with no key held: the
 * shell must load Rapier neither at start nor for the scene. Resolves how
 * many ticks it stepped.
 */
export async function startPhysicsFree(load: () => Promise<RapierModule>): Promise<number> {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  let game: Awaited<ReturnType<typeof createGame>> | null = null;
  try {
    game = await createGame(canvas, {
      game: gridGame as GameDefinition,
      rapier: load,
      displayWidth: 320,
      displayHeight: 200,
    });
    await game.preload(gridScene);
    const report = game.loadScene(gridScene);
    if (!report.ok) throw new Error(`${GRID_SCENE} didn't load in the shell: ${report.error}`);
    let stepped = 0;
    game.on("scene:step", () => stepped++);
    game.pause();
    game.step(SHELL_TICKS);
    return stepped;
  } finally {
    game?.destroy();
    canvas.remove();
  }
}
