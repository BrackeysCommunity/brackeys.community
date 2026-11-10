// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { EngineContext } from "@jams/engine/game";
import { describe, expect, it, vi } from "vite-plus/test";

import { engineEditorGame, showMountFailure } from "../main";

const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

describe("the standalone editor's page", () => {
  it("says the editor is loading before any script runs", () => {
    const page = new DOMParser().parseFromString(html, "text/html");
    expect(page.getElementById("editor")?.textContent?.trim()).toBe("Loading the editor…");
  });

  it("replaces the loading line with why the editor couldn't open", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p class="boot">Loading the editor…</p>';
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Failed to fetch dynamically imported module");
    showMountFailure(root, error);
    expect(root.textContent).toBe(
      "The editor couldn't open: Failed to fetch dynamically imported module",
    );
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(log).toHaveBeenCalledWith("[engine editor] couldn't open", error);
    log.mockRestore();
  });
});

describe("the standalone editor's game", () => {
  const camera = (ctx: Pick<EngineContext, "play" | "bounds">) =>
    engineEditorGame.createRuntime(ctx as EngineContext).cameraTarget?.();

  it("points Play's camera at the play start when Play began from a point", () => {
    const play = { at: { x: 120, y: -40 }, timeOffsetMs: 0 };
    expect(camera({ play, bounds: [0, 0, 2000, 1200] })).toEqual({ x: 120, y: -40 });
  });

  it("points it at the centre of the scene's bounds otherwise", () => {
    const play = { timeOffsetMs: 0 };
    expect(camera({ play, bounds: [-400, 100, 1600, 900] })).toEqual({ x: 600, y: 500 });
  });

  it("leaves an edit world's camera to the editor", () => {
    expect(camera({ play: null, bounds: [0, 0, 2000, 1200] })).toBeNull();
  });
});
