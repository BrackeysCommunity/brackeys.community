/**
 * The browser smoke's tilemap run: the kitchen sink's tile strip on its own,
 * drawn through the public entries on the sink's square grid and again on a
 * hex grid, each map framed by the camera and read back at a painted cell's
 * centre and an empty cell's.
 */
import type { GameInstance } from "@jams/engine";
import type { SceneDefinition } from "@jams/engine/scene";

import { OFF_CANVAS } from "./pixels";
import { nextFrame, startSinkGame } from "./render";
import { SINK_SCENE } from "./sink";
import { parseSinkScene, withoutCameraRig } from "./sink-prefabs";
import {
  HEX_GRID,
  tilemapPoints,
  tilemapScene,
  type TilemapProbe,
  type TilemapRead,
  type TilemapShape,
} from "./tilemaps";

async function readMap(
  game: GameInstance,
  shape: TilemapShape,
  scene: SceneDefinition,
): Promise<TilemapRead> {
  const [tile, empty] = tilemapPoints(scene).map(([x, y]) => ({ x, y })) as [
    { x: number; y: number },
    { x: number; y: number },
  ];

  const { failed } = await game.preload(scene);
  if (failed.length > 0)
    throw new Error(`the ${shape} map's textures failed: ${failed.map((e) => e.id).join(", ")}`);
  const report = game.loadScene(scene);
  if (!report.ok) throw new Error(`the ${shape} map didn't load: ${report.error}`);
  game.pause();
  game.step(1);
  const pad = 0.5;
  game.frame(
    {
      minX: Math.min(tile.x, empty.x) - pad,
      minY: Math.min(tile.y, empty.y) - pad,
      maxX: Math.max(tile.x, empty.x) + pad,
      maxY: Math.max(tile.y, empty.y) + pad,
    },
    0,
  );
  game.start();
  for (let i = 0; i < 3; i++) await nextFrame();
  const { renderer, pixels } = game.extractPixels([tile, empty]);
  const rgba = (px: TilemapRead["tile"] | null | undefined) =>
    px ? ([px[0], px[1], px[2], px[3]] as const) : OFF_CANVAS;
  return { shape, renderer, tile: rgba(pixels[0]), empty: rgba(pixels[1]) };
}

export async function runTilemapSmoke(): Promise<TilemapProbe> {
  const sink = await startSinkGame();
  try {
    const { game, values, registry, prefabs } = sink;
    const scene = withoutCameraRig(
      parseSinkScene(values.get(SINK_SCENE), registry, prefabs),
      registry,
      prefabs,
    );
    const square = await readMap(game, "square", tilemapScene(scene, undefined));
    const hex = await readMap(game, "hex", tilemapScene(scene, HEX_GRID, [0, 0]));
    return { square, hex };
  } finally {
    sink.destroy();
  }
}
