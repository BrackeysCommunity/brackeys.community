// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../../game/define";
import type { GameCommand, PlayWorld } from "../../game/types";
import type { Cell } from "../../grid/geometry";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { playWorld } from "../../runtime/play-session";
import { expandScene } from "../../scene/expand";
import { parseSceneOrThrow } from "../../scene/parse";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import { createHeadlessRuntime, runProbe } from "../headless";
import { legalCommands, startState } from "../legal";

/**
 * A board game whose legal list comes from the world alone: a `step` to each
 * passable neighbour of every marker on the grid, as many as the project's
 * `reach` setting allows, and a `ring` per row of its `bells` table. Its
 * snapshot carries nothing.
 */
function legalFromWorld(world: PlayWorld): GameCommand[] {
  const grid = world.grid;
  const out: GameCommand[] = [];
  if (grid) {
    const reach = (world.project?.settings.reach as number | undefined) ?? 4;
    for (const id of world.select?.({ type: "marker" }) ?? []) {
      const at = world.get?.(id)?.at as [number, number] | undefined;
      if (!at) continue;
      const [c, r] = grid.geometry.cellAt(at);
      const around: Cell[] = [
        [c, r - 1],
        [c + 1, r],
        [c, r + 1],
        [c - 1, r],
      ];
      for (const to of around.filter((n) => grid.passable(n)).slice(0, reach))
        out.push({ name: "step", args: { id, to } });
    }
  }
  for (const row of world.project?.table("bells") ?? [])
    out.push({ name: "ring", args: { bell: row.id } });
  return out;
}

const boardGame = defineGame<null>({
  id: "board-game",
  types: [],
  actions: [],
  commands: {
    step: {
      description: "Steps a marker one cell.",
      args: z.object({ id: z.string(), to: z.tuple([z.number(), z.number()]) }),
    },
    ring: { description: "Rings a bell.", args: z.object({ bell: z.string() }) },
  },
  createRuntime: () => ({ snapshot: () => null }),
  play: { commands: ({ world }) => legalFromWorld(world) },
});

const registry = createRegistry(boardGame);

const sceneText = (grid: boolean) =>
  JSON.stringify({
    v: SCENE_FORMAT_VERSION,
    game: boardGame.id,
    name: grid ? "board" : "plain",
    bounds: [0, 0, 4, 3],
    settings: {
      physics: "none",
      ...(grid ? { grid: { kind: "square", cell: [1, 1] } } : {}),
    },
    entities: [
      { id: "wall", type: "solid", shape: ["box", 2.5, 1.5, 0.5, 0.5] },
      { id: "pawn", type: "marker", at: [1.5, 1.5] },
    ],
  });

const scene = (grid = true) => expandScene(parseSceneOrThrow(sceneText(grid), registry), registry);

const project = (reach: number, bells: string[]): ProjectRuntimeView => ({
  settings: { reach },
  engine: {},
  table: (name) => (name === "bells" ? bells.map((id) => Object.freeze({ id })) : []),
  asset: () => undefined,
  inputMap: null,
});

const steps = (cells: Cell[]) => cells.map((to) => ({ name: "step", args: { id: "pawn", to } }));

describe("legal commands read the world", () => {
  it("lists from the loaded grid and the run's project before the first tick", () => {
    const rt = createHeadlessRuntime({
      game: boardGame,
      registry,
      scene: scene(),
      project: project(4, ["north"]),
    });
    const state = startState(rt);
    expect(state.world.grid?.bounds).toEqual({ c0: 0, r0: 0, c1: 3, r1: 2 });
    expect(state.world.project?.settings).toEqual({ reach: 4 });
    // [2, 1] is the wall's cell.
    expect(legalCommands(boardGame.play, state)).toEqual({
      legal: [
        ...steps([
          [1, 0],
          [1, 2],
          [0, 1],
        ]),
        { name: "ring", args: { bell: "north" } },
      ],
    });
    rt.destroy();
  });

  it("follows the project's settings and tables, and has no grid without one", () => {
    const rt = createHeadlessRuntime({
      game: boardGame,
      registry,
      scene: scene(),
      project: project(1, []),
    });
    expect(legalCommands(boardGame.play, startState(rt))?.legal).toEqual(steps([[1, 0]]));
    expect(rt.load(scene(false)).ok).toBe(true);
    const world = startState(rt).world;
    expect(world.grid).toBeNull();
    expect(legalCommands(boardGame.play, startState(rt))).toEqual({ legal: [] });
    rt.destroy();

    const bare = createHeadlessRuntime({ game: boardGame, registry, scene: scene() });
    expect(startState(bare).world.project).toBeNull();
    expect(legalCommands(boardGame.play, startState(bare))?.legal).toHaveLength(3);
    bare.destroy();
  });

  it("reads the world live: one world object across loads", () => {
    const rt = createHeadlessRuntime({ game: boardGame, registry, scene: scene() });
    const world = playWorld(rt.ctx);
    expect(world.grid).not.toBeNull();
    expect(world.select?.({ type: "marker" })).toEqual(["pawn"]);
    expect(world.get?.("pawn")).toMatchObject({ type: "marker", at: [1.5, 1.5] });
    expect(rt.load(scene(false)).ok).toBe(true);
    expect(world.grid).toBeNull();
    rt.destroy();
  });

  it("reaches a probe's report after its ticks", () => {
    const report = runProbe({
      game: boardGame,
      registry,
      scene: scene(),
      project: project(2, ["south"]),
      ticks: 3,
    });
    expect(report.legal).toEqual([
      ...steps([
        [1, 0],
        [1, 2],
      ]),
      { name: "ring", args: { bell: "south" } },
    ]);
  });
});
