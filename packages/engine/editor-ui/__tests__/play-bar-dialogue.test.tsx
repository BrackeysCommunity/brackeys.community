// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGameStore } from "../../store";
import type { EditorControls } from "../frame/keys";
import {
  DIALOGUE_PREVIEW_TOOLTIP,
  dialoguePickerHint,
  EditorPlayBar,
} from "../panels/EditorPlayBar";
import { pickSeams } from "./fixtures/play-pick";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

/** A gameless stand-in whose project holds two dialogues. */
function standIn() {
  return {
    ...pickSeams(),
    getStore: () => createGameStore(),
    resume: vi.fn(),
    pause: vi.fn(),
    step: vi.fn(),
    setTimeScale: vi.fn(),
    registry: { game: null },
    on: vi.fn(),
    off: vi.fn(),
    project: () => ({ docs: (kind: string) => (kind === "dialogue" ? ["greeting", "tour"] : []) }),
  };
}

/** A project session holding just the two dialogues' entries, for their labels. */
function session() {
  const entry = (id: string, path: string) => [id, { id, kind: "dialogue", path }] as const;
  return {
    view: () => ({
      byId: new Map([
        entry("greeting", "talk/hello.dialogue.json"),
        entry("tour", "talk/tour.dialogue.json"),
      ]),
    }),
    projectDoc: { on: () => {}, off: () => {} },
  };
}

function bar(project?: { session: ReturnType<typeof session> }) {
  const canvas = document.createElement("div");
  canvas.tabIndex = -1;
  document.body.append(canvas);
  const controls = {
    game: standIn(),
    host: new Store({ sceneChanged: false, livePlay: null }),
    session: {},
    keymap: { chordOf: () => undefined },
    onStop: vi.fn(),
    onRestart: vi.fn(),
    canvas: () => canvas,
    ...(project ? { project } : {}),
  } as unknown as EditorControls;
  render(<EditorPlayBar {...controls} />);
  return { canvas };
}

const picker = () => screen.getByRole("combobox", { name: "Preview a dialogue" });

describe("the play bar's dialogue picker", () => {
  it("is sized by its class, so what it shows never changes its width", () => {
    bar();
    expect(picker().classList.contains("je-play-select")).toBe(true);
    expect(picker().getAttribute("style") ?? "").not.toContain("width");
  });

  it("names the running preview in full in its hint, since the picker may cut it short", () => {
    expect(dialoguePickerHint(null)).toBe(`${DIALOGUE_PREVIEW_TOOLTIP}.`);
    expect(dialoguePickerHint("kitchen")).toBe("Previewing kitchen. Pick it again to start over.");
  });

  it("names each dialogue as the asset pickers do, by its file's stem rather than its id", async () => {
    bar({ session: session() });
    fireEvent.click(picker());
    expect(await screen.findByRole("option", { name: "hello" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "tour" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "greeting" })).toBeNull();
  });

  it("hands focus to the canvas once a dialogue is picked, so Enter moves it on", async () => {
    const { canvas } = bar();
    picker().focus();
    fireEvent.click(picker());
    const option = await screen.findByRole("option", { name: "tour" });
    fireEvent.mouseMove(option);
    fireEvent.click(option);
    await waitFor(() => expect(document.activeElement).toBe(canvas));
  });
});
