/**
 * The sign run: the sign scene played on a canvas over the sink project the
 * runner gave two fonts, each sign framed in turn and a grid of pixels read
 * over it until it shows its colour or the wait runs out. Fonts load after
 * the scene does, so the first frames may show no text yet.
 */
import type { GameInstance } from "@jams/engine";
import type { ProjectView } from "@jams/engine/project";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { countSign, type SignProbe, type SignRead } from "./media-compare";
import { nextFrame, startSinkGame } from "./render";
import {
  SIGN_BITMAP_PATH,
  SIGN_WAIT_MS,
  SIGN_WEB_PATH,
  signGrid,
  SIGNS,
  signSceneJson,
  type SignFont,
} from "./signs";

const READ_EVERY_MS = 100;

function fontId(view: ProjectView, path: string): string {
  const entry = view.byPath.get(path);
  if (entry?.kind !== "font") throw new Error(`the sink project has no font at ${path}`);
  return entry.id;
}

async function readSign(game: GameInstance, font: SignFont, since: number): Promise<SignRead> {
  const { frame } = SIGNS[font];
  const points = signGrid(frame);
  const deadline = performance.now() + SIGN_WAIT_MS;
  game.frame({ ...frame }, 0);
  for (;;) {
    for (let i = 0; i < 2; i++) await nextFrame();
    const { renderer, pixels } = game.extractPixels(points);
    const read = countSign(font, renderer, pixels, Math.round(performance.now() - since));
    if (read.lit > 0 || performance.now() >= deadline) return read;
    await new Promise((resolve) => setTimeout(resolve, READ_EVERY_MS));
  }
}

function loadedFaces(): number {
  let loaded = 0;
  document.fonts.forEach((face) => {
    if (face.status === "loaded") loaded++;
  });
  return loaded;
}

export async function runSignSmoke(): Promise<SignProbe> {
  const sink = await startSinkGame();
  try {
    const { game, view, registry, prefabs } = sink;
    const fonts = { bitmap: fontId(view, SIGN_BITMAP_PATH), web: fontId(view, SIGN_WEB_PATH) };
    const scene = parseSceneOrThrow(signSceneJson(fonts), registry, {
      prefab: (id) => prefabs.get(id),
    });
    const { failed } = await game.preload(scene);
    if (failed.length > 0)
      throw new Error(`the signs' assets failed to load: ${failed.map((e) => e.id).join(", ")}`);
    const report = game.loadScene(scene);
    if (!report.ok) throw new Error(`the sign scene didn't load: ${report.error}`);
    const since = performance.now();
    game.pause();
    game.step(1);
    game.start();
    const bitmap = await readSign(game, "bitmap", since);
    const web = await readSign(game, "web", since);
    return { bitmap, web, loadedFaces: loadedFaces() };
  } finally {
    sink.destroy();
  }
}
