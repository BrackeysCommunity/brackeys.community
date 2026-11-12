// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import type { SceneDefinition } from "../../editor/index";
import { defineGame } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import { editorIdentity, openLiveEditor, type LiveEditor } from "../session/live-scene-editor";
import { carry, restore } from "../session/use-scene-editor";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

const plainGame = defineGame({
  id: "rebuild-tool",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

const yard: SceneDefinition = {
  v: 1,
  name: "rebuild-yard",
  bounds: [0, 0, 2000, 1200],
  solid: [["box", 500, 1040, 500, 20]],
};

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

let game: GameInstance | null = null;
const opened: LiveEditor[] = [];
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  for (const live of opened.splice(0)) live.destroy();
  game?.destroy();
  game = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a game rebuild", () => {
  it("starts the next editor's tool host on the tool the last one had", async () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const g = await createGame(canvas, {
      game: plainGame,
      rapier: async () => rapier,
      keyTarget: window,
      displayWidth: window.innerWidth,
      displayHeight: window.innerHeight,
      dev: true,
    });
    game = g;
    g.start();
    const doc = sceneToDoc(yard, { key: sequentialKeys("t") });
    const open = () => {
      const live = openLiveEditor({
        game: g,
        doc,
        name: "rebuild-yard",
        identity: editorIdentity("Ada"),
        notify,
        issuesDebounceMs: 0,
      });
      opened.push(live);
      return live;
    };
    const frame = (live: LiveEditor) => (
      <EditorFrame
        topLeft={null}
        {...editorChrome({
          session: live.session,
          host: live.host,
          game: g,
          onPlay: live.play,
          onReplay: live.replay,
          onStop: live.stop,
          onRestart: live.restart,
          notify,
          canvas: () => canvas,
        })}
      >
        <div />
      </EditorFrame>
    );

    const first = open();
    const view = render(frame(first));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    expect(first.session.store.state.tool).toBe("box");

    const kept = carry(first, "rebuild-yard");
    view.rerender(<div />);
    first.destroy();
    opened.splice(opened.indexOf(first), 1);

    const next = open();
    restore(next, kept);
    view.rerender(frame(next));
    await act(async () => {});

    expect(next.session.store.state.tool).toBe("box");
    expect(screen.getByRole("button", { name: "Box" }).getAttribute("aria-pressed")).toBe("true");
  });
});
