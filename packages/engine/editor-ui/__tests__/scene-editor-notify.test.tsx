// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../../game/index";
import type { EditorHost, EditorNotify, ProjectConnection } from "../host";
import { SceneEditor } from "../index";

vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return { ...pixi, Application };
});

const game = defineGame({
  id: "scene-editor-notify",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

/** A host whose project never connects, so the editor runs no further than its game. */
function idleHost(extra: Partial<EditorHost> = {}): EditorHost {
  const connection: ProjectConnection = {
    getState: () => ({
      status: "connecting",
      session: null,
      access: "write",
      stopped: {},
      error: null,
      unsynced: 0,
    }),
    subscribe: () => () => {},
    onAssetChanged: () => () => {},
    destroy: () => {},
  };
  return { assetUrl: () => "", storage: null, connect: () => connection, ...extra };
}

const rapier = () => import("@dimforge/rapier2d");

/** A debug loader that fails, so the editor reports that its game couldn't start. */
const failingDebug = () => Promise.reject(new Error("no debug build"));

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SceneEditor notices", () => {
  it("shows them in its own toast region when the host has no notify", async () => {
    render(
      <SceneEditor
        host={idleHost()}
        game={game}
        project="p"
        rapier={rapier}
        debug={failingDebug}
      />,
    );
    const region = screen.getByRole("region", { name: "Notifications" });
    const toast = await waitFor(() => within(region).getByRole("alert"));
    expect(toast.textContent).toContain("The game couldn't start");
    expect(toast.textContent).toContain("no debug build");
  });

  it("sends them to the host's notify, drawing no region of its own", async () => {
    const error = vi.fn();
    const notify = Object.assign(vi.fn(), { success: vi.fn(), error }) as unknown as EditorNotify;
    render(
      <SceneEditor
        host={idleHost({ notify })}
        game={game}
        project="p"
        rapier={rapier}
        debug={failingDebug}
      />,
    );
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("The game couldn't start", {
        description: "no debug build",
      }),
    );
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });

  it("keeps the notify it mounted with when the host's changes", async () => {
    const notify = Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
    }) as unknown as EditorNotify;
    const view = render(<SceneEditor host={idleHost()} game={game} project="p" rapier={rapier} />);
    view.rerender(
      <SceneEditor
        host={idleHost({ notify })}
        game={game}
        project="p"
        rapier={rapier}
        debug={failingDebug}
      />,
    );
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
  });
});
