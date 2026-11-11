// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGameStore, setSession, setSimPaused } from "../../store";
import type { EditorControls } from "../frame/keys";
import { EditorPlayBar } from "../panels/EditorPlayBar";

afterEach(cleanup);

function bar(opts: { outcome: boolean; scene?: string }) {
  const store = createGameStore();
  setSimPaused(store, true);
  setSession(store, {
    startTick: 0,
    outcome: opts.outcome ? { result: "flow", to: "level-1", tick: 12 } : null,
  });
  const onStop = vi.fn();
  const openScene = vi.fn();
  const controls = {
    game: { getStore: () => store, resume: vi.fn(), pause: vi.fn(), step: vi.fn() },
    host: new Store({ sceneChanged: false }),
    keymap: { chordOf: () => undefined },
    onStop,
    onRestart: vi.fn(),
    project: { scene: opts.scene ?? "menu", openScene },
  } as unknown as EditorControls;
  render(<EditorPlayBar {...controls} />);
  return { onStop, openScene };
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("the play bar after a flow request ended Play", () => {
  it("says it ended, turns Resume and Step off, and opens the requested scene", () => {
    const { onStop, openScene } = bar({ outcome: true });
    expect(screen.getByText("Ended · Esc to stop")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Ended: requested level-1");
    expect(button("Resume").disabled).toBe(true);
    expect(button("Step").disabled).toBe(true);
    fireEvent.click(button("Open level-1"));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(openScene).toHaveBeenCalledWith("level-1");
  });

  it("offers no Open for the scene already open", () => {
    bar({ outcome: true, scene: "level-1" });
    expect(screen.queryByRole("button", { name: "Open level-1" })).toBeNull();
  });

  it("keeps Resume and Step while the session runs on", () => {
    bar({ outcome: false });
    expect(screen.getByText("Playing · Esc to stop")).toBeTruthy();
    expect(button("Resume").disabled).toBe(false);
    expect(button("Step").disabled).toBe(false);
  });
});
