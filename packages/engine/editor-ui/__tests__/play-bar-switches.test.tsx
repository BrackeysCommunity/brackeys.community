// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGameStore } from "../../store";
import type { GameEventMap } from "../../types";
import { SOUND_IN_PLAY_KEY } from "../audio/editor-audio";
import type { EditorControls } from "../frame/keys";
import { HINT_DELAY_MS } from "../kit/hint";
import {
  EditorPlayBar,
  LOCALE_TOOLTIP,
  SOUND_IN_PLAY_TOOLTIP,
  SOUND_NEXT_PLAY,
} from "../panels/EditorPlayBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

/** The hint `el` opens once it holds keyboard focus. */
function hintOf(el: HTMLElement) {
  vi.useFakeTimers();
  act(() => {
    fireEvent.keyDown(document.body, { key: "Tab" });
    el.focus();
  });
  act(() => void vi.advanceTimersByTime(HINT_DELAY_MS + 50));
  return document.querySelector(".je-hint")?.textContent;
}

type Handler = (payload: GameEventMap["locale:change"]) => void;

/** A stand-in game with a master bus and the locale API. */
function standIn(locales: readonly string[] = ["en", "fr"]) {
  const handlers = new Set<Handler>();
  let current = locales[0] ?? "en";
  const master = { volume: 1, muted: false };
  const game = {
    getStore: () => createGameStore(),
    resume: vi.fn(),
    pause: vi.fn(),
    step: vi.fn(),
    setTimeScale: vi.fn(),
    audio: {
      buses: () => ({ master }),
      setBus: vi.fn((_bus: string, volume: number, muted: boolean) => {
        master.volume = volume;
        master.muted = muted;
      }),
      stopAll: vi.fn(),
    },
    locale: {
      current: () => current,
      available: () => locales,
      set: vi.fn((to: string) => {
        const from = current;
        current = to;
        for (const h of handlers) h({ from, to });
      }),
    },
    on: (_event: "locale:change", h: Handler) => void handlers.add(h),
    off: (_event: "locale:change", h: Handler) => void handlers.delete(h),
  };
  /** Another tab or the game's own UI changed the locale. */
  const changeElsewhere = (to: string) => {
    const from = current;
    current = to;
    for (const h of handlers) h({ from, to });
  };
  return { game, master, changeElsewhere };
}

function bar(game: object) {
  const controls = {
    game,
    host: new Store({ sceneChanged: false, livePlay: null }),
    keymap: { chordOf: () => undefined },
    onStop: vi.fn(),
    onRestart: vi.fn(),
  } as unknown as EditorControls;
  render(<EditorPlayBar {...controls} />);
}

const soundSwitch = () => screen.getByRole("switch", { name: "Sound in Play" });

describe("the Sound in Play switch", () => {
  it("toggles from its visible label, as Live in Play does", () => {
    const { game, master } = standIn();
    bar(game);
    const text = screen.getByText("Sound in Play");
    expect(text.closest("label")).not.toBeNull();
    fireEvent.click(text);
    expect(soundSwitch().getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(SOUND_IN_PLAY_KEY)).toBe("true");
    fireEvent.click(text);
    expect(soundSwitch().getAttribute("aria-checked")).toBe("false");
    expect(master.muted).toBe(true);
  });

  it("follows a change another tab stores, and applies it to the game", () => {
    localStorage.setItem(SOUND_IN_PLAY_KEY, "true");
    const { game, master } = standIn();
    bar(game);
    expect(soundSwitch().getAttribute("aria-checked")).toBe("true");

    localStorage.setItem(SOUND_IN_PLAY_KEY, "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: SOUND_IN_PLAY_KEY }));
    });
    expect(soundSwitch().getAttribute("aria-checked")).toBe("false");
    expect(master.muted).toBe(true);
    expect(game.audio.stopAll).toHaveBeenCalled();

    // A host storage that raises no event is read again when the window regains focus.
    localStorage.setItem(SOUND_IN_PLAY_KEY, "true");
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(soundSwitch().getAttribute("aria-checked")).toBe("true");
    expect(master.muted).toBe(false);
  });

  it("says the sound waits for the next Play when this one started silent", () => {
    const { game } = standIn();
    const silent = { ...game, audio: null };
    bar(silent);
    expect(screen.queryByText(SOUND_NEXT_PLAY)).toBeNull();
    fireEvent.click(soundSwitch());
    expect(screen.getByText(SOUND_NEXT_PLAY)).toBeTruthy();
    fireEvent.click(soundSwitch());
    expect(screen.queryByText(SOUND_NEXT_PLAY)).toBeNull();
  });
});

describe("the locale picker", () => {
  it("switches the game's locale and follows a change made elsewhere", async () => {
    const { game, changeElsewhere } = standIn(["en", "fr"]);
    bar(game);
    const picker = screen.getByRole("combobox", { name: "Locale" });
    expect(picker.textContent).toBe("en");

    fireEvent.click(picker);
    const french = await screen.findByRole("option", { name: "fr" });
    fireEvent.mouseMove(french);
    fireEvent.click(french);
    await waitFor(() => expect(game.locale.set).toHaveBeenCalledWith("fr"));
    expect(screen.getByRole("combobox", { name: "Locale" }).textContent).toBe("fr");

    act(() => changeElsewhere("en"));
    expect(screen.getByRole("combobox", { name: "Locale" }).textContent).toBe("en");
  });

  it("ends its hint with a full stop, as the switches' hints do, and is sized by a class", () => {
    const { game } = standIn(["en", "fr"]);
    bar(game);
    const picker = screen.getByRole("combobox", { name: "Locale" });
    expect(picker.classList.contains("je-play-select")).toBe(true);
    expect(picker.getAttribute("style") ?? "").not.toContain("width");
    expect(hintOf(picker)).toBe(`${LOCALE_TOOLTIP}.`);
    cleanup();
    vi.useRealTimers();
    bar(standIn().game);
    expect(hintOf(soundSwitch())).toBe(`${SOUND_IN_PLAY_TOOLTIP}.`);
  });

  it("isn't offered with one locale, or for a game without the locale API", () => {
    bar(standIn(["en"]).game);
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
    cleanup();
    const { game } = standIn();
    const { locale: _, ...bare } = game;
    bar(bare);
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
  });
});
