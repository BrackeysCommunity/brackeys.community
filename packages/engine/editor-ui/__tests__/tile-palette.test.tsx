// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { ProjectRuntimeView } from "../../project/index";
import type { TilesetFile } from "../../project/kinds/tileset";
import { KitProvider } from "../kit/index";
import { TilePalette, type TilePaletteHost } from "../panels/TilePalette";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const ground: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "ground-png",
  tile: [16, 16],
  columns: 4,
  tiles: [{ id: 5, solid: true, tags: ["wall"], cost: 20 }],
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

function setup() {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "tiles-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  const setBrush = vi.fn<TilePaletteHost["setBrush"]>();
  const setRule = vi.fn<TilePaletteHost["setRule"]>();
  const setTool = vi.fn<TilePaletteHost["setTool"]>();
  const host: TilePaletteHost = { setBrush, setRule, setTool };
  render(
    <KitProvider host={{}}>
      <TilePalette
        session={session}
        runtime={runtime()}
        imageUrl={(id) => `/assets/${id}`}
        host={host}
      />
    </KitProvider>,
  );
  return { session, host: { setBrush, setRule, setTool } };
}

const tile = (id: number) => screen.getByRole("gridcell", { name: `Tile ${id}` });

afterEach(cleanup);

describe("tile palette", () => {
  it("shows the tileset's image cut into tiles", () => {
    setup();
    const grid = screen.getByRole("grid", { name: "Tiles of ground" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(8);
    expect(tile(5).style.backgroundImage).toContain("/assets/ground-png");
    expect(tile(5).style.backgroundPosition).toBe("-24px -24px");
  });

  it("selecting a tile sets the brush and arms the brush tool", () => {
    const { host } = setup();
    fireEvent.pointerDown(tile(5), { button: 0 });
    expect(host.setBrush).toHaveBeenLastCalledWith({ tiles: [[6]] });
    expect(host.setTool).toHaveBeenLastCalledWith("tile-brush");
    expect(tile(5).getAttribute("aria-selected")).toBe("true");
  });

  it("Shift-click and drag select a stamp", () => {
    const { host } = setup();
    fireEvent.pointerDown(tile(1), { button: 0 });
    fireEvent.pointerDown(tile(6), { button: 0, shiftKey: true });
    expect(host.setBrush).toHaveBeenLastCalledWith({
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
    expect(host.setBrush).toHaveBeenLastCalledWith({
      tiles: [
        [1, 2],
        [5, 6],
      ],
    });
    expect(screen.getByText("2×2 stamp")).toBeTruthy();
  });

  it("is keyboard reachable: arrows move, Shift extends, Enter picks", () => {
    const { host } = setup();
    expect(tile(0).tabIndex).toBe(0);
    act(() => tile(0).focus());
    fireEvent.keyDown(tile(0), { key: "Enter" });
    expect(host.setBrush).toHaveBeenLastCalledWith({ tiles: [[1]] });
    fireEvent.keyDown(tile(0), { key: "ArrowRight", shiftKey: true });
    expect(document.activeElement).toBe(tile(1));
    expect(host.setBrush).toHaveBeenLastCalledWith({ tiles: [[1, 2]] });
  });

  it("shows the selected tile's data read-only", () => {
    setup();
    fireEvent.pointerDown(tile(5), { button: 0 });
    const data = screen.getByRole("region", { name: "Tile data" });
    expect(within(data).getByText("wall")).toBeTruthy();
    expect(within(data).getByText("20")).toBeTruthy();
    expect(within(data).queryByRole("textbox")).toBeNull();
  });

  it("a rule arms the autotile tool", () => {
    const { host } = setup();
    const rule = screen.getByRole("button", { name: /walls/ });
    fireEvent.click(rule);
    expect(host.setRule).toHaveBeenCalledWith("walls");
    expect(host.setTool).toHaveBeenLastCalledWith("tile-auto");
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
});
