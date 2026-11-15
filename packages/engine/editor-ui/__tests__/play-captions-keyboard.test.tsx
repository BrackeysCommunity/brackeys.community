// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame, type GameInstance, type RapierModule } from "../../index";
import type { DialogueFile } from "../../project/kinds/dialogue";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { PlayCaptions } from "../panels/play-overlay/PlayCaptions";

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

let game: GameInstance | null = null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  game?.destroy();
  game = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GREETING: DialogueFile = {
  kind: "dialogue",
  v: 1,
  start: "hello",
  nodes: [
    {
      id: "hello",
      lines: [{ say: "Hello there" }, { say: "Can I help?" }],
      choices: [
        { say: "Show me round", to: "tour" },
        { say: "Bye", to: "bye" },
      ],
    },
    { id: "tour", lines: [{ say: "This way" }], end: "toured" },
    { id: "bye", lines: [{ say: "Farewell" }], end: "done" },
  ],
};

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

/** A gameless game previewing "greeting" over a canvas inside a focusable frame, as the editor holds it. */
async function preview() {
  const frame = document.createElement("div");
  frame.tabIndex = -1;
  const canvas = document.createElement("canvas");
  frame.append(canvas);
  document.body.append(frame);
  const g = await createGame(canvas, {
    game: null,
    rapier: async () => rapier,
    reducedMotion: true,
  });
  game = g;
  vi.spyOn(g, "project").mockReturnValue(withGreeting);
  g.start();
  const ended = vi.fn();
  render(
    <PlayCaptions
      game={g}
      canvas={() => canvas}
      dialogue={{ id: "greeting", run: 1 }}
      onDialogueEnd={ended}
    />,
  );
  await waitFor(() => expect(box()?.hidden).toBe(false));
  return { frame, canvas, ended };
}

const box = () => document.querySelector<HTMLElement>("[data-jams-dialogue]");
const lineText = () => box()?.querySelector("[data-jams-dialogue-line]")?.textContent;
const choices = () => [...(box()?.querySelectorAll("button") ?? [])];
const press = (target: EventTarget, key: string, code: string) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }),
    );
  });

describe("a gameless project's dialogue preview from the keyboard", () => {
  it("advances on Enter, moves through the focused choices with the arrows and picks on Enter", async () => {
    const { frame, canvas, ended } = await preview();
    // The engine's default actions keep Space and the arrows: jump and move.
    const keys = Object.values(game!.input.bindings()).flatMap((list) =>
      list.flatMap((b) => (b.device === "key" ? [b.code] : [])),
    );
    expect(keys).toEqual(expect.arrayContaining(["Space", "ArrowUp", "ArrowDown"]));
    expect(keys).not.toContain("Enter");
    expect(lineText()).toBe("Hello there");

    // The editor leaves focus on the frame that holds the canvas.
    frame.focus();
    press(frame, "Enter", "Enter");
    expect(lineText()).toBe("Can I help?");
    // Space stays the game's jump.
    press(frame, " ", "Space");
    expect(lineText()).toBe("Can I help?");

    // The choices take focus as they appear, and the arrows move between them there.
    await waitFor(() => expect(choices()).toHaveLength(2));
    expect(document.activeElement).toBe(choices()[0]);
    press(document.activeElement!, "ArrowDown", "ArrowDown");
    expect(document.activeElement).toBe(choices()[1]);
    press(document.activeElement!, "ArrowUp", "ArrowUp");
    press(document.activeElement!, "ArrowDown", "ArrowDown");

    // From the canvas the arrows still move the selection, though the default `move` uses them.
    canvas.focus();
    press(canvas, "ArrowUp", "ArrowUp");
    expect(document.activeElement).toBe(choices()[0]);
    expect(choices()[0]!.hasAttribute("data-selected")).toBe(true);
    frame.focus();
    press(frame, "ArrowDown", "ArrowDown");
    expect(document.activeElement).toBe(choices()[1]);
    expect(choices()[0]!.hasAttribute("data-selected")).toBe(false);

    // Enter from the canvas picks the selected choice.
    canvas.focus();
    press(canvas, "Enter", "Enter");
    await waitFor(() => expect(lineText()).toBe("Farewell"));

    press(canvas, "Enter", "Enter");
    await waitFor(() => expect(box()?.hidden).toBe(true));
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
