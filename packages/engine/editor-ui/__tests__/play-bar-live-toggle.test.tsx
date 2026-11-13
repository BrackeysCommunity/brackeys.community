// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGameStore } from "../../store";
import type { EditorControls } from "../frame/keys";
import { HINT_DELAY_MS } from "../kit/hint";
import {
  EditorPlayBar,
  LIVE_PLAY_KEY,
  LIVE_PLAY_SOURCES,
  LIVE_PLAY_TOOLTIP,
} from "../panels/EditorPlayBar";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

const UNAVAILABLE = "Live in Play needs a game; this scene picks up edits at Restart.";

function bar(unavailable: string | null = null) {
  const onLivePlay = vi.fn();
  const controls = {
    game: { getStore: () => createGameStore(), resume: vi.fn(), pause: vi.fn(), step: vi.fn() },
    host: new Store({ sceneChanged: false, livePlay: { on: false, unavailable, status: null } }),
    keymap: { chordOf: () => undefined },
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onLivePlay,
  } as unknown as EditorControls;
  render(<EditorPlayBar {...controls} />);
  const toggle = screen.getByRole("switch", { name: "Live in Play" });
  const text = screen.getByText("Live in Play");
  return { onLivePlay, toggle, text };
}

/** Focuses the switch from the keyboard and waits out the hint's delay. */
function focusForHint(el: HTMLElement) {
  vi.useFakeTimers();
  act(() => {
    fireEvent.keyDown(document.body, { key: "Tab" });
    el.focus();
  });
  act(() => void vi.advanceTimersByTime(HINT_DELAY_MS + 50));
}

describe("the Live in Play toggle", () => {
  it("turns on from its visible label as well as from the switch, once per click", () => {
    const { onLivePlay, toggle, text } = bar();
    expect(text.closest("label")?.htmlFor).toBe(toggle.parentElement?.querySelector("input")?.id);
    fireEvent.click(text);
    expect(onLivePlay).toHaveBeenCalledTimes(1);
    expect(onLivePlay).toHaveBeenLastCalledWith(true);
    expect(localStorage.getItem(LIVE_PLAY_KEY)).toBe("true");
    fireEvent.click(toggle);
    expect(onLivePlay).toHaveBeenCalledTimes(2);
  });

  it("says in its hint where the edits come from while you play", () => {
    const { toggle } = bar();
    focusForHint(toggle);
    const hint = document.querySelector(".je-hint");
    expect(hint?.textContent).toBe(`${LIVE_PLAY_TOOLTIP}. ${LIVE_PLAY_SOURCES}`);
  });

  it("stays focusable but inert where the scene can't take live updates, its reason reachable", () => {
    const { onLivePlay, toggle, text } = bar(UNAVAILABLE);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.tabIndex).toBe(0);
    const reason = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(UNAVAILABLE);
    expect(text.closest("label")).toBeNull();
    fireEvent.click(text);
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: " " });
    expect(onLivePlay).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(LIVE_PLAY_KEY)).toBeNull();
    focusForHint(toggle);
    expect(document.querySelector(".je-hint")?.textContent).toBe(UNAVAILABLE);
  });

  it("keeps its label on one line in a narrow play bar", () => {
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    const rule = /\.je-live-toggle \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("white-space: nowrap");
    expect(rule).toContain("flex-shrink: 0");
  });
});
