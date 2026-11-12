// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../../game/index";
import { EditorSkeleton } from "../frame/EditorSkeleton";
import type { EditorHost, ProjectConnectionState } from "../host";
import { SceneEditor } from "../SceneEditor";

// jsdom has no WebGL, so the Pixi application is a stand-in.
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
  id: "skeleton",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

/** A project whose server never answers, so the editor stays booting. */
const connecting: ProjectConnectionState = {
  status: "connecting",
  session: null,
  access: "write",
  stopped: {},
  error: null,
  unsynced: 0,
};
const host: EditorHost = {
  assetUrl: () => "",
  storage: null,
  connect: () => ({
    getState: () => connecting,
    subscribe: () => () => {},
    onAssetChanged: () => () => {},
    destroy: () => {},
  }),
};

/** Each tab group as the frame lays it out: its label, its tabs, and how many skeleton rows it draws. */
const groups = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".je-panel-group")].map((group) => ({
    label: within(group).getByRole("tablist").getAttribute("aria-label"),
    tabs: within(group)
      .getAllByRole("tab")
      .map((t) => t.textContent),
    skeletons: group.querySelectorAll(".je-skeleton").length,
  }));

afterEach(cleanup);

describe("EditorSkeleton", () => {
  it("draws the default layout with each panel's skeleton and says the editor is loading", () => {
    const { container } = render(<EditorSkeleton host={{ storage: null }} />);
    const drawn = groups(container);
    expect(drawn.length).toBeGreaterThan(1);
    for (const group of drawn) expect(group.skeletons).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("Loading the editor");
    expect(container.querySelector("canvas.je-scene-canvas")).not.toBeNull();
  });

  it("is what a booting SceneEditor draws", () => {
    const skeleton = render(<EditorSkeleton host={{ storage: null }} />);
    const expected = groups(skeleton.container);
    skeleton.unmount();

    const { container } = render(
      <SceneEditor
        host={host}
        game={game}
        project="p"
        scene="yard"
        rapier={() => new Promise<never>(() => {})}
      />,
    );
    expect(groups(container)).toEqual(expected);
    expect(container.querySelectorAll("canvas.je-scene-canvas")).toHaveLength(1);
  });
});
