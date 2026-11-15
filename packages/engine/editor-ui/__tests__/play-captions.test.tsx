// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { defineGame } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import type { GameEventMap } from "../../types";
import { SOUND_IN_PLAY_KEY } from "../audio/editor-audio";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import { editorIdentity, openLiveEditor, type LiveEditor } from "../session/live-scene-editor";

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

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

let game: GameInstance | null = null;
let live: LiveEditor | null = null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  live?.destroy();
  game?.destroy();
  live = game = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const withCode = defineGame({
  id: "captioned",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

type CaptionHandler = (payload: GameEventMap["audio:caption"]) => void;

/** The editor on a game, with the sound captions the audio system would raise handed to `caption`. */
async function setup(definition: Parameters<typeof createGame>[1]["game"] = null) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const g = await createGame(canvas, { game: definition, rapier: async () => rapier, dev: true });
  game = g;
  g.start();
  const handlers = new Set<CaptionHandler>();
  const on = g.on;
  const off = g.off;
  vi.spyOn(g, "on").mockImplementation(((event: string, h: CaptionHandler) => {
    if (event === "audio:caption") handlers.add(h);
    else on(event as "audio:caption", h);
  }) as GameInstance["on"]);
  vi.spyOn(g, "off").mockImplementation(((event: string, h: CaptionHandler) => {
    if (event === "audio:caption") handlers.delete(h);
    else off(event as "audio:caption", h);
  }) as GameInstance["off"]);
  const doc = sceneToDoc(
    { v: 4, name: "clinks", bounds: [0, 0, 10, 6], solid: [], entities: [] },
    { key: sequentialKeys("t") },
  );
  live = openLiveEditor({
    game: g,
    doc,
    name: "clinks",
    identity: editorIdentity("Ada"),
    notify,
    issuesDebounceMs: 0,
  });
  const chrome = editorChrome({
    session: live.session,
    host: live.host,
    game: g,
    canvas: () => canvas,
    onPlay: live.play,
    onReplay: live.replay,
    onStop: live.stop,
    onRestart: live.restart,
    notify,
  });
  render(
    <EditorFrame topLeft={null} host={{}} {...chrome}>
      <div />
    </EditorFrame>,
  );
  const caption = (key: string) =>
    act(() => {
      for (const h of handlers) h({ key, at: 0 });
    });
  return { game: g, live, canvas, caption, handlers };
}

const captions = () => document.querySelector("[data-jams-captions]");

describe("captions in the editor's Play", () => {
  it("shows a gameless project's captions while Sound in Play is on, and goes on Stop", async () => {
    localStorage.setItem(SOUND_IN_PLAY_KEY, "true");
    const { game, live, caption } = await setup();
    expect(captions()).toBeNull();

    live.play();
    await waitFor(() => expect(captions()).not.toBeNull());
    caption("clink");
    expect(captions()?.querySelector('[data-jams-caption="clink"]')).not.toBeNull();
    // A preview: the player's own captions choice is left as it was.
    expect(game.captions.enabled()).toBe(false);

    live.stop();
    await waitFor(() => expect(captions()).toBeNull());
  });

  it("shows none while Sound in Play is off", async () => {
    const { live, handlers } = await setup();
    live.play();
    await waitFor(() => expect(live.session.store.state.mode).toBe("play"));
    expect(captions()).toBeNull();
    expect(handlers.size).toBe(0);
  });

  it("leaves a game's captions to its own UI", async () => {
    localStorage.setItem(SOUND_IN_PLAY_KEY, "true");
    const { live, handlers } = await setup(withCode);
    live.play();
    await waitFor(() => expect(live.session.store.state.mode).toBe("play"));
    expect(captions()).toBeNull();
    expect(handlers.size).toBe(0);
  });
});
