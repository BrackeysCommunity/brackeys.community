// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import {
  createEditorSession,
  setTileBrush,
  type EditorSession,
  type SceneDefinition,
  type ToolHost,
} from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { ProjectRuntimeView } from "../../project/index";
import type { TilesetFile } from "../../project/kinds/tileset";
import { KitProvider } from "../kit/index";
import type { ToolHostCell } from "../panels/canvas-layer/tool-host";
import { PANELS, type PanelContext } from "../panels/registry";
import { fitTilePx, TilePalette } from "../panels/TilePalette";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const ground: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "ground-png",
  tile: [16, 16],
  columns: 4,
  tiles: [
    { id: 5, solid: true, tags: ["wall"], cost: 20 },
    { id: 6, oneWay: "up", tags: ["moss"] },
  ],
  rules: [{ id: "walls", kind: "blob47", terrain: "wall", tiles: { "0": 5 }, fallback: 5 }],
};
const water: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "water-png",
  tile: [16, 16],
  columns: 2,
};

function runtime(): ProjectRuntimeView {
  const docs: Record<string, TilesetFile> = { ground, water };
  const sizes: Record<string, [number, number]> = { "ground-png": [64, 32], "water-png": [32, 48] };
  return {
    settings: {},
    engine: {},
    table: () => [],
    inputMap: null,
    asset: (id) =>
      sizes[id] ? { id, kind: "texture", sha256: "x" as never, size: sizes[id] } : undefined,
    doc: ((kind: string, id: string) => (kind === "tileset" ? docs[id] : undefined)) as never,
    docs: () => [],
  };
}

function scene(): SceneDefinition {
  return {
    v: 1,
    name: "tiles-yard",
    bounds: [0, 0, 640, 480],
    entities: [
      { id: "floor", type: "tilemap", at: [0, 0], tileset: "ground", cells: {} },
      { id: "pond", type: "tilemap", at: [0, 0], tileset: "water", cells: {} },
    ],
  } as SceneDefinition;
}

function editorSession(): EditorSession {
  return createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "tiles-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
}

/** A tool host cell whose host records the tools it's asked for and reports them in the store. */
function toolCell(session: EditorSession) {
  const setTool = vi.fn((id: string) => {
    session.store.setState((s) => ({ ...s, tool: id }));
    return true;
  });
  const tools: ToolHostCell = new Store<ToolHost | null>({ setTool } as unknown as ToolHost);
  return { tools, setTool };
}

function setup(onOpenTileset?: (id: string) => void) {
  const session = editorSession();
  const { tools, setTool } = toolCell(session);
  render(
    <KitProvider host={{}}>
      <TilePalette
        session={session}
        runtime={runtime()}
        imageUrl={(id) => `/assets/${id}`}
        tools={tools}
        onOpenTileset={onOpenTileset}
      />
    </KitProvider>,
  );
  return { session, setTool, brush: () => session.store.state.tileBrush };
}

const tile = (id: number) => screen.getByRole("gridcell", { name: `Tile ${id}` });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tile palette", () => {
  it("shows the tileset's image cut into tiles", () => {
    setup();
    const grid = screen.getByRole("grid", { name: "Tiles of ground" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(8);
    expect(tile(5).style.backgroundImage).toContain("/assets/ground-png");
    expect(tile(5).style.backgroundPosition).toBe("-24px -24px");
  });

  it("selecting a tile sets the session's brush and arms the brush tool", () => {
    const { setTool, brush } = setup();
    fireEvent.pointerDown(tile(5), { button: 0 });
    expect(brush()).toEqual({ tiles: [[6]] });
    expect(setTool).toHaveBeenLastCalledWith("tile-brush");
    expect(tile(5).getAttribute("aria-selected")).toBe("true");
    expect(tile(0).getAttribute("aria-selected")).toBe("false");
  });

  it("Shift-click and drag select a stamp", () => {
    const { brush } = setup();
    fireEvent.pointerDown(tile(1), { button: 0 });
    fireEvent.pointerDown(tile(6), { button: 0, shiftKey: true });
    expect(brush()).toEqual({
      tiles: [
        [2, 3],
        [6, 7],
      ],
    });
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(tile(0), { button: 0 });
    fireEvent.pointerEnter(tile(4));
    fireEvent.pointerEnter(tile(5));
    fireEvent.pointerUp(window);
    expect(brush()).toEqual({
      tiles: [
        [1, 2],
        [5, 6],
      ],
    });
    expect(screen.getByText("2×2 stamp")).toBeTruthy();
  });

  it("is keyboard reachable: arrows move, Shift extends, Enter picks", () => {
    const { brush } = setup();
    expect(tile(0).tabIndex).toBe(0);
    act(() => tile(0).focus());
    fireEvent.keyDown(tile(0), { key: "Enter" });
    expect(brush()).toEqual({ tiles: [[1]] });
    fireEvent.keyDown(tile(0), { key: "ArrowRight", shiftKey: true });
    expect(document.activeElement).toBe(tile(1));
    expect(brush()).toEqual({ tiles: [[1, 2]] });
  });

  it("highlights the session's brush, however it was set", () => {
    const { session } = setup();
    expect(tile(0).getAttribute("aria-selected")).toBe("true");
    act(() => setTileBrush(session.store, { tiles: [[0, 4 | (1 << 13)]] }));
    expect(tile(3).getAttribute("aria-selected")).toBe("true");
    expect(tile(0).getAttribute("aria-selected")).toBe("false");
    act(() => session.select(["pond"]));
    act(() => session.select(["floor"]));
    expect(tile(3).getAttribute("aria-selected")).toBe("true");
  });

  it("shows the selected tile's data read-only, as the tile rule reads it", () => {
    setup();
    fireEvent.pointerDown(tile(5), { button: 0 });
    let data = screen.getByRole("region", { name: "Tile data" });
    expect(within(data).getByText("wall")).toBeTruthy();
    expect(within(data).getByText("Solid")).toBeTruthy();
    expect(within(data).queryByText("Cost")).toBeNull();
    expect(within(data).queryByRole("textbox")).toBeNull();

    fireEvent.pointerUp(window);
    fireEvent.pointerDown(tile(6), { button: 0 });
    data = screen.getByRole("region", { name: "Tile data" });
    expect(within(data).getByText("moss")).toBeTruthy();
    expect(within(data).queryByText("One-way")).toBeNull();
    expect(within(data).getByText("10")).toBeTruthy();
  });

  it("a rule arms the autotile tool", () => {
    const { session, setTool } = setup();
    const rule = screen.getByRole("button", { name: /walls/ });
    fireEvent.click(rule);
    expect(session.store.state.tileRule).toBe("walls");
    expect(setTool).toHaveBeenLastCalledWith("tile-auto");
    expect(rule.getAttribute("aria-pressed")).toBe("true");
  });

  it("switching tilemaps switches the tileset", () => {
    const { session } = setup();
    expect(screen.getByRole("grid", { name: "Tiles of ground" })).toBeTruthy();
    act(() => session.select(["pond"]));
    const grid = screen.getByRole("grid", { name: "Tiles of water" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(6);
    expect(screen.queryByRole("region", { name: "Autotile rules" })).toBeNull();
    act(() => session.select([]));
    expect(screen.getByRole("grid", { name: "Tiles of water" })).toBeTruthy();
    act(() => session.select(["floor"]));
    expect(screen.getByRole("grid", { name: "Tiles of ground" })).toBeTruthy();
  });

  it("arms the brush and the rule at the panel registry's mount", () => {
    const session = editorSession();
    const { tools, setTool } = toolCell(session);
    const def = PANELS.find((p) => p.id === "tiles")!;
    const controls = {
      session,
      tools,
      project: { runtime: runtime(), assetImage: (id: string) => `/assets/${id}` },
    };
    render(
      <KitProvider host={{}}>{def.render({ controls } as unknown as PanelContext)}</KitProvider>,
    );
    fireEvent.pointerDown(tile(2), { button: 0 });
    expect(session.store.state.tileBrush).toEqual({ tiles: [[3]] });
    expect(setTool).toHaveBeenLastCalledWith("tile-brush");
    fireEvent.click(screen.getByRole("button", { name: /walls/ }));
    expect(session.store.state.tileRule).toBe("walls");
    expect(setTool).toHaveBeenLastCalledWith("tile-auto");
  });

  it("fits tiles to a narrow panel instead of scrolling them sideways", () => {
    expect(fitTilePx(400, 4)).toBe(24);
    expect(fitTilePx(60, 4)).toBe(13);
    expect(fitTilePx(60, 64)).toBe(12);

    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(60);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    setup();
    const grid = screen.getByRole("grid", { name: "Tiles of ground" });
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, 13px)");
    expect(grid.style.getPropertyValue("--je-tile-px")).toBe("13px");
    expect(tile(5).style.width).toBe("13px");
    expect(tile(5).style.backgroundPosition).toBe("-13px -13px");
  });

  it("Edit in tileset opens the map's tileset, only when the host can", () => {
    const open = vi.fn();
    setup(open);
    fireEvent.pointerDown(tile(0), { button: 0 });
    const data = screen.getByRole("region", { name: "Tile data" });
    fireEvent.click(within(data).getByRole("button", { name: "Edit in tileset" }));
    expect(open).toHaveBeenCalledWith("ground");
    cleanup();

    setup();
    fireEvent.pointerDown(tile(0), { button: 0 });
    expect(screen.queryByRole("button", { name: "Edit in tileset" })).toBeNull();
  });
});
