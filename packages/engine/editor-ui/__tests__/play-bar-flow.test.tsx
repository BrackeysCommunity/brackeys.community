// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGameStore, setSession, setSimPaused } from "../../store";
import type { EditorControls } from "../frame/keys";
import { EditorPlayBar } from "../panels/EditorPlayBar";
import type { LivePlayStatus } from "../session/live-scene-editor";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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

describe("the play bar's statuses", () => {
  const status = (s: LivePlayStatus | null, on = true) => ({
    on,
    unavailable: null,
    status: s,
    checks: [],
  });

  it("stack out of the controls' row, so turning Live in Play on or off never moves them", () => {
    const store = createGameStore();
    setSession(store, { startTick: 0, outcome: { result: "flow", to: "level-1", tick: 3 } });
    const host = new Store({ sceneChanged: false, livePlay: status(null, false) });
    const controls = {
      game: { getStore: () => store, resume: vi.fn(), pause: vi.fn(), step: vi.fn() },
      host,
      keymap: { chordOf: () => undefined },
      onStop: vi.fn(),
      onRestart: vi.fn(),
      onLivePlay: vi.fn(),
      project: { scene: "menu", openScene: vi.fn() },
    } as unknown as EditorControls;
    const { container } = render(<EditorPlayBar {...controls} />);
    const playBar = container.querySelector(".je-play-bar")!;
    const toggle = screen.getByRole("switch", { name: "Live in Play" });
    const stop = button("Stop");
    const row = () => [...playBar.children].map((el) => el.className);
    const offRow = row();

    const states: [string, () => void][] = [
      ["on", () => host.setState((s) => ({ ...s, livePlay: status(null) }))],
      [
        "busy",
        () =>
          host.setState((s) => ({
            ...s,
            livePlay: status({ tone: "busy", text: "Applying live update…" }),
          })),
      ],
      [
        "applied",
        () =>
          host.setState((s) => ({
            ...s,
            livePlay: status({ tone: "applied", text: "Live update applied" }),
          })),
      ],
      [
        "failed",
        () =>
          host.setState((s) => ({
            ...s,
            sceneChanged: true,
            livePlay: status({ tone: "failed", text: "Live update not applied: no" }),
          })),
      ],
      ["off", () => host.setState((s) => ({ ...s, livePlay: status(null, false) }))],
    ];
    for (const [name, apply] of states) {
      act(apply);
      expect(row(), name).toEqual(offRow);
      expect(screen.getByRole("switch", { name: "Live in Play" }), name).toBe(toggle);
      expect(button("Stop"), name).toBe(stop);
      for (const note of screen.getAllByRole("status")) {
        expect(note.parentElement?.classList.contains("je-play-notes"), name).toBe(true);
      }
    }
    expect(screen.getByText("Scene changed").closest(".je-play-notes")).toBeTruthy();
    expect(screen.getByText(/Ended: requested level-1/).closest(".je-play-notes")).toBeTruthy();
  });

  it("lay the statuses out of flow above the controls, and hide the slot when it is empty", () => {
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    const notes = /\.je-play-notes \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(notes).toContain("position: absolute");
    expect(notes).toMatch(/bottom: calc\(100% \+ /);
    expect(notes).toContain("pointer-events: none");
    expect(/\.je-play-notes:empty \{([^}]*)\}/.exec(css)?.[1]).toContain("display: none");
  });
});
