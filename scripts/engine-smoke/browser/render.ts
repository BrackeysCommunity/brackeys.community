/**
 * The browser smoke's render run: the kitchen sink played on a canvas with
 * its textures fetched through the asset loader on the dev URL scheme,
 * stepped once and drawn, then two pixels read back through Pixi's
 * renderer extract (WebGPU and WebGL alike): one inside the crate's sprite,
 * one in empty air.
 */
import { createAssetLoader, createGame } from "@jams/engine";
import { createRegistry, withProject } from "@jams/engine/game";
import { createKindRegistry, projectView, runtimeView } from "@jams/engine/project";
import { parsePrefab, parseSceneOrThrow, type Prefab } from "@jams/engine/scene";
import { Rectangle, type Application } from "pixi.js";

import { devAssetUrl } from "../../../src/engine/editor-ui/connect/dev";
import type { RenderProbe, Rgba } from "../browser-compare";
import { smokeGame } from "../game";
import type { SinkProjectData } from "./project";
import { loadRapier } from "./run";
import {
  INSIDE_POINT,
  OUTSIDE_POINT,
  SINK_CANVAS,
  SINK_DATA_ROUTE,
  SINK_FRAME,
  SINK_PROJECT,
  SINK_SCENE,
  SMOKE_BACKGROUND,
} from "./sink";

type PixiHooks = { __PIXI_APP_INIT__?: (app: Application, version: string) => void };

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function sinkData(): Promise<SinkProjectData> {
  const res = await fetch(SINK_DATA_ROUTE);
  if (!res.ok) throw new Error(`GET ${SINK_DATA_ROUTE} answered ${res.status}`);
  return (await res.json()) as SinkProjectData;
}

/** The app `createGame` builds, caught through Pixi's devtools hook since the instance doesn't expose it. */
function catchApp(): { app: () => Application; release: () => void } {
  const hooks = globalThis as PixiHooks;
  const previous = hooks.__PIXI_APP_INIT__;
  let caught: Application | null = null;
  hooks.__PIXI_APP_INIT__ = (app, version) => {
    caught = app;
    previous?.(app, version);
  };
  return {
    app: () => {
      if (!caught) throw new Error("createGame built no Pixi application");
      return caught;
    },
    release: () => {
      hooks.__PIXI_APP_INIT__ = previous;
    },
  };
}

export async function runRenderSmoke(): Promise<RenderProbe> {
  const data = await sinkData();
  const kinds = createKindRegistry(smokeGame);
  const view = projectView(data.state, kinds);
  const values = new Map(Object.entries(data.values));
  const registry = withProject(createRegistry(smokeGame), view, values);
  const scene = parseSceneOrThrow(values.get(SINK_SCENE), registry);
  const prefabs = new Map<string, Prefab>();
  for (const entry of view.byId.values()) {
    if (entry.kind !== "prefab") continue;
    const read = parsePrefab(values.get(entry.id), registry);
    if (!read.ok) throw new Error(`prefab ${entry.id} doesn't parse: ${read.issues[0]?.message}`);
    prefabs.set(read.prefab.id, read.prefab);
  }

  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const loader = createAssetLoader({ project: SINK_PROJECT, url: devAssetUrl() });
  const hook = catchApp();
  let game: Awaited<ReturnType<typeof createGame>> | null = null;
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
    const app = hook.app();
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

    const world = app.stage.getChildByLabel("world");
    if (!world) throw new Error("the stage has no world container");
    const pixel = ([x, y]: readonly [number, number]): Rgba => {
      const at = world.toGlobal({ x, y });
      const { pixels } = app.renderer.extract.pixels({
        target: app.stage,
        frame: new Rectangle(Math.floor(at.x), Math.floor(at.y), 1, 1),
        resolution: 1,
        clearColor: SMOKE_BACKGROUND,
      });
      return [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0, pixels[3] ?? 0];
    };
    return {
      renderer: app.renderer.name,
      inside: pixel(INSIDE_POINT),
      outside: pixel(OUTSIDE_POINT),
    };
  } finally {
    hook.release();
    game?.destroy();
    loader.destroy();
    canvas.remove();
  }
}
