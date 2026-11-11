// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import { createEditorSession, type EditorSession } from "../../../../editor/index";
import { createRegistry, defineGame } from "../../../../game/index";
import type { Registry } from "../../../../game/types";
import { gridGeometry, type Cell } from "../../../../grid/geometry";
import type { GameStoreState } from "../../../../index";
import { buildNavMesh } from "../../../../nav/navmesh";
import { sceneGrid } from "../../../../runtime/grid";
import { expandScene } from "../../../../scene/expand";
import { SCENE_GRID_MAX_CELLS } from "../../../../scene/render-geometry";
import type { GridSettings, Pt, SceneDefinition, ShapeObj } from "../../../../scene/types";
import type { EditorNotify, EditorStorage } from "../../../host";
import { KitProvider } from "../../../kit/index";
import type { LoadedRun } from "../../../session/loaded-run";
import { CanvasLayer } from "../CanvasLayer";
import {
  gridLayerPlan,
  navLayer,
  NO_EDIT_LAYERS,
  parseEditLayers,
  viewViewport,
  wallCells,
} from "../edit-layers";
import { EDIT_LAYERS_KEY } from "../EditLayers";
import { polylinePath, viewOf, type View } from "../view";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});

const SQUARE: GridSettings = { kind: "square", cell: [0.5, 0.5], origin: [0.25, 0] };
const HEX: GridSettings = {
  kind: "hex",
  cell: [0.64, 0.56],
  side: 0.32,
  stagger: "y",
  index: "odd",
};

const poly = (...pts: number[]) => ["poly", ...pts];

function yard(grid: GridSettings | null = SQUARE): SceneDefinition {
  return {
    v: 4,
    name: "layer-yard",
    bounds: [0, 0, 20, 12],
    settings: { physics: "none", gravity: [0, 0], ...(grid ? { grid } : {}) },
    entities: [
      { id: "wall", type: "solid", shape: ["box", 4, 3, 1, 0.5] },
      { id: "pillar", type: "solid", shape: ["circle", 12, 8, 1.2] },
      { id: "room", type: "nav", shape: poly(1, 6, 9, 6, 9, 11, 1, 11) },
      { id: "hall", type: "nav", shape: poly(9, 7, 15, 7, 15, 9, 9, 9) },
      { id: "table", type: "nav", mode: "block", shape: poly(3, 8, 5, 8, 5, 9, 3, 9) },
    ],
  } as SceneDefinition;
}

/** A view of the whole yard at `ppm` screen px per metre, its corner on the scene's. */
const viewAt = (ppm: number): View => ({
  width: 20 * ppm,
  height: 12 * ppm,
  scale: ppm,
  tx: 0,
  ty: 0,
});

const expanded = (registry: Registry, def = yard()) => expandScene(def, registry);

/** The yard's wall cells as the scene grid rasterises its solids. */
function expectedWalls(registry: Registry, grid: GridSettings): Cell[] {
  const geometry = gridGeometry(grid);
  const shapes = expanded(registry).entities.filter((e) => e.type === "solid");
  const keys = new Set<string>();
  const out: Cell[] = [];
  for (const e of shapes)
    for (const c of geometry.cellsIn(e.shape as ShapeObj))
      if (!keys.has(String(c))) {
        keys.add(String(c));
        out.push(c);
      }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

describe("the edit overlay's layer geometry", () => {
  const registry = createRegistry();

  it("reads only stored boolean flags, all off by default", () => {
    expect(NO_EDIT_LAYERS).toEqual({ grid: false, occupancy: false, nav: false });
    expect(parseEditLayers({ grid: true, nav: "yes", other: true })).toEqual({
      grid: true,
      occupancy: false,
      nav: false,
    });
    expect(parseEditLayers("grid")).toBeNull();
    expect(parseEditLayers({})).toBeNull();
  });

  it("maps the view back to the world rectangle it shows", () => {
    const view = viewOf({ position: { x: 10, y: 6 }, scale: 32 }, 640, 384);
    expect(viewViewport(view)).toEqual({ x: 0, y: 0, width: 20, height: 12 });
  });

  for (const ppm of [100, 32]) {
    it(`draws the square grid's cell lines from its origin, a cell apart on screen, at ${ppm} px per metre`, () => {
      const plan = gridLayerPlan(expanded(registry), viewAt(ppm))!;
      const xs = [...plan.minor, ...plan.major]
        .filter(([x1, , x2]) => x1 === x2)
        .map(([x]) => x)
        .sort((a, b) => a - b);
      for (const x of xs)
        expect(Math.abs((x - 0.25) / 0.5 - Math.round((x - 0.25) / 0.5))).toBeLessThan(1e-9);
      const gaps = new Set(xs.slice(1).map((x, i) => Math.round((x - xs[i]!) * ppm * 1000) / 1000));
      expect([...gaps]).toEqual([0.5 * ppm]);
      // Stops at the major lines just past the view: one major step at most.
      expect(xs[0]).toBeGreaterThanOrEqual(-5);
      expect(xs.at(-1)).toBeLessThanOrEqual(25.25);
      expect(xs.some((x) => x < 0.25)).toBe(true);
      expect(xs.some((x) => x > 19.75)).toBe(true);
    });

    it(`fills exactly the cells the solids' shapes hold at ${ppm} px per metre`, () => {
      const grid = sceneGrid(expanded(registry), registry);
      const walls = expectedWalls(registry, SQUARE);
      expect(walls.length).toBeGreaterThan(4);
      const geometry = gridGeometry(SQUARE);
      expect(wallCells(grid, viewAt(ppm))).toEqual({
        cells: walls.map((c) => geometry.corners(c)),
        truncated: false,
      });
    });

    it(`outlines the nav areas, the holes and the mesh at ${ppm} px per metre`, () => {
      const nav = navLayer(expanded(registry), registry);
      expect(nav.areas).toEqual([
        [
          [1, 6],
          [9, 6],
          [9, 11],
          [1, 11],
        ],
        [
          [9, 7],
          [15, 7],
          [15, 9],
          [9, 9],
        ],
      ]);
      expect(nav.holes).toEqual([
        [
          [3, 8],
          [5, 8],
          [5, 9],
          [3, 9],
        ],
      ]);
      const { mesh } = buildNavMesh(
        nav.areas.map((pts, i) => ({ id: String(i), pts })),
        nav.holes.map((pts, i) => ({ id: `h${i}`, pts })),
      );
      expect(nav.triangles).toEqual(mesh.triangles);
      const area = ([a, b, c]: readonly [Pt, Pt, Pt]) =>
        Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      expect(nav.triangles.reduce((sum, t) => sum + area(t), 0)).toBeCloseTo(40 + 12 - 2, 9);
    });
  }

  it("leaves out walls outside the view", () => {
    const grid = sceneGrid(expanded(registry), registry);
    const left: View = { width: 800, height: 1200, scale: 100, tx: 0, ty: 0 };
    const cells = wallCells(grid, left).cells;
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((corners) => corners.every(([x]) => x <= 8.25))).toBe(true);
    expect(cells.length).toBeLessThan(wallCells(grid, viewAt(100)).cells.length);
  });

  it("caps the walls it draws", () => {
    const grid = sceneGrid(expanded(registry), registry);
    expect(wallCells(grid, viewAt(100), 3)).toMatchObject({ truncated: true });
    expect(wallCells(grid, viewAt(100), 3).cells).toHaveLength(3);
  });

  it("takes the walls from the game's world.gridWalls", () => {
    const game = defineGame({
      id: "no-walls",
      types: [],
      actions: [],
      world: { gridWalls: [] },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const noWalls = createRegistry(game);
    const def = { ...yard(), game: "no-walls" } as SceneDefinition;
    const grid = sceneGrid(expandScene(def, noWalls), noWalls);
    expect(grid).not.toBeNull();
    expect(wallCells(grid, viewAt(100)).cells).toEqual([]);
  });

  it("has no walls without a scene grid, and draws metre lines instead of its cells", () => {
    const scene = expanded(registry, yard(null));
    expect(sceneGrid(scene, registry)).toBeNull();
    expect(wallCells(null, viewAt(100))).toEqual({ cells: [], truncated: false });
    const plan = gridLayerPlan(scene, viewAt(100))!;
    const xs = plan.minor.filter(([x1, , x2]) => x1 === x2).map(([x]) => x);
    expect(xs.every((x) => Number.isInteger(x))).toBe(true);
  });

  it("outlines a hex grid's cells, at most SCENE_GRID_MAX_CELLS of them", () => {
    const scene = expanded(registry, yard(HEX));
    const plan = gridLayerPlan(scene, viewAt(100))!;
    expect(plan.cells.length).toBeGreaterThan(20);
    expect(plan.cells.length).toBeLessThanOrEqual(SCENE_GRID_MAX_CELLS);
    expect(plan.cells).toContainEqual(gridGeometry(HEX).corners([0, 0]));
    const far: View = { width: 4000, height: 2400, scale: 6, tx: 0, ty: 0 };
    expect(gridLayerPlan(scene, far)!.cells).toEqual([]);
  });
});

function memoryStorage(entries: Record<string, string> = {}): EditorStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(entries));
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

const sessions: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function setup(ppm: number, storage: EditorStorage) {
  const registry = createRegistry();
  const session = createEditorSession({
    doc: sceneToDoc(yard(), { key: sequentialKeys("l") }),
    origin: ada,
    name: "layer-yard",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  // The window's centre on the scene's centre.
  const store = new Store({
    camera: { position: { x: 10, y: 6 }, scale: ppm },
  } as unknown as GameStoreState);
  render(
    <KitProvider host={{ storage }}>
      <CanvasLayer
        session={session}
        host={null}
        store={store}
        runStore={new Store<LoadedRun | null>(null)}
        notify={notify}
      />
    </KitProvider>,
  );
  const view = viewOf(
    { position: { x: 10, y: 6 }, scale: ppm },
    window.innerWidth,
    window.innerHeight,
  );
  return { session, registry, view };
}

const layer = (id: string) => document.querySelector(`[data-edit-layer="${id}"]`);

describe("the edit overlay's layers", () => {
  it("draws none until the View menu turns one on", () => {
    setup(100, memoryStorage());
    expect(document.querySelector("[data-edit-layers]")).toBeNull();
  });

  for (const ppm of [100, 32]) {
    it(`draws the remembered layers over the scene at ${ppm} px per metre`, () => {
      const storage = memoryStorage({
        [EDIT_LAYERS_KEY]: JSON.stringify({ grid: true, occupancy: true, nav: true }),
      });
      const { registry, view } = setup(ppm, storage);
      const scene = expanded(registry);
      expect(document.querySelector("[data-edit-layers]")?.getAttribute("transform")).toBe(
        `translate(${view.tx} ${view.ty}) scale(${ppm})`,
      );
      expect(layer("grid")?.querySelector("[data-grid-minor]")).toBeTruthy();
      const walls = wallCells(sceneGrid(scene, registry), view).cells;
      expect(layer("occupancy")?.querySelector("path")?.getAttribute("d")).toBe(
        walls.map((c) => polylinePath(c, true)).join(" "),
      );
      const nav = navLayer(scene, registry);
      expect(layer("nav")?.querySelector("[data-nav-areas]")?.getAttribute("d")).toBe(
        nav.areas.map((pts) => polylinePath(pts, true)).join(" "),
      );
      expect(layer("nav")?.querySelector("[data-nav-holes]")?.getAttribute("d")).toBe(
        polylinePath(nav.holes[0]!, true),
      );
      expect(
        layer("nav")?.querySelector("[data-nav-mesh]")?.getAttribute("d")?.split("Z").length,
      ).toBe(nav.triangles.length + 1);
    });
  }

  it("follows the document: a removed wall leaves its cells", () => {
    const storage = memoryStorage({ [EDIT_LAYERS_KEY]: JSON.stringify({ occupancy: true }) });
    const { session } = setup(100, storage);
    const before = layer("occupancy")!.querySelector("path")!.getAttribute("d")!;
    act(() => {
      session.dispatch({ ops: [{ op: "remove", refs: ["pillar"] }] });
    });
    const after = layer("occupancy")!.querySelector("path")!.getAttribute("d")!;
    expect(after.split("Z").length).toBeLessThan(before.split("Z").length);
    expect(layer("grid")).toBeNull();
    expect(layer("nav")).toBeNull();
  });
});
