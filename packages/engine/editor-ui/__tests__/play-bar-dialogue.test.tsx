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

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

/** A gameless stand-in whose project holds two dialogues. */
function standIn() {
  return {
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

function bar() {
  const canvas = document.createElement("div");
  canvas.tabIndex = -1;
  document.body.append(canvas);
  const controls = {
    game: standIn(),
    host: new Store({ sceneChanged: false, livePlay: null }),
    keymap: { chordOf: () => undefined },
    onStop: vi.fn(),
    onRestart: vi.fn(),
    canvas: () => canvas,
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
    expect(dialoguePickerHint("kitchen-dialogue")).toBe(
      "Previewing kitchen-dialogue. Pick it again to start over.",
    );
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
