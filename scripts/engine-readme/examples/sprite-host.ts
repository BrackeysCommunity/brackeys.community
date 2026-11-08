import { createAssetLoader, createGame, type AssetUrl, type GameInstance } from "@jams/engine";
import type { KindRegistry, ProjectView } from "@jams/engine/project";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

/** The dev server's blob route; a hosted build points at its own. */
const devUrl: AssetUrl = (project, entry) => `/__project/${project}/blob/${entry.sha256}`;

export async function startWithArt(
  canvas: HTMLCanvasElement,
  sceneText: string,
  project: { id: string; view: () => ProjectView; kinds: KindRegistry },
): Promise<GameInstance> {
  const loader = createAssetLoader({ project: project.id, url: devUrl });
  const game = await createGame(canvas, {
    game: coinGame,
    rapier: () => import("@dimforge/rapier2d"),
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    assets: {
      loader,
      kinds: project.kinds,
      // Read at each bundle, so a live project's latest assets count.
      get view() {
        return project.view();
      },
    },
  });
  const scene = parseSceneOrThrow(sceneText, game.registry);
  const { failed } = await game.preload(scene, (p) => {
    console.log(`art ${p.loaded}/${p.total} (${p.bytes} of ${p.totalBytes} bytes)`);
  });
  // A failed texture draws its fallback box; the scene still loads.
  for (const entry of failed) console.warn(`couldn't load ${entry.id}`);
  const report = game.loadScene(scene);
  if (!report.ok) throw new Error(`the scene didn't load: ${report.error}`);
  game.start();
  return game;
}
