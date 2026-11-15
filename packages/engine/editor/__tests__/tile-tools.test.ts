import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";

import { bindSceneDoc } from "../../collab/bind";
import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { decodeCell, encodeCell, transformCell } from "../../game/tile-cell";
import type { TilesetFile } from "../../project/kinds/tileset";
import { encodeRow, readCell, type GridCells } from "../../scene/grid";
import { MAX_PAINT_CELLS } from "../../scene/ops-schema";
import type { EntityDef, RuntimeEntity, SceneDefinition } from "../../scene/types";
import { createToolRouter } from "../../tool-router";
import {
  autotileEdits,
  cellLine,
  floodCells,
  TILE_FILL_CAP,
  tilePaintBatch,
  turnBrush,
  turnedStamp,
} from "../builtin/tile-tools";
import { createEditorSession, type EditorSession } from "../session";
import { setTileBrush, setTileRule } from "../store";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP } from "../tools";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
/** Screen px per metre; a 0.25 m cell is 25 screen px. */
const S = 100;
const CELL = 0.25;

const strip = (rows: number[][]): GridCells => ({ "0,0": rows.map((r) => encodeRow(r)) });

/** Tiles 4–7 are ground: an edge16 rule picks 5 for a cell with ground east, 6 east and west, 7 west. */
const sheet: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "sheet",
  tile: [25, 25],
  columns: 4,
  tiles: [4, 5, 6, 7].map((id) => ({ id, tags: ["ground"] })),
  rules: [
    {
      id: "ground",
      kind: "edge16",
      terrain: "ground",
      tiles: { "4": 5, "68": 6, "64": 7 },
      fallback: 4,
    },
  ],
};

const scene = (entities: EntityDef[]): SceneDefinition => ({
  v: 5,
  name: "tiles",
  bounds: [0, 0, 10, 10],
  settings: { grid: { kind: "square", cell: [CELL, CELL] } },
  entities,
});

const floor: EntityDef = {
  id: "floor",
  type: "tilemap",
  at: [1, 1],
  tileset: "sheet",
  cells: strip([[1, 2]]),
};

type Rig = {
  session: EditorSession;
  host: ToolHost;
  writes: () => number;
  map: (id?: string) => EntityDef;
  cell: (c: number, r: number, id?: string) => number;
  /** Screen px of the centre of map cell (c, r) for a map whose cell (0, 0) has its top-left at `origin`. */
  at: (c: number, r: number, origin?: [number, number]) => [number, number];
  ptr: (type: "down" | "move" | "up", xy: [number, number], alt?: boolean) => void;
  key: (key: string) => boolean;
};

const rigs: Rig[] = [];
afterEach(() => {
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
});

function rig(entities: EntityDef[] = [floor]): Rig {
  const doc = sceneToDoc(scene(entities), { key: sequentialKeys("k") });
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "tiles",
    registry,
    issuesDebounceMs: 0,
  });
  const held = new Map<string, RuntimeEntity>();
  bindSceneDoc(
    doc,
    {
      load: (s) => (s.entities.forEach((e) => held.set(e.id, e)), { ok: true }),
      add: () => ({ ok: true }),
      update: () => ({ ok: true }),
      remove: () => {},
    },
    registry,
  );
  const router = createToolRouter();
  let clock = 0;
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x / S, y / S],
    scale: () => S,
    snap: { ...DEFAULT_SNAP, enabled: false },
    now: () => clock,
    tileset: (id) => (id === "sheet" ? sheet : undefined),
  });
  let writes = 0;
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (tr.origin === ada) writes++;
  });
  const map = (id = "floor") => session.getDoc().entities!.find((e) => e.id === id)!;
  const r: Rig = {
    session,
    host,
    writes: () => writes,
    map,
    cell: (c, row, id) => readCell((map(id).cells ?? {}) as GridCells, c, row),
    at: (c, row, origin = [1, 1]) => [
      (origin[0] + (c + 0.5) * CELL) * S,
      (origin[1] + (row + 0.5) * CELL) * S,
    ],
    ptr(type, [x, y], alt = false) {
      clock += 10_000;
      router.dispatch({
        kind: "pointer",
        type,
        screen: { x, y },
        button: 0,
        deltaY: 0,
        native: { shiftKey: false, altKey: alt, ctrlKey: false, metaKey: false } as PointerEvent,
      });
    },
    key: (key) =>
      host.key({ type: "down", key, repeat: false, shift: false, alt: false, mod: false }),
  };
  rigs.push(r);
  return r;
}

const row = (r: Rig, n: number, cols: number) =>
  Array.from({ length: cols }, (_, c) => r.cell(c, n));

describe("the tile tools", () => {
  it("paints a stroke as one batch and one undo step, filling gaps between samples", () => {
    const r = rig();
    setTileBrush(r.session.store, { tiles: [[3]] });
    r.host.setTool("tile-brush");
    r.ptr("down", r.at(0, 0));
    r.ptr("move", r.at(4, 0));
    r.ptr("move", r.at(4, 2));
    r.ptr("up", r.at(4, 2));
    expect(r.writes()).toBe(1);
    expect(row(r, 0, 5)).toEqual([3, 3, 3, 3, 3]);
    expect(r.cell(4, 1)).toBe(3);
    expect(r.cell(4, 2)).toBe(3);
    expect(r.session.undo()).toBe(true);
    expect(row(r, 0, 5)).toEqual([1, 2, 0, 0, 0]);
    expect(r.cell(4, 2)).toBe(0);
  });

  it("paints a rectangle on release", () => {
    const r = rig();
    setTileBrush(r.session.store, { tiles: [[3]] });
    r.host.setTool("tile-rect");
    r.ptr("down", r.at(2, 1));
    r.ptr("move", r.at(0, 2));
    expect(r.writes()).toBe(0);
    expect(r.host.overlay().readout?.text).toBe("3 × 2 cells");
    r.ptr("up", r.at(0, 2));
    expect(r.writes()).toBe(1);
    expect(row(r, 1, 4)).toEqual([3, 3, 3, 0]);
    expect(row(r, 2, 4)).toEqual([3, 3, 3, 0]);
    expect(row(r, 0, 2)).toEqual([1, 2]);
  });

  it("fills a bounded region and refuses one past its cap with a status message", () => {
    const r = rig();
    setTileBrush(r.session.store, { tiles: [[3]] });
    r.host.setTool("tile-fill");
    r.ptr("down", r.at(0, 0));
    r.ptr("up", r.at(0, 0));
    expect(r.writes()).toBe(1);
    expect(row(r, 0, 2)).toEqual([3, 2]);

    r.ptr("down", r.at(5, 5));
    r.ptr("up", r.at(5, 5));
    expect(r.writes()).toBe(1);
    expect(r.session.store.state.notice).toContain("65,536");
    expect(TILE_FILL_CAP).toBe(65_536);
    expect(floodCells(strip([[1, 1, 2]]), [0, 0], 2)).toHaveLength(2);
    expect(floodCells(strip([[1, 1, 1]]), [0, 0], 2)).toBeNull();
  });

  it("erases the cells under the stroke", () => {
    const r = rig();
    setTileBrush(r.session.store, { tiles: [[3]] });
    r.host.setTool("tile-brush");
    r.ptr("down", r.at(2, 0));
    r.ptr("up", r.at(2, 0));
    r.host.setTool("tile-erase");
    r.ptr("down", r.at(0, 0));
    r.ptr("move", r.at(1, 0));
    r.ptr("up", r.at(1, 0));
    expect(r.writes()).toBe(2);
    expect(row(r, 0, 3)).toEqual([0, 0, 3]);
  });

  it("picks the brush from a cell, a stamp from a drag, and with Alt on the brush", () => {
    const r = rig();
    r.host.setTool("tile-pick");
    r.ptr("down", r.at(1, 0));
    r.ptr("up", r.at(1, 0));
    expect(r.session.store.state.tileBrush).toEqual({ tiles: [[2]] });
    expect(r.host.tool()).toBe("tile-brush");

    r.ptr("down", r.at(0, 0), true);
    r.ptr("up", r.at(0, 0), true);
    expect(r.session.store.state.tileBrush).toEqual({ tiles: [[1]] });
    expect(r.writes()).toBe(0);

    r.host.setTool("tile-pick");
    r.ptr("down", r.at(0, 0));
    r.ptr("move", r.at(1, 0));
    r.ptr("up", r.at(1, 0));
    expect(r.session.store.state.tileBrush).toEqual({ tiles: [[1, 2]] });

    r.host.setTool("tile-pick");
    r.ptr("down", r.at(6, 6));
    r.ptr("up", r.at(6, 6));
    expect(r.session.store.state.notice).toBe("There's no tile to pick there.");
  });

  it("turns and mirrors a stamp with R, F and V, its tiles' flags with it", () => {
    const r = rig();
    setTileBrush(r.session.store, { tiles: [[1, 2]] });
    r.host.setTool("tile-brush");
    expect(r.key("r")).toBe(true);
    const turned = r.session.store.state.tileBrush;
    expect(turned.flip).toEqual({ rot: 1, flip: false });
    expect(turnedStamp(turned)).toEqual([
      [transformCell(1, { rot: 1, flip: false })],
      [transformCell(2, { rot: 1, flip: false })],
    ]);
    r.ptr("down", r.at(0, 2));
    r.ptr("up", r.at(0, 2));
    expect(r.cell(0, 2)).toBe(transformCell(1, { rot: 1, flip: false }));
    expect(r.cell(0, 3)).toBe(transformCell(2, { rot: 1, flip: false }));
    expect(decodeCell(r.cell(0, 2))?.id).toBe(0);

    // A mirror composes with the turn; mirroring twice either way is the identity.
    const b = { tiles: [[1]] };
    for (const how of ["flip-x", "flip-y"] as const)
      expect(turnBrush(turnBrush(b, how), how)).toEqual(b);
    expect(turnBrush(turnBrush(turnBrush(b, "cw"), "flip-x"), "cw").flip).toEqual({
      rot: 0,
      flip: true,
    });
    expect(r.key("f")).toBe(true);
    expect(r.key("v")).toBe(true);
    expect(r.host.command("brush-ccw")).toBe(true);
  });

  it("leaves r, f and v to their edit bindings outside a tile tool", () => {
    const r = rig();
    const brush = r.session.store.state.tileBrush;
    for (const tool of ["select", "box", "pan"]) {
      r.host.setTool(tool);
      for (const k of ["r", "f", "v"]) expect(r.key(k)).toBe(false);
    }
    expect(r.session.store.state.tileBrush).toBe(brush);
  });

  it("paints terrain and the rule's tiles over it and its border in one batch", () => {
    const r = rig();
    setTileRule(r.session.store, "ground");
    r.host.setTool("tile-auto");
    r.ptr("down", r.at(0, 4));
    r.ptr("move", r.at(2, 4));
    r.ptr("up", r.at(2, 4));
    expect(r.writes()).toBe(1);
    const tile = (id: number) => encodeCell({ id, flipX: false, flipY: false, flipD: false });
    expect(row(r, 4, 4)).toEqual([tile(5), tile(6), tile(7), 0]);
    expect(
      autotileEdits({}, sheet, sheet.rules![0]!, [
        [0, 0],
        [1, 0],
      ]),
    ).toEqual([
      [0, 0, tile(5)],
      [1, 0, tile(7)],
    ]);
  });

  it("refuses the autotile brush without a rule, and any tool with no map to paint", () => {
    const r = rig([floor, { ...floor, id: "wall", at: [5, 5] }]);
    setTileRule(r.session.store, "water");
    r.host.setTool("tile-auto");
    r.ptr("down", r.at(0, 0));
    r.ptr("up", r.at(0, 0));
    expect(r.session.store.state.notice).toContain("no autotile rule");
    r.host.setTool("tile-brush");
    r.ptr("down", [900, 900]);
    r.ptr("up", [900, 900]);
    expect(r.session.store.state.notice).toBe("Select a tilemap to paint, or point at one.");
    expect(r.writes()).toBe(0);
  });

  it("paints a tilemap under a quarter-turned parent on the cells under the pointer", () => {
    const r = rig([
      { id: "room", type: "node", at: [2, 2], rot: 90 },
      {
        id: "floor",
        type: "tilemap",
        parent: "room",
        at: [0, 0],
        tileset: "sheet",
        cells: strip([[1]]),
      },
    ]);
    r.session.select(["floor"]);
    setTileBrush(r.session.store, { tiles: [[3]] });
    r.host.setTool("tile-brush");
    // The parent's quarter turn puts the map's own cell (0, 0) at world cell (-1, 0) from its origin.
    const origin: [number, number] = [2, 2];
    expect(readCell(resolvedCells(r), -1, 0)).toBe(transformCell(1, { rot: 1, flip: false }));
    r.ptr("down", r.at(-1, 1, origin));
    r.ptr("up", r.at(-1, 1, origin));
    expect(r.writes()).toBe(1);
    expect(readCell(resolvedCells(r), -1, 1)).toBe(3);
    // World cell (-1, 1) is the map's own cell (1, 0), its flags turned back a quarter.
    expect(decodeCell(r.cell(1, 0))?.id).toBe(2);
    expect(r.cell(1, 0)).toBe(transformCell(3, { rot: 3, flip: false }));
  });

  it("shares the brush rectangle under the cursor, and clears it with the tool", () => {
    const r = rig();
    const share = vi.spyOn(r.session, "setBrush");
    setTileBrush(r.session.store, { tiles: [[3, 3]] });
    r.host.setTool("tile-brush");
    r.ptr("move", r.at(0, 0));
    expect(share).toHaveBeenLastCalledWith({ map: "floor", rect: { c0: 0, r0: 0, c1: 1, r1: 0 } });
    r.host.setTool("select");
    expect(share).toHaveBeenLastCalledWith(undefined);
  });
});

function resolvedCells(r: Rig): GridCells {
  return (r.session.getResolved().entities!.find((e) => e.id === "floor")!.cells ??
    {}) as GridCells;
}

describe("tilePaintBatch", () => {
  it("splits edits past the per-op cap and keeps rects before cells", () => {
    const cells = Array.from({ length: MAX_PAINT_CELLS + 1 }, (_, i): [number, number, number] => [
      i,
      0,
      1,
    ]);
    const batch = tilePaintBatch("floor", { cells, rects: [[0, 0, 299, 299, 2]] });
    expect(batch.ops.map((o) => o.op)).toEqual(Array(batch.ops.length).fill("paintCells"));
    const count = (o: (typeof batch.ops)[number]) =>
      o.op === "paintCells"
        ? (o.cells?.length ?? 0) +
          (o.rects ?? []).reduce((n, [c0, r0, c1, r1]) => n + (c1 - c0 + 1) * (r1 - r0 + 1), 0)
        : 0;
    for (const o of batch.ops) expect(count(o)).toBeLessThanOrEqual(MAX_PAINT_CELLS);
    expect(batch.ops.reduce((n, o) => n + count(o), 0)).toBe(MAX_PAINT_CELLS + 1 + 300 * 300);
    const firstCells = batch.ops.findIndex((o) => o.op === "paintCells" && o.cells);
    expect(batch.ops.slice(firstCells).every((o) => o.op === "paintCells" && !o.rects)).toBe(true);
    expect(cellLine([0, 0], [3, 1])).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
  });
});
