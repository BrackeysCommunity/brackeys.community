// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { defineGame } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import type { DialogueFile } from "../../project/kinds/dialogue";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import type { GameEventMap, GameStoreState } from "../../types";
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

const GREETING: DialogueFile = {
  kind: "dialogue",
  v: 1,
  start: "hello",
  nodes: [
    {
      id: "hello",
      lines: [{ say: "Hello there" }],
      choices: [
        { say: "Show me round", to: "tour", do: [{ set: "/toured", to: true }] },
        { say: "Bye", to: "bye" },
      ],
    },
    { id: "tour", lines: [{ say: "This way" }], end: "toured" },
    { id: "bye", lines: [{ say: "Farewell" }], end: "done" },
  ],
};

/** A project runtime view holding only `GREETING`, as "greeting". */
const withGreeting: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: ((kind: string, id: string) =>
    kind === "dialogue" && id === "greeting" ? GREETING : undefined) as ProjectRuntimeView["doc"],
  docs: (kind) => (kind === "dialogue" ? ["greeting"] : []),
};

/** The editor on a game, with the sound captions the audio system would raise handed to `caption`. */
async function setup(
  definition: Parameters<typeof createGame>[1]["game"] = null,
  project: ProjectRuntimeView | null = null,
) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const g = await createGame(canvas, {
    game: definition,
    rapier: async () => rapier,
    dev: true,
    reducedMotion: true,
  });
  game = g;
  if (project) vi.spyOn(g, "project").mockReturnValue(project);
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
const box = () => document.querySelector<HTMLElement>("[data-jams-dialogue]");
const lineText = () => box()?.querySelector("[data-jams-dialogue-line]")?.textContent;

describe("captions in the editor's Play", () => {
  it("shows a gameless project's captions with Sound in Play off, and goes on Stop", async () => {
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

  it("leaves a game's captions and dialogue to its own UI", async () => {
    const { live, handlers } = await setup(withCode, withGreeting);
    live.play();
    await waitFor(() => expect(live.session.store.state.mode).toBe("play"));
    expect(captions()).toBeNull();
    expect(box()).toBeNull();
    expect(handlers.size).toBe(0);
    expect(screen.queryByRole("combobox", { name: "Preview a dialogue" })).toBeNull();
  });
});

describe("dialogue in the editor's Play", () => {
  it("previews a gameless project's dialogue from the play bar, leaving the run alone", async () => {
    const { game, live } = await setup(null, withGreeting);
    const send = vi.spyOn(game, "send");
    live.play();
    await waitFor(() => expect(box()).not.toBeNull());
    expect(box()?.hidden).toBe(true);

    const picker = screen.getByRole("combobox", { name: "Preview a dialogue" });
    fireEvent.click(picker);
    const option = await screen.findByRole("option", { name: "greeting" });
    fireEvent.mouseMove(option);
    fireEvent.click(option);
    await waitFor(() => expect(box()?.hidden).toBe(false));
    expect(lineText()).toBe("Hello there");
    expect(screen.getByRole("combobox", { name: "Preview a dialogue" }).textContent).toContain(
      "greeting",
    );

    fireEvent.click(box()!);
    const choice = await waitFor(() => {
      const found = [...box()!.querySelectorAll("button")].find(
        (b) => b.textContent === "Show me round",
      );
      expect(found).toBeDefined();
      return found!;
    });
    fireEvent.click(choice);
    await waitFor(() => expect(lineText()).toBe("This way"));

    fireEvent.click(box()!);
    await waitFor(() => expect(box()?.hidden).toBe(true));
    expect(screen.getByRole("combobox", { name: "Preview a dialogue" }).textContent).toContain(
      "Dialogue",
    );
    // The preview ran its own copy: nothing reached the run or its store.
    expect(send).not.toHaveBeenCalled();
    expect(game.getStore().state.dialogue).toBeNull();
  });

  it("shows a conversation the run starts, and sends the run its commands", async () => {
    const { game, live } = await setup();
    const send = vi.spyOn(game, "send").mockReturnValue(true);
    live.play();
    await waitFor(() => expect(box()).not.toBeNull());
    const view: NonNullable<GameStoreState["dialogue"]> = {
      dialogue: "greeting",
      node: "hello",
      line: 0,
      current: { say: "From a script" },
      choices: null,
      log: [{ node: "hello", line: 0, say: "From a script" }],
      ended: null,
    };
    act(() => game.getStore().setState((s) => ({ ...s, dialogue: view })));
    await waitFor(() => expect(lineText()).toBe("From a script"));
    fireEvent.click(box()!);
    expect(send).toHaveBeenCalledWith({ name: "@dialogue-advance" });
  });

  it("offers no preview without a dialogue in the project", async () => {
    const { live } = await setup();
    live.play();
    await waitFor(() => expect(box()).not.toBeNull());
    expect(screen.queryByRole("combobox", { name: "Preview a dialogue" })).toBeNull();
  });
});
