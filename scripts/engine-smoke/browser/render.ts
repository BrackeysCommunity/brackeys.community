/**
 * The browser smoke's render run: the kitchen sink played on a canvas with
 * its textures fetched through the asset loader on the dev URL scheme,
 * stepped once and drawn, then two pixels read back through
 * `GameInstance.extractPixels` (WebGPU and WebGL alike): one inside the
 * crate's sprite, one in empty air.
 */
import { createAssetLoader, createGame, type GameInstance } from "@jams/engine";
import { createRegistry, withProject } from "@jams/engine/game";
import { createKindRegistry, projectView, runtimeView } from "@jams/engine/project";

import { devAssetUrl } from "../../../packages/engine/editor-ui/connect/dev";
import type { RenderProbe } from "../browser-compare";
import { smokeGame } from "../game";
import { readProbe } from "./pixels";
import type { SinkProjectData } from "./project";
import { loadRapier } from "./run";
import {
  SINK_CANVAS,
  SINK_DATA_ROUTE,
  SINK_FRAME,
  SINK_PROJECT,
  SINK_SCENE,
  SMOKE_BACKGROUND,
} from "./sink";
import { parseSinkScene, sinkPrefabs } from "./sink-prefabs";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function sinkData(): Promise<SinkProjectData> {
  const res = await fetch(SINK_DATA_ROUTE);
  if (!res.ok) throw new Error(`GET ${SINK_DATA_ROUTE} answered ${res.status}`);
  return (await res.json()) as SinkProjectData;
}

export async function runRenderSmoke(): Promise<RenderProbe> {
  const data = await sinkData();
  const kinds = createKindRegistry(smokeGame);
  const view = projectView(data.state, kinds);
  const values = new Map(Object.entries(data.values));
  const registry = withProject(createRegistry(smokeGame), view, values);
  const prefabs = sinkPrefabs(view, values, registry);
  const scene = parseSinkScene(values.get(SINK_SCENE), registry, prefabs);

  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const loader = createAssetLoader({ project: SINK_PROJECT, url: devAssetUrl() });
  let game: GameInstance | null = null;
  try {
    game = await createGame(canvas, {
      game: smokeGame,
      registry,
      rapier: loadRapier,
      project: runtimeView(view, values, registry),
      prefabs,
      assets: { loader, view, kinds },
      displayWidth: SINK_CANVAS.width,
      displayHeight: SINK_CANVAS.height,
      backgroundColor: SMOKE_BACKGROUND,
    });
    const { failed } = await game.preload(scene);
    if (failed.length > 0)
      throw new Error(`textures failed to load: ${failed.map((e) => e.id).join(", ")}`);
    const report = game.loadScene(scene);
    if (!report.ok) throw new Error(`${SINK_SCENE} didn't load: ${report.error}`);
    game.pause();
    game.step(1);
    game.frame({ ...SINK_FRAME }, 0);
    game.start();
    for (let i = 0; i < 3; i++) await nextFrame();

    return readProbe(game);
  } finally {
    game?.destroy();
    loader.destroy();
    canvas.remove();
  }
}
