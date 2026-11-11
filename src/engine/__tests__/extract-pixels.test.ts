// @vitest-environment jsdom
import { Rectangle } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRenderer } from "../renderer";
import { DEFAULT_GAME_CONFIG, type GameInstance } from "../types";
import { testGame } from "./fixtures/test-game";

const fake = vi.hoisted(() => ({
  pixels: vi.fn((_opts: unknown) => ({ pixels: new Uint8ClampedArray([10, 20, 30, 255]) })),
}));

// jsdom has no WebGL: the application is a stand-in over a real stage.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    screen = new pixi.Rectangle(0, 0, 0, 0);
    renderer = {
      name: "webgl",
      resize: (w: number, h: number) => {
        this.screen.width = w;
        this.screen.height = h;
      },
      extract: { pixels: fake.pixels },
    };
    async init(opts: { width: number; height: number }) {
      this.screen.width = opts.width;
      this.screen.height = opts.height;
    }
    destroy() {}
  }
  return { ...pixi, Application };
});

let game: GameInstance | null = null;

afterEach(() => {
  game?.destroy();
  game = null;
  fake.pixels.mockClear();
  document.body.replaceChildren();
});

const config = {
  ...DEFAULT_GAME_CONFIG,
  game: testGame,
  displayWidth: 800,
  displayHeight: 600,
  backgroundColor: 0x123456,
};

describe("extractPixels", () => {
  it("reads one 1×1 frame per point at the mapped pixel, at resolution 1 over the background", async () => {
    const renderer = await createRenderer(document.createElement("canvas"), config);
    renderer.worldContainer.position.set(100, 50);
    renderer.worldContainer.scale.set(2);

    const read = renderer.extractPixels([
      { x: 10, y: 20 },
      { x: 10.4, y: 20.9 },
    ]);

    expect(read).toEqual({
      renderer: "webgl",
      pixels: [
        [10, 20, 30, 255],
        [10, 20, 30, 255],
      ],
    });
    expect(fake.pixels).toHaveBeenCalledTimes(2);
    expect(fake.pixels.mock.calls[0]![0]).toEqual({
      target: renderer.app.stage,
      frame: new Rectangle(120, 90, 1, 1),
      resolution: 1,
      clearColor: 0x123456,
    });
    expect(fake.pixels.mock.calls[1]![0]).toMatchObject({ frame: new Rectangle(120, 91, 1, 1) });
    renderer.destroy();
  });

  it("reads null for a point off the canvas without calling extract", async () => {
    const renderer = await createRenderer(document.createElement("canvas"), config);
    renderer.worldContainer.position.set(-50, 0);

    const read = renderer.extractPixels([
      { x: 49, y: 10 },
      { x: 850, y: 10 },
      { x: 60, y: 600 },
      { x: 60, y: -0.5 },
      { x: Number.NaN, y: 10 },
    ]);

    expect(read.pixels).toEqual([null, null, null, null, null]);
    expect(fake.pixels).not.toHaveBeenCalled();
    expect(renderer.extractPixels([{ x: 849, y: 599 }]).pixels).toEqual([[10, 20, 30, 255]]);
    expect(fake.pixels).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it("maps through the game's camera on a GameInstance", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    game = await createGame(canvas, {
      game: testGame,
      displayWidth: 800,
      displayHeight: 600,
      backgroundColor: 0x0a0b0c,
    });
    game.frame({ minX: 10, minY: 4, maxX: 12, maxY: 5 }, 0);
    // The framed rect's centre (metres) sits at the canvas centre.
    const read = game.extractPixels([{ x: 11.0025, y: 4.5025 }]);

    expect(read).toEqual({ renderer: "webgl", pixels: [[10, 20, 30, 255]] });
    expect(fake.pixels).toHaveBeenCalledTimes(1);
    expect(fake.pixels.mock.calls[0]![0]).toMatchObject({
      frame: new Rectangle(400, 300, 1, 1),
      resolution: 1,
      clearColor: 0x0a0b0c,
    });
  });
});
