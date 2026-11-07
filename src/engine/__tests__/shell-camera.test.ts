// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import { parseSceneOrThrow } from "../scene/parse";
import engineYardJson from "../scenes/engine-yard.json";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));
vi.mock("../assets", () => ({ initAssets: async () => {} }));

const yard = parseSceneOrThrow(engineYardJson, createRegistry(testGame));

let rapier: RapierModule;
let game: GameInstance | null = null;

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(async () => {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  // 1920×1080 at the virtual height: one screen px is one world px at zoom 1.
  game = await createGame(canvas, { game: testGame, rapier: async () => rapier, scene: yard });
  game.stop();
});

afterEach(() => {
  game?.destroy();
  game = null;
  document.body.replaceChildren();
});

const cam = () => game!.getStore().state.camera;

describe("the editor camera", () => {
  it("converts screen px through the camera, centre of the screen at the camera", () => {
    const { position } = cam();
    expect(game!.screenToWorld({ x: 960, y: 540 })).toEqual(position);
    expect(game!.screenToWorld({ x: 960 + 100, y: 540 })).toEqual({
      x: position.x + 100,
      y: position.y,
    });
  });

  it("pans with a drag: the world moves with the pointer, and the store follows", () => {
    const before = cam().position;
    const grabbed = game!.screenToWorld({ x: 900, y: 500 });
    game!.panBy({ x: -80, y: 0 });
    expect(cam().position).toEqual({ x: before.x + 80, y: before.y });
    expect(game!.screenToWorld({ x: 900 - 80, y: 500 })).toEqual(grabbed);
  });

  it("zooms about the pointer, keeping the world point under it", () => {
    const screen = { x: 1100, y: 600 };
    const under = game!.screenToWorld(screen);
    game!.zoomAt(screen, 1.25);
    expect(cam().zoom).toBeCloseTo(1.25);
    const after = game!.screenToWorld(screen);
    expect(after.x).toBeCloseTo(under.x, 6);
    expect(after.y).toBeCloseTo(under.y, 6);
    game!.zoomAt(screen, 0);
    expect(cam().zoom).toBeCloseTo(1.25);
  });

  it("frames a rect, centred and zoomed to fit inside the margin", () => {
    game!.frame({ minX: 1300, minY: 700, maxX: 1700, maxY: 900 }, 40);
    // (1920 − 80) / 400 = 4.6 across, (1080 − 80) / 200 = 5 down: the width decides.
    expect(cam().zoom).toBeCloseTo(4.6);
    expect(cam().position).toEqual({ x: 1500, y: 800 });
    const corner = game!.screenToWorld({ x: 40, y: 540 });
    expect(corner.x).toBeCloseTo(1300, 6);
  });
});
