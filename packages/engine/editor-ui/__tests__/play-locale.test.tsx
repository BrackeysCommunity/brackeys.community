// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
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
});

/** The editor on a gameless game whose project offers English and French. */
async function setup() {
  const canvas = document.createElement("canvas");
  canvas.tabIndex = -1;
  document.body.append(canvas);
  const g = await createGame(canvas, { game: null, rapier: async () => rapier, dev: true });
  game = g;
  g.start();
  let current = "en";
  vi.spyOn(g.locale, "current").mockImplementation(() => current);
  vi.spyOn(g.locale, "available").mockImplementation(() => ["en", "fr"]);
  const set = vi.spyOn(g.locale, "set").mockImplementation((to) => {
    current = to;
  });
  const doc = sceneToDoc(
    { v: 4, name: "words", bounds: [0, 0, 10, 6], solid: [], entities: [] },
    { key: sequentialKeys("t") },
  );
  live = openLiveEditor({
    game: g,
    doc,
    name: "words",
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
  return { game: g, live, set, canvas, current: () => current };
}

const picker = () => screen.getByRole("combobox", { name: "Locale" });

describe("the play bar's locale picker", () => {
  it("previews a locale in Play, and Stop puts back the one Play started in", async () => {
    const { game, live, set, current } = await setup();
    live.play();
    await waitFor(() => expect(picker().textContent).toBe("en"));

    fireEvent.click(picker());
    const french = await screen.findByRole("option", { name: "fr" });
    fireEvent.mouseMove(french);
    fireEvent.click(french);
    await waitFor(() => expect(current()).toBe("fr"));

    live.stop();
    await waitFor(() => expect(game.getStore().state.mode).toBe("edit"));
    expect(current()).toBe("en");
    expect(set).toHaveBeenLastCalledWith("en");

    live.play();
    await waitFor(() => expect(picker().textContent).toBe("en"));
  });

  it("hands focus to the canvas once a locale is picked, so the play keys reach the game", async () => {
    const { live, canvas } = await setup();
    live.play();
    await waitFor(() => picker());
    picker().focus();
    fireEvent.click(picker());
    const french = await screen.findByRole("option", { name: "fr" });
    fireEvent.mouseMove(french);
    fireEvent.click(french);
    await waitFor(() => expect(document.activeElement).toBe(canvas));
  });

  it("leaves the locale alone on a Stop when Play never changed it", async () => {
    const { live, set } = await setup();
    live.play();
    await waitFor(() => picker());
    live.stop();
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull());
    expect(set).not.toHaveBeenCalled();
  });

  it("is the bar's small size, as its Stop button and switch labels are", async () => {
    const { live } = await setup();
    live.play();
    await waitFor(() => expect(picker().getAttribute("data-size")).toBe("sm"));
    expect(screen.getByRole("button", { name: "Stop" }).getAttribute("data-size")).toBe("sm");
  });
});
