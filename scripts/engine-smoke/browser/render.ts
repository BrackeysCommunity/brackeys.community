/**
 * The browser smoke's render runs: the kitchen sink played on a canvas with
 * its textures fetched through the asset loader on the dev URL scheme. First
 * it is stepped once and framed on the crate, then two pixels are read back
 * through `GameInstance.extractPixels` (WebGPU and WebGL alike): one inside
 * the crate's sprite, one in empty air. Then the canvas splits into two
 * viewports, the crate on the left and the animated sprite on the right, and
 * each half's sprite is read, the animated one again a clip frame later.
 */
import { createAssetLoader, createGame, type GameInstance } from "@jams/engine";
import { createRegistry, withProject } from "@jams/engine/game";
import { createKindRegistry, projectView, runtimeView } from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";

import { devAssetUrl } from "../../../packages/engine/editor-ui/connect/dev";
import type { RenderProbe, SplitProbe } from "../browser-compare";
import { smokeGame } from "../game";
import { readProbe, readThrough } from "./pixels";
import type { SinkProjectData } from "./project";
import { loadRapier } from "./run";
import {
  ANIM_FRAME_TICKS,
  ANIM_POINT,
  INSIDE_POINT,
  SINK_CANVAS,
  SINK_DATA_ROUTE,
  SINK_FRAME,
  SINK_PROJECT,
  SINK_SCENE,
  SMOKE_BACKGROUND,
  SPLIT_VIEWPORTS,
} from "./sink";
import { parseSinkScene, sinkPrefabs, withoutCameraRig } from "./sink-prefabs";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function sinkData(): Promise<SinkProjectData> {
  const res = await fetch(SINK_DATA_ROUTE);
  if (!res.ok) throw new Error(`GET ${SINK_DATA_ROUTE} answered ${res.status}`);
  return (await res.json()) as SinkProjectData;
}

export async function runRenderSmoke(): Promise<{ render: RenderProbe; split: SplitProbe }> {
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
      project: runtimeView(view, values, registry, kinds),
      prefabs,
      assets: { loader, view, kinds },
      displayWidth: SINK_CANVAS.width,
      displayHeight: SINK_CANVAS.height,
      backgroundColor: SMOKE_BACKGROUND,
    });
    const { failed } = await game.preload(scene);
    if (failed.length > 0)
      throw new Error(`textures failed to load: ${failed.map((e) => e.id).join(", ")}`);
    const report = game.loadScene(withoutCameraRig(scene, registry, prefabs));
    if (!report.ok) throw new Error(`${SINK_SCENE} didn't load: ${report.error}`);
    game.pause();
    game.step(1);
    game.frame({ ...SINK_FRAME }, 0);
    game.start();
    for (let i = 0; i < 3; i++) await nextFrame();
    const render = readProbe(game);

    return { render, split: await runSplit(game, canvas, scene) };
  } finally {
    game?.destroy();
    loader.destroy();
    canvas.remove();
  }
}

/**
 * The sink as authored on two viewports, each following its own entity
 * through the scene's rig: stepped once, then a clip frame's ticks more while
 * paused, so only the animation changes the right half between its reads.
 */
async function runSplit(
  game: GameInstance,
  canvas: HTMLCanvasElement,
  scene: SceneDefinition,
): Promise<SplitProbe> {
  game.setViewports(SPLIT_VIEWPORTS);
  const report = game.loadScene(scene);
  if (!report.ok) throw new Error(`${SINK_SCENE} didn't load split: ${report.error}`);
  game.pause();
  game.step(1);
  for (let i = 0; i < 3; i++) await nextFrame();
  const crate = readThrough(game, canvas, INSIDE_POINT, 0);
  const before = readThrough(game, canvas, ANIM_POINT, 1);
  game.step(ANIM_FRAME_TICKS);
  for (let i = 0; i < 3; i++) await nextFrame();
  const after = readThrough(game, canvas, ANIM_POINT, 1);
  const { width, height } = canvas.getBoundingClientRect();
  return {
    renderer: crate.renderer,
    width,
    height,
    crate: crate.read,
    anim: [before.read, after.read],
    ticks: ANIM_FRAME_TICKS,
  };
}
