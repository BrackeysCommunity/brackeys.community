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
import { LIVE_PLAY_IDLE, livePlayPending } from "../panels/LiveInPlayStatus";
import { LIVE_PLAY_NOT_APPLIED, type LivePlayStatus } from "../session/live-scene-editor";

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

  it("keeps its hint shut once flipped, so the status above the bar stays readable, until the pointer leaves", () => {
    const { onLivePlay, toggle } = bar();
    const label = toggle.closest("label")!;
    vi.useFakeTimers();
    const rest = () => {
      act(() => {
        fireEvent.pointerEnter(label, { pointerType: "mouse" });
        fireEvent.mouseEnter(label);
        fireEvent.pointerMove(label, { pointerType: "mouse" });
        fireEvent.mouseMove(label);
      });
      act(() => void vi.advanceTimersByTime(HINT_DELAY_MS + 50));
      return document.querySelector(".je-hint");
    };
    expect(rest()?.textContent).toBe(`${LIVE_PLAY_TOOLTIP}. ${LIVE_PLAY_SOURCES}`);
    act(() => {
      fireEvent.pointerDown(label, { pointerType: "mouse" });
      fireEvent.click(label);
    });
    expect(onLivePlay).toHaveBeenLastCalledWith(true);
    expect(rest()).toBeNull();
    act(() => {
      fireEvent.pointerLeave(label, { pointerType: "mouse" });
      fireEvent.mouseLeave(label);
    });
    expect(rest()).not.toBeNull();
  });

  it("keeps its hint shut once flipped from the keyboard, until focus leaves", () => {
    const { onLivePlay, toggle } = bar();
    focusForHint(toggle);
    expect(document.querySelector(".je-hint")).not.toBeNull();
    act(() => {
      fireEvent.keyDown(toggle, { key: " " });
      fireEvent.keyUp(toggle, { key: " " });
    });
    act(() => void vi.advanceTimersByTime(HINT_DELAY_MS + 50));
    expect(onLivePlay).toHaveBeenLastCalledWith(true);
    expect(document.querySelector(".je-hint")).toBeNull();
    act(() => toggle.blur());
    act(() => void vi.advanceTimersByTime(HINT_DELAY_MS + 50));
    focusForHint(toggle);
    expect(document.querySelector(".je-hint")?.textContent).toBe(
      `${LIVE_PLAY_TOOLTIP}. ${LIVE_PLAY_SOURCES}`,
    );
  });

  it("stays focusable but inert where the scene can't take live updates, its reason reachable", () => {
    const { onLivePlay, toggle, text } = bar(UNAVAILABLE);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    // The kit's disabled look, which `.je-switch[data-disabled]` draws.
    expect(toggle.hasAttribute("data-disabled")).toBe(true);
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
    // The unavailable switch looks disabled through the kit's own rule alone.
    expect(css).not.toMatch(/\[data-unavailable\] \.je-switch/);
  });

  it("says Live in Play is listening for edits while it is on, and offers no Restart for what it applies", () => {
    const host = new Store({
      sceneChanged: true,
      livePlay: { on: true, unavailable: null, status: null, checks: [] },
    });
    const controls = {
      game: { getStore: () => createGameStore(), resume: vi.fn(), pause: vi.fn(), step: vi.fn() },
      host,
      keymap: { chordOf: () => undefined },
      onStop: vi.fn(),
      onRestart: vi.fn(),
      onLivePlay: vi.fn(),
    } as unknown as EditorControls;
    render(<EditorPlayBar {...controls} />);
    expect(screen.getByText(LIVE_PLAY_IDLE)).toBeTruthy();
    expect(screen.queryByText("Scene changed")).toBeNull();
    act(() =>
      host.setState((s) => ({ ...s, livePlay: { ...s.livePlay, on: false, status: null } })),
    );
    expect(screen.queryByText(LIVE_PLAY_IDLE)).toBeNull();
    expect(screen.getByText("Scene changed")).toBeTruthy();
  });

  it("offers Restart again when a live update failed or waits, and calls only those pending", () => {
    const failed: LivePlayStatus = { tone: "failed", text: `${LIVE_PLAY_NOT_APPLIED}: no` };
    const host = new Store({
      sceneChanged: true,
      livePlay: { on: true, unavailable: null, status: failed, checks: [] },
    });
    const controls = {
      game: { getStore: () => createGameStore(), resume: vi.fn(), pause: vi.fn(), step: vi.fn() },
      host,
      keymap: { chordOf: () => undefined },
      onStop: vi.fn(),
      onRestart: vi.fn(),
      onLivePlay: vi.fn(),
    } as unknown as EditorControls;
    render(<EditorPlayBar {...controls} />);
    expect(screen.getByText("Scene changed")).toBeTruthy();
    const waiting: LivePlayStatus = { tone: "waiting", text: "Live update applies later" };
    act(() => host.setState((s) => ({ ...s, livePlay: { ...s.livePlay, status: waiting } })));
    expect(screen.getByText("Scene changed")).toBeTruthy();
    const applied: LivePlayStatus = { tone: "applied", text: "Live update applied" };
    act(() => host.setState((s) => ({ ...s, livePlay: { ...s.livePlay, status: applied } })));
    expect(screen.queryByText("Scene changed")).toBeNull();

    expect([failed, waiting].every(livePlayPending)).toBe(true);
    expect(livePlayPending(applied)).toBe(false);
    expect(livePlayPending({ tone: "busy", text: "" })).toBe(false);
    expect(livePlayPending(null)).toBe(false);
  });

  it("draws every island on a play bar row at the row's height", () => {
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    const rule = /\.je-play-bar > \.je-island \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("align-self: stretch");
  });
});
