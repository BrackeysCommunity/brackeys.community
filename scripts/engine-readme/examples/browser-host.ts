import { createGame, type GameInstance } from "@jams/engine";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

export async function startCoinGame(
  canvas: HTMLCanvasElement,
  sceneText: string,
  dev: boolean,
): Promise<GameInstance> {
  // Imported only in dev, so a production bundle never holds the overlay.
  const debug = dev ? (await import("@jams/engine/debug")).createDebugOverlay : undefined;
  const game = await createGame(canvas, {
    game: coinGame,
    rapier: () => import("@dimforge/rapier2d"),
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    dev,
    debug,
  });
  const report = game.loadScene(parseSceneOrThrow(sceneText, game.registry));
  if (!report.ok) throw new Error(`the scene didn't load: ${report.error}`);
  game.start();
  return game;
}
