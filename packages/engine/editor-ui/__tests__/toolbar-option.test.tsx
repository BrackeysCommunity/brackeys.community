// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import {
  createEditorSession,
  createKeymap,
  drawTypeOptions,
  type SceneDefinition,
} from "../../editor/index";
import { createToolHost } from "../../editor/tool-host";
import { DEFAULT_SNAP } from "../../editor/tools";
import { createRegistry } from "../../game/index";
import type { GameStoreState } from "../../index";
import { createToolRouter } from "../../tool-router";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { CanvasLayer } from "../panels/canvas-layer/CanvasLayer";
import { EDIT_LAYERS_KEY } from "../panels/canvas-layer/EditLayers";
import { EditorToolbar, optionSlot } from "../panels/EditorToolbar";
import type { LoadedRun } from "../session/loaded-run";

const scene: SceneDefinition = { v: 1, name: "option-yard", bounds: [0, 0, 2000, 1200] };

function setup() {
  const registry = createRegistry();
  const session = createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: scene.name,
    registry,
    issuesDebounceMs: 0,
  });
  const tools = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap: DEFAULT_SNAP,
  });
  render(
    <EditorToolbar
      session={session}
      keymap={createKeymap([])}
      host={tools}
      onPlay={() => {}}
      onPlayHere={() => {}}
    />,
  );
  return { registry, tools };
}

const bar = () => within(screen.getByRole("toolbar", { name: "Editor" }));
const optionButton = () => bar().getByRole("button", { name: /^Draw type/ });
const order = () =>
  bar()
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

afterEach(cleanup);

describe("the dock's draw type slot", () => {
  it("is there before a draw tool is picked, disabled, at the width it keeps", () => {
    const { registry, tools } = setup();
    expect(drawTypeOptions(registry, "box").length).toBeGreaterThan(1);
    const idle = optionButton() as HTMLButtonElement;
    expect(idle.disabled).toBe(true);
    const width = idle.style.minWidth;
    expect(width).toMatch(/px$/);
    const before = order().length;

    act(() => {
      tools.setTool("box");
    });
    const picking = optionButton() as HTMLButtonElement;
    expect(picking.disabled).toBe(false);
    expect(picking.style.minWidth).toBe(width);
    expect(order().length).toBe(before);
  });

  it("reserves the widest of the draw tools' choices and the active option's", () => {
    const { registry, tools } = setup();
    const slot = optionSlot(tools.tools(), registry, null)!;
    const longest = (choices: readonly { label: string }[]) =>
      Math.max(...choices.map((c) => c.label.length));
    for (const kind of ["box", "circle", "pen"] as const) {
      const choices = drawTypeOptions(registry, kind);
      if (choices.length > 1)
        expect(longest(slot.choices)).toBeGreaterThanOrEqual(longest(choices));
    }
    expect(optionSlot([], registry, null)).toBeNull();
  });

  it("lists each type with its description under its label", async () => {
    const { registry, tools } = setup();
    act(() => {
      tools.setTool("box");
    });
    fireEvent.click(optionButton());
    const described = drawTypeOptions(registry, "box").find((o) => o.description);
    expect(described).toBeTruthy();
    const item = (await screen.findAllByRole("menuitemradio")).find((i) =>
      i.textContent?.startsWith(described!.label),
    )!;
    expect(item.querySelector(".je-option-choice-description")?.textContent).toBe(
      described!.description,
    );
  });
});

const layerScene: SceneDefinition = {
  v: 4,
  name: "view-yard",
  bounds: [0, 0, 20, 12],
  settings: { physics: "none", gravity: [0, 0], grid: { kind: "square", cell: [1, 1] } },
  entities: [
    { id: "wall", type: "solid", shape: ["box", 4, 3, 1, 1] },
    { id: "room", type: "nav", shape: ["poly", 1, 6, 9, 6, 9, 11, 1, 11] },
  ],
} as SceneDefinition;

function viewSetup() {
  const map = new Map<string, string>();
  const storage: EditorStorage = {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
  };
  const session = createEditorSession({
    doc: sceneToDoc(layerScene, { key: sequentialKeys("v") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: layerScene.name,
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  const tools = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 100,
    snap: DEFAULT_SNAP,
  });
  const store = new Store({
    camera: { position: { x: 10, y: 6 }, scale: 100 },
  } as unknown as GameStoreState);
  const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });
  const ui = (
    <KitProvider host={{ storage }}>
      <CanvasLayer
        session={session}
        host={tools}
        store={store}
        runStore={new Store<LoadedRun | null>(null)}
        notify={notify}
      />
      <EditorToolbar
        session={session}
        keymap={createKeymap([])}
        host={tools}
        onPlay={() => {}}
        onPlayHere={() => {}}
      />
    </KitProvider>
  );
  return { map, ui, view: render(ui), session };
}

const layer = (id: string) => document.querySelector(`[data-edit-layer="${id}"]`);

/** Picks a View layer, opening the grid menu unless it is open: picking one leaves it open. */
async function pick(label: string) {
  if (screen.queryAllByRole("menuitemcheckbox").length === 0)
    fireEvent.click(bar().getByRole("button", { name: /^Grid step/ }));
  const item = (await screen.findAllByRole("menuitemcheckbox")).find((i) =>
    i.textContent?.startsWith(label),
  )!;
  fireEvent.click(item);
  return item;
}

describe("the grid menu's View layers", () => {
  it("lists Grid, Occupancy and Nav, each off until picked, and Colliders, on", async () => {
    viewSetup();
    fireEvent.click(bar().getByRole("button", { name: /^Grid step/ }));
    const items = await screen.findAllByRole("menuitemcheckbox");
    expect(items.map((i) => i.querySelector(".je-option-choice")?.firstChild?.textContent)).toEqual(
      ["Grid", "Occupancy", "Nav", "Colliders"],
    );
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(document.querySelector("[data-edit-layers]")).toBeNull();
  });

  it("toggles each layer on the canvas and remembers it for the viewer", async () => {
    const { map } = viewSetup();
    for (const [label, id] of [
      ["Grid", "grid"],
      ["Occupancy", "occupancy"],
      ["Nav", "nav"],
    ] as const) {
      expect(layer(id)).toBeNull();
      await pick(label);
      expect(layer(id)).toBeTruthy();
      expect(JSON.parse(map.get(EDIT_LAYERS_KEY)!)[id]).toBe(true);
    }
    await pick("Occupancy");
    expect(layer("occupancy")).toBeNull();
    expect(layer("grid")).toBeTruthy();
    expect(JSON.parse(map.get(EDIT_LAYERS_KEY)!)).toEqual({
      grid: true,
      occupancy: false,
      nav: true,
      colliders: true,
    });
  });

  it("starts from what the viewer last chose", () => {
    const { map } = viewSetup();
    cleanup();
    map.set(EDIT_LAYERS_KEY, JSON.stringify({ nav: true }));
    const storage: EditorStorage = {
      get: (k) => map.get(k) ?? null,
      set: (k, v) => void map.set(k, v),
    };
    const session = createEditorSession({
      doc: sceneToDoc(layerScene, { key: sequentialKeys("w") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: layerScene.name,
      registry: createRegistry(),
      issuesDebounceMs: 0,
    });
    render(
      <KitProvider host={{ storage }}>
        <CanvasLayer
          session={session}
          host={null}
          store={
            new Store({
              camera: { position: { x: 10, y: 6 }, scale: 32 },
            } as unknown as GameStoreState)
          }
          runStore={new Store<LoadedRun | null>(null)}
          notify={Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() })}
        />
      </KitProvider>,
    );
    expect(layer("nav")).toBeTruthy();
    expect(layer("grid")).toBeNull();
  });

  it("keeps working when the storage refuses every read and write", async () => {
    const refusing: EditorStorage = {
      get: () => {
        throw new Error("denied");
      },
      set: () => {
        throw new Error("denied");
      },
    };
    const session = createEditorSession({
      doc: sceneToDoc(layerScene, { key: sequentialKeys("r") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: layerScene.name,
      registry: createRegistry(),
      issuesDebounceMs: 0,
    });
    const tools = createToolHost({
      session,
      router: createToolRouter(),
      toWorld: ({ x, y }) => [x, y],
      scale: () => 100,
      snap: DEFAULT_SNAP,
    });
    render(
      <KitProvider host={{ storage: refusing }}>
        <CanvasLayer
          session={session}
          host={tools}
          store={
            new Store({
              camera: { position: { x: 10, y: 6 }, scale: 100 },
            } as unknown as GameStoreState)
          }
          runStore={new Store<LoadedRun | null>(null)}
          notify={Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() })}
        />
        <EditorToolbar
          session={session}
          keymap={createKeymap([])}
          host={tools}
          onPlay={() => {}}
          onPlayHere={() => {}}
        />
      </KitProvider>,
    );
    await pick("Grid");
    expect(layer("grid")).toBeTruthy();
  });
});
