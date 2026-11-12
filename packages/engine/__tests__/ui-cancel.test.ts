// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { commandRunner } from "../editor-ui/frame/keys";
import { createKeymap, type KeyMatch } from "../editor/keymap";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import { parseSceneOrThrow } from "../scene/parse";
import engineYardJson from "../scenes/engine-yard.json";
import type { GameInstance, RapierModule } from "../types";
import { mountUi } from "../ui/layer";
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

const yard = () => parseSceneOrThrow(engineYardJson, createRegistry(testGame));

let rapier: RapierModule;
let game: GameInstance;
let canvas: HTMLCanvasElement;

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(async () => {
  const frame = document.createElement("div");
  canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  document.body.appendChild(frame);
  game = await createGame(canvas, { game: testGame, rapier: async () => rapier, scene: yard() });
  game.stop();
});

afterEach(() => {
  game.destroy();
  document.body.replaceChildren();
});

/** A UI holding a selection that one Escape clears. */
function selectingUi() {
  const ui = { selected: true, cancels: 0 };
  const unmount = mountUi(game, canvas, () => ({
    destroy() {},
    cancel() {
      ui.cancels++;
      if (!ui.selected) return false;
      ui.selected = false;
      return true;
    },
  }));
  return { ui, unmount };
}

const escape = (): KeyMatch => {
  const match = createKeymap().resolve(
    { key: "Escape", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
    { mode: "play", editableTarget: false },
  );
  if (!match) throw new Error("Escape resolves to nothing in play");
  return match;
};

describe("a mounted UI's cancel", () => {
  it("is offered Escape only in play, and keeps play going while it uses it", () => {
    const { ui } = selectingUi();
    expect(game.cancel()).toBe(false);
    expect(ui.cancels).toBe(0);

    game.play(yard());
    expect(game.cancel()).toBe(true);
    expect(game.cancel()).toBe(false);
    expect(ui.cancels).toBe(2);
  });

  it("clears the selection before the editor's Escape stops play", () => {
    const { ui } = selectingUi();
    game.play(yard());
    const onStop = vi.fn(() => game.stop());
    const run = commandRunner(
      { game, onStop, onPlay: () => {}, playHere: () => {} } as unknown as Parameters<
        typeof commandRunner
      >[0],
      null,
    );
    const match = escape();
    expect(match.command).toBe("stop");

    expect(run(match)).toBe(true);
    expect(ui.selected).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
    expect(game.getMode()).toBe("play");

    expect(run(match)).toBe(true);
    expect(onStop).toHaveBeenCalledOnce();
    expect(game.getMode()).toBe("edit");
  });

  it("goes to the newest UI first, and stops being asked once unmounted", () => {
    const first = selectingUi();
    const second = selectingUi();
    game.play(yard());
    expect(game.cancel()).toBe(true);
    expect([first.ui.selected, second.ui.selected]).toEqual([true, false]);

    second.unmount();
    expect(game.cancel()).toBe(true);
    expect(first.ui.selected).toBe(false);
    expect(second.ui.cancels).toBe(1);
    first.unmount();
    expect(game.cancel()).toBe(false);
  });

  it("isn't registered for a UI without one", () => {
    const unmount = mountUi(game, canvas, () => ({ destroy() {} }));
    game.play(yard());
    expect(game.cancel()).toBe(false);
    unmount();
  });
});
