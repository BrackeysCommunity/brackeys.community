// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { ProjectRuntimeView } from "../project/runtime-view";
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

const yard = parseSceneOrThrow(engineYardJson, createRegistry(testGame));

let rapier: RapierModule;
let game: GameInstance | null = null;

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(async () => {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  // 1920×1080 at the default 1080-unit height: one screen px is one world px at zoom 1.
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

describe("a letterboxed shell", () => {
  async function letterboxed(project?: ProjectRuntimeView) {
    game?.destroy();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    game = await createGame(canvas, {
      game: { ...testGame, resolution: { virtual: { width: 800, height: 800 }, fit: "crop" } },
      rapier: async () => rapier,
      scene: yard,
      displayWidth: 2560,
      displayHeight: 1080,
      resolution: { fit: "letterbox" },
      ...(project ? { project } : {}),
    });
    game.stop();
    return game;
  }

  it("takes the host's fit over the game's, and maps screen px through the bars", async () => {
    const g = await letterboxed();
    // 1080 / 800 across the 800×800 area; pillars of (2560 − 1080) / 2 = 740 px.
    const scale = 1080 / 800;
    expect(cam().scale).toBeCloseTo(scale);
    const { position } = cam();
    expect(g.screenToWorld({ x: 1280, y: 540 })).toEqual(position);
    const left = g.screenToWorld({ x: 740, y: 540 });
    expect(left.x).toBeCloseTo(position.x - 400, 6);
  });

  it("pans and zooms by the viewport's scale", async () => {
    const g = await letterboxed();
    const scale = cam().scale;
    const before = cam().position;
    g.panBy({ x: -27, y: 0 });
    expect(cam().position.x).toBeCloseTo(before.x + 27 / scale, 6);
    const screen = { x: 1000, y: 300 };
    const under = g.screenToWorld(screen);
    g.zoomAt(screen, 1.5);
    expect(cam().scale).toBeCloseTo(scale * 1.5);
    const after = g.screenToWorld(screen);
    expect(after.x).toBeCloseTo(under.x, 6);
    expect(after.y).toBeCloseTo(under.y, 6);
  });

  it("reads the project's engine.resolution between the host's and the game's", async () => {
    const project: ProjectRuntimeView = {
      settings: {},
      engine: { resolution: { virtual: { width: 400, height: 200 }, fit: "crop" } },
      table: () => [],
      asset: () => undefined,
    };
    await letterboxed(project);
    // The host's letterbox over the project's 400×200: 2560 / 400 = 6.4 across, 1080 / 200 = 5.4 down.
    expect(cam().scale).toBeCloseTo(5.4);
  });
});
