import {
  createRegistry,
  decodeCell,
  defineGame,
  encodeCell,
  transformCell,
  type TilesetFile,
} from "@jams/engine/game";
import { createHeadlessRuntime, memoryRuntimeView } from "@jams/engine/headless";
import { expandScene, paintGrid, type SceneDefinition } from "@jams/engine/scene";

/** 1 m cells drawn from 16 px tiles: the game's px per metre is the tile size. */
export const tileGame = defineGame({
  id: "tiles",
  types: [],
  actions: [],
  world: { physics: "none", lengthUnit: 16 },
  createRuntime: () => ({ snapshot: () => null }),
});

/** A 64×32 px sheet: rock (0), moss (1, 2, 3) and a plank (4). */
export const caveTiles: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "cave-sheet",
  tile: [16, 16],
  columns: 4,
  tiles: [
    { id: 0, solid: true, tags: ["rock"] },
    { id: 1, solid: true, tags: ["moss"] },
    { id: 2, solid: true, tags: ["moss"] },
    { id: 3, solid: true, tags: ["moss"] },
    { id: 4, oneWay: "up", tags: ["plank"] },
  ],
  rules: [
    // edge16: a moss cell's tile by which of its four sides touch moss.
    {
      id: "moss",
      kind: "edge16",
      terrain: "moss",
      tiles: { "4": 2, "64": 3, "68": 1 },
      fallback: 1,
    },
  ],
};

const ROCK = encodeCell({ id: 0, flipX: false, flipY: false, flipD: false });
const MOSS = encodeCell({ id: 1, flipX: false, flipY: false, flipD: false });

/** A 12-cell corridor: rock above and below, nothing between. */
export const corridor: SceneDefinition = {
  v: 5,
  game: "tiles",
  name: "corridor",
  bounds: [0, 0, 12, 5],
  settings: { grid: { kind: "square", cell: [1, 1] } },
  entities: [
    {
      id: "walls",
      type: "tilemap",
      at: [0, 0],
      tileset: "cave",
      cells: paintGrid(
        {},
        {
          rects: [
            [0, 0, 11, 0, ROCK],
            [0, 4, 11, 4, ROCK],
          ],
        },
      ).grid,
    },
  ],
};

/** Knocks a hole in the floor, lays a moss ledge and autotiles it, then reads the map back. */
export function digCorridor() {
  const registry = createRegistry(tileGame);
  const project = {
    ...memoryRuntimeView({ docs: { tileset: { cave: caveTiles } } }),
    asset: (id: string) =>
      id === "cave-sheet"
        ? {
            id,
            kind: "texture" as const,
            sha256: "a".repeat(64),
            size: [64, 32] as [number, number],
          }
        : undefined,
  };
  const run = createHeadlessRuntime({
    game: tileGame,
    registry,
    scene: expandScene(corridor, registry),
    project,
  });
  const solidAt = (col: number, row: number) =>
    run.ctx.space.pointAt({ x: col + 0.5, y: row + 0.5 }).length > 0;

  run.ctx.tiles.paint("walls", { cells: [[5, 4, 0]], rects: [[3, 2, 5, 2, MOSS]] });
  run.ctx.tiles.autotile("walls", "moss", { c0: 3, r0: 2, c1: 5, r1: 2 });
  // Reads see a write at once; colliders rebuild at the end of the tick.
  const holeBeforeStep = solidAt(5, 4);
  run.step(run.ctx.time.tickMs, []);

  const ledge = [3, 4, 5].map((col) => decodeCell(run.ctx.tiles.get("walls", [col, 2]))?.id);
  // A quarter turn clockwise of a plain tile is Tiled's H|D flags.
  const turned = decodeCell(transformCell(ROCK, { rot: 1, flip: false }));
  const result = {
    holeBeforeStep,
    holeAfterStep: solidAt(5, 4),
    ledge,
    mossCells: run.ctx.tiles.find("walls", "moss").length,
    top: run.ctx.tiles.at([4, 2])[0]?.def?.tags,
    turned,
  };
  run.destroy();
  return result;
}
