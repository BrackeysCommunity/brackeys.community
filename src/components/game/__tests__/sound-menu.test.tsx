// @vitest-environment jsdom
import { memoryPrefsStore, PREF_KEYS, type BusLevel, type GameInstance } from "@jams/engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { savedMaster, SoundMenu } from "../sound-menu";

afterEach(cleanup);

const KEY = PREF_KEYS.busKey("master");

function open() {
  if (!screen.queryByRole("menu")) fireEvent.click(screen.getByRole("button", { name: "Sound" }));
}

function gameWithAudio(master: BusLevel) {
  const setBus = vi.fn((_bus: string, volume: number, muted?: boolean) => {
    master.volume = volume;
    if (muted !== undefined) master.muted = muted;
  });
  const game = { audio: { buses: () => ({ master: { ...master } }), setBus } };
  return { game: game as unknown as GameInstance, setBus };
}

describe("SoundMenu", () => {
  it("mutes through setBus while the game's audio is open", () => {
    const prefs = memoryPrefsStore();
    const { game, setBus } = gameWithAudio({ volume: 0.5, muted: false });
    render(<SoundMenu game={game} gameId="g" prefs={prefs} />);
    expect(screen.getByRole("button", { name: "Sound" }).textContent).toContain("50%");
    open();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute" }));
    expect(setBus).toHaveBeenLastCalledWith("master", 0.5, true);
    expect(screen.getByRole("button", { name: "Sound" }).textContent).toContain("Muted");
  });

  it("saves the choice in the prefs while the game plays silent, for the audio to read when it opens", () => {
    const prefs = memoryPrefsStore();
    render(<SoundMenu game={null} gameId="g" prefs={prefs} />);
    open();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute" }));
    expect(prefs.load("g")[KEY]).toEqual({ volume: 1, muted: true });
    expect(savedMaster(prefs, "g")).toEqual({ volume: 1, muted: true });
  });

  it("starts from the saved level, as after a reload", () => {
    const prefs = memoryPrefsStore();
    prefs.save("g", { [KEY]: { volume: 0.25, muted: false } });
    render(<SoundMenu game={null} gameId="g" prefs={prefs} />);
    expect(screen.getByRole("button", { name: "Sound" }).textContent).toContain("25%");
  });

  it("reads a saved level that isn't one as full volume", () => {
    const prefs = memoryPrefsStore();
    prefs.save("g", { [KEY]: "loud" });
    expect(savedMaster(prefs, "g")).toEqual({ volume: 1, muted: false });
    prefs.save("g", { [KEY]: { volume: 7, muted: "yes" } });
    expect(savedMaster(prefs, "g")).toEqual({ volume: 1, muted: false });
  });
});
