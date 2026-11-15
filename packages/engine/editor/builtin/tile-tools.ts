import { TILEMAP_PRIMITIVE } from "../../game/primitives";
import { decodeCell, encodeCell, transformCell, type TileTurn } from "../../game/tile-cell";
import { TILE_TOOL_IDS, type Registry, type TileToolId } from "../../game/types";
import {
  cellKey,
  gridGeometry,
  type Cell,
  type CellBounds,
  type GridGeometry,
} from "../../grid/geometry";
import type { AutotileRule, TilesetFile } from "../../project/kinds/tileset";
import {
  gridCellBounds,
  paintGrid,
  readCell,
  type CellEdit,
  type CellRect,
  type GridCells,
} from "../../scene/grid";
import { MAX_PAINT_CELLS } from "../../scene/ops-schema";
import type {
  EntityDef,
  OpBatch,
  Pt,
  Ref,
  SceneDefinition,
  SceneOp,
  ShapeObj,
} from "../../scene/types";
import { applyAutotile } from "../../tiles/autotile";
import {
  defineEditorTool,
  type EditorTool,
  type EditorToolContext,
  type EditorToolDef,
  type ToolOverlay,
  type ToolPointerEvent,
} from "../tools";

export { TILE_TOOL_IDS, type TileToolId };

/** What the tile tools paint: a stamp of cell values, rows top first, and the turn `R`/`F`/`V` gave it. */
export type TileBrush = {
  tiles: readonly (readonly number[])[];
  flip?: TileTurn;
};

/** The largest flood a fill paints; a larger region is refused. */
export const TILE_FILL_CAP = 65_536;

/** The tilemap field the tools paint. */
export const TILEMAP_CELLS_FIELD = "cells";

const cellsOfRect = ([c0, r0, c1, r1]: CellRect) => (c1 - c0 + 1) * (r1 - r0 + 1);

/**
 * The one builder of a tile edit's ops: `paintCells` on the tilemap's
 * `cells`, as one batch, split so no op passes the per-op cap. Rects go
 * before single cells, as `paintCells` applies them, so a cell still wins
 * over a rect under it. Every tool, `scene paint` and MCP emit through it.
 */
export function tilePaintBatch(
  map: Ref,
  edits: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] },
  label?: string,
): OpBatch {
  const ops: SceneOp[] = [];
  let rects: CellRect[] = [];
  let count = 0;
  const flushRects = () => {
    if (rects.length > 0)
      ops.push({ op: "paintCells", ref: map, field: TILEMAP_CELLS_FIELD, rects });
    rects = [];
    count = 0;
  };
  for (const given of edits.rects ?? []) {
    const [a0, b0, a1, b1, value] = given;
    const c0 = Math.min(a0, a1);
    const c1 = Math.max(a0, a1);
    const r0 = Math.min(b0, b1);
    const r1 = Math.max(b0, b1);
    const width = c1 - c0 + 1;
    const band = Math.max(1, Math.floor(MAX_PAINT_CELLS / width));
    for (let r = r0; r <= r1; r += band) {
      if (width > MAX_PAINT_CELLS) {
        for (let c = c0; c <= c1; c += MAX_PAINT_CELLS) {
          flushRects();
          rects.push([c, r, Math.min(c1, c + MAX_PAINT_CELLS - 1), r, value]);
          flushRects();
        }
        continue;
      }
      const rect: CellRect = [c0, r, c1, Math.min(r1, r + band - 1), value];
      if (count + cellsOfRect(rect) > MAX_PAINT_CELLS) flushRects();
      rects.push(rect);
      count += cellsOfRect(rect);
    }
  }
  flushRects();
  const cells = edits.cells ?? [];
  for (let k = 0; k < cells.length; k += MAX_PAINT_CELLS)
    ops.push({
      op: "paintCells",
      ref: map,
      field: TILEMAP_CELLS_FIELD,
      cells: cells.slice(k, k + MAX_PAINT_CELLS),
    });
  return { label: label ?? `Paint ${map}`, ops };
}

// ─── The brush ───────────────────────────────────────────

/** How `R`, `Shift+R`, `F` and `V` turn the brush. */
export type BrushTurn = "cw" | "ccw" | "flip-x" | "flip-y";

const UNTURNED: TileTurn = { rot: 0, flip: false };

/** A brush turn composed with another: a quarter turn clockwise or back, or a mirror across either axis. */
export function turnBrush(brush: TileBrush, how: BrushTurn): TileBrush {
  const { rot, flip } = brush.flip ?? UNTURNED;
  const next: TileTurn =
    how === "cw"
      ? { rot: ((rot + 1) % 4) as TileTurn["rot"], flip }
      : how === "ccw"
        ? { rot: ((rot + 3) % 4) as TileTurn["rot"], flip }
        : how === "flip-x"
          ? { rot: ((4 - rot) % 4) as TileTurn["rot"], flip: !flip }
          : { rot: ((6 - rot) % 4) as TileTurn["rot"], flip: !flip };
  return { tiles: brush.tiles, ...(next.rot !== 0 || next.flip ? { flip: next } : {}) };
}

/** The brush's stamp as it paints: mirrored, then turned clockwise, each value's flags turned with it. */
export function turnedStamp(brush: TileBrush): number[][] {
  const turn = brush.flip ?? UNTURNED;
  let rows = brush.tiles.map((row) => (turn.flip ? [...row].reverse() : [...row]));
  for (let i = 0; i < turn.rot; i++) {
    const h = rows.length;
    const w = Math.max(0, ...rows.map((r) => r.length));
    const next: number[][] = Array.from({ length: w }, () => Array<number>(h).fill(0));
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) next[c]![h - 1 - r] = rows[r]![c] ?? 0;
    rows = next;
  }
  return rows.map((row) => row.map((v) => transformCell(v, turn)));
}

/** The stamp's size in cells, columns then rows. */
const stampSize = (stamp: readonly (readonly number[])[]): [number, number] => [
  Math.max(1, ...stamp.map((r) => r.length)),
  Math.max(1, stamp.length),
];

/** The cells a stamp paints with its top-left on `at`; its empty cells paint nothing. */
export function stampCells(stamp: readonly (readonly number[])[], [col, row]: Cell): CellEdit[] {
  const out: CellEdit[] = [];
  stamp.forEach((values, r) =>
    values.forEach((v, c) => {
      if (v !== 0) out.push([col + c, row + r, v]);
    }),
  );
  return out;
}

/** The cells on the line from `a` to `b`, both ends included (Bresenham). */
export function cellLine([c0, r0]: Cell, [c1, r1]: Cell): Cell[] {
  const out: Cell[] = [];
  const dc = Math.abs(c1 - c0);
  const dr = -Math.abs(r1 - r0);
  const sc = c0 < c1 ? 1 : -1;
  const sr = r0 < r1 ? 1 : -1;
  let err = dc + dr;
  let c = c0;
  let r = r0;
  for (;;) {
    out.push([c, r]);
    if (c === c1 && r === r1) return out;
    const e2 = 2 * err;
    if (e2 >= dr) {
      err += dr;
      c += sc;
    }
    if (e2 <= dc) {
      err += dc;
      r += sr;
    }
  }
}

/**
 * The 4-connected cells holding `start`'s value, in breadth-first order
 * from it; null when there are more than `cap`, so an open region refuses
 * rather than painting without end.
 */
export function floodCells(grid: GridCells, start: Cell, cap = TILE_FILL_CAP): Cell[] | null {
  const value = readCell(grid, start[0], start[1]);
  const seen = new Set<number>([cellKey(start)]);
  const out: Cell[] = [];
  const queue: Cell[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    out.push(at);
    if (out.length > cap) return null;
    const [c, r] = at;
    for (const next of [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ] as Cell[]) {
      const k = cellKey(next);
      if (seen.has(k) || readCell(grid, next[0], next[1]) !== value) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return out;
}

/** The stamp repeated over `cells`, lined up on `origin`; its empty cells leave a cell as it is. */
function tiledOver(
  stamp: readonly (readonly number[])[],
  origin: Cell,
  cells: Iterable<Cell>,
): CellEdit[] {
  const [w, h] = stampSize(stamp);
  const out: CellEdit[] = [];
  for (const [c, r] of cells) {
    const sr = (((r - origin[1]) % h) + h) % h;
    const sc = (((c - origin[0]) % w) + w) % w;
    const v = stamp[sr]?.[sc] ?? 0;
    if (v !== 0) out.push([c, r, v]);
  }
  return out;
}

function* rectCells({ c0, r0, c1, r1 }: CellBounds): Generator<Cell> {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) yield [c, r];
}

/** Corners in any order, as bounds. */
const boundsOf = (a: Cell, b: Cell): CellBounds => ({
  c0: Math.min(a[0], b[0]),
  r0: Math.min(a[1], b[1]),
  c1: Math.max(a[0], b[0]),
  r1: Math.max(a[1], b[1]),
});

// ─── Autotiling ──────────────────────────────────────────

/** The rule the autotile brush paints with: `ruleId`'s, else the tileset's first. */
export function autotileRule(
  tileset: TilesetFile,
  ruleId: string | null,
): AutotileRule | undefined {
  const rules = tileset.rules ?? [];
  return ruleId === null ? rules[0] : rules.find((r) => r.id === ruleId);
}

/**
 * Terrain cells painted with the rule's fallback tile, then the rule's
 * tiles over their bounds and a one-cell border: one list of edits, each
 * cell once. A cell counts as terrain when its tile has the rule's tag.
 */
export function autotileEdits(
  grid: GridCells,
  tileset: TilesetFile,
  rule: AutotileRule,
  cells: readonly Cell[],
): CellEdit[] {
  if (cells.length === 0) return [];
  const ids = new Set<number>();
  for (const def of tileset.tiles ?? []) if (def.tags?.includes(rule.terrain)) ids.add(def.id);
  const isTerrain = (value: number) => {
    const tile = decodeCell(value);
    return tile !== null && ids.has(tile.id);
  };
  const terrain = encodeCell({ id: rule.fallback, flipX: false, flipY: false, flipD: false });
  const painted = cells.map(([c, r]): CellEdit => [c, r, terrain]);
  const next = paintGrid(grid, { cells: painted }).grid;
  const rect = { ...boundsOf(cells[0]!, cells[0]!) };
  for (const [c, r] of cells) {
    rect.c0 = Math.min(rect.c0, c);
    rect.r0 = Math.min(rect.r0, r);
    rect.c1 = Math.max(rect.c1, c);
    rect.r1 = Math.max(rect.r1, r);
  }
  const merged = new Map<number, CellEdit>();
  for (const e of [...painted, ...applyAutotile(next, tileset, rule, rect, isTerrain)])
    merged.set(cellKey([e[0], e[1]]), e);
  return [...merged.values()];
}

// ─── Which map, which cell ───────────────────────────────

/** A tilemap as the tools paint it: its world-frame cells in the resolved view, and the grid they sit on. */
export type TileTarget = {
  ref: Ref;
  entity: EntityDef;
  cells: GridCells;
  geo: GridGeometry;
  cell: [w: number, h: number];
  /** The scene grid cell the map's own cell (0, 0) is. */
  offset: Cell;
};

export function isTilemapType(registry: Registry, type: string): boolean {
  const t = registry.types.get(type);
  return (
    t !== undefined && (t.type === TILEMAP_PRIMITIVE.type || t.base === TILEMAP_PRIMITIVE.type)
  );
}

/** `ref`'s tilemap in the resolved view; null for anything else, or a scene without a grid. */
export function tileTarget(def: SceneDefinition, registry: Registry, ref: Ref): TileTarget | null {
  const grid = def.settings?.grid;
  const entity = def.entities?.find((e) => e.id === ref);
  if (!grid || !entity || !isTilemapType(registry, entity.type)) return null;
  const at = Array.isArray(entity.at) ? (entity.at as Pt) : ([0, 0] as Pt);
  const geo = gridGeometry(grid);
  const [w, h] = grid.cell;
  const cells = (entity[TILEMAP_CELLS_FIELD] ?? {}) as GridCells;
  return {
    ref,
    entity,
    cells,
    geo,
    cell: [w, h],
    offset: geo.cellAt([at[0] + w / 2, at[1] + h / 2]),
  };
}

/** The map cell under a world point. */
export function cellUnder(t: TileTarget, world: Pt): Cell {
  const [c, r] = t.geo.cellAt(world);
  return [c - t.offset[0], r - t.offset[1]];
}

/** The world box a span of map cells covers. */
export function cellsBox(t: TileTarget, b: CellBounds): ShapeObj {
  const [w, h] = t.cell;
  const [x0, y0] = t.geo.center([b.c0 + t.offset[0], b.r0 + t.offset[1]]);
  const [x1, y1] = t.geo.center([b.c1 + t.offset[0], b.r1 + t.offset[1]]);
  const left = Math.min(x0, x1) - w / 2;
  const top = Math.min(y0, y1) - h / 2;
  const right = Math.max(x0, x1) + w / 2;
  const bottom = Math.max(y0, y1) + h / 2;
  return {
    type: "poly",
    pts: [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
  };
}

/**
 * The tilemap a tool paints: the selected one, else the topmost whose
 * painted cells reach the point, else the scene's only tilemap.
 */
export function tileTargetAt(ctx: EditorToolContext, world: Pt): TileTarget | null {
  const def = ctx.getDoc();
  const sel = ctx.selection();
  if (sel.length === 1) {
    const t = tileTarget(def, ctx.registry, sel[0]!);
    if (t) return t;
  }
  const maps = (def.entities ?? []).filter((e) => isTilemapType(ctx.registry, e.type));
  for (let i = maps.length - 1; i >= 0; i--) {
    const t = tileTarget(def, ctx.registry, maps[i]!.id);
    const b = t && gridCellBounds(t.cells);
    if (!t || !b) continue;
    const [c, r] = cellUnder(t, world);
    if (c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1) return t;
  }
  return maps.length === 1 ? tileTarget(def, ctx.registry, maps[0]!.id) : null;
}

// ─── The tools ───────────────────────────────────────────

const TILE_TOOL_TEXT: Record<TileToolId, { label: string; description: string }> = {
  "tile-brush": {
    label: "Tile brush",
    description: "Paint the brush's tiles under the stroke; Alt-click picks a cell's tile.",
  },
  "tile-rect": { label: "Tile rectangle", description: "Drag a rectangle and fill it on release." },
  "tile-fill": { label: "Tile fill", description: "Flood the connected cells of one tile." },
  "tile-erase": { label: "Tile eraser", description: "Erase the cells under the stroke." },
  "tile-pick": {
    label: "Tile picker",
    description: "Set the brush from a cell, or drag over cells for a stamp.",
  },
  "tile-auto": {
    label: "Autotile brush",
    description: "Paint terrain and let the tileset's rule choose the tiles.",
  },
};

/** The commands the tile tools take beside `R`/`F`/`V`: `brush-cw`, `brush-ccw`, `brush-flip-x`, `brush-flip-y`. */
export const BRUSH_COMMANDS: Readonly<Record<string, BrushTurn>> = {
  "brush-cw": "cw",
  "brush-ccw": "ccw",
  "brush-flip-x": "flip-x",
  "brush-flip-y": "flip-y",
};

/** The brush key a tile tool takes: `R` turns clockwise (`Shift+R` back), `F` mirrors across, `V` up and down. */
function brushKeyTurn(key: string, shift: boolean): BrushTurn | null {
  switch (key.toLowerCase()) {
    case "r":
      return shift ? "ccw" : "cw";
    case "f":
      return shift ? null : "flip-x";
    case "v":
      return shift ? null : "flip-y";
    default:
      return null;
  }
}

const UNSET_MAP = "Select a tilemap to paint, or point at one.";

type Gesture =
  | { kind: "stroke"; t: TileTarget; last: Cell; cells: Map<number, Cell> }
  | { kind: "rect" | "pick"; t: TileTarget; from: Cell; to: Cell };

function createTileTool(id: TileToolId, ctx: EditorToolContext): EditorTool {
  let gesture: Gesture | null = null;
  let hover: { t: TileTarget; cell: Cell } | null = null;
  let shared: string | null = null;

  const brush = () => ctx.tiles?.brush() ?? { tiles: [[1]] };
  const refuse = (text: string) => ctx.tiles?.refuse(text);
  const stamp = () => turnedStamp(brush());
  const footprint = (): [number, number] => (id === "tile-brush" ? stampSize(stamp()) : [1, 1]);

  /** The cells the gesture or the hover covers, for the overlay and presence. */
  function covered(): { t: TileTarget; rect: CellBounds } | null {
    if (gesture && gesture.kind !== "stroke")
      return { t: gesture.t, rect: boundsOf(gesture.from, gesture.to) };
    if (!hover) return null;
    const [w, h] = footprint();
    const [c, r] = hover.cell;
    return { t: hover.t, rect: { c0: c, r0: r, c1: c + w - 1, r1: r + h - 1 } };
  }

  function share(): void {
    const cov = covered();
    const next = cov ? { map: cov.t.ref, rect: cov.rect } : undefined;
    const sig = next ? JSON.stringify(next) : null;
    if (sig === shared) return;
    shared = sig;
    ctx.tiles?.shareBrush(next);
  }

  /** What the gesture so far paints, with cells already holding their value left out. */
  function edits(g: Gesture): CellEdit[] | null {
    const { t } = g;
    let out: CellEdit[];
    if (g.kind === "stroke") {
      const cells = [...g.cells.values()];
      if (id === "tile-erase") out = cells.map(([c, r]): CellEdit => [c, r, 0]);
      else if (id === "tile-auto") {
        const tileset = tilesetOf(t);
        const rule = tileset && autotileRule(tileset, ctx.tiles?.rule() ?? null);
        if (!tileset || !rule) return null;
        out = autotileEdits(t.cells, tileset, rule, cells);
      } else {
        const s = stamp();
        const merged = new Map<number, CellEdit>();
        for (const at of cells)
          for (const e of stampCells(s, at)) merged.set(cellKey([e[0], e[1]]), e);
        out = [...merged.values()];
      }
    } else out = tiledOver(stamp(), g.from, rectCells(boundsOf(g.from, g.to)));
    return out.filter(([c, r, v]) => readCell(t.cells, c, r) !== v);
  }

  function tilesetOf(t: TileTarget): TilesetFile | undefined {
    const id = t.entity.tileset;
    return typeof id === "string" ? ctx.tiles?.tileset(id) : undefined;
  }

  function preview(): void {
    if (!gesture || gesture.kind === "pick") return;
    const e = edits(gesture);
    ctx.preview(e && e.length > 0 ? tilePaintBatch(gesture.t.ref, { cells: e }) : null);
  }

  function finish(): void {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.kind === "pick") return pick(g.t, boundsOf(g.from, g.to));
    const e = edits(g);
    if (!e || e.length === 0) {
      ctx.preview(null);
      return;
    }
    const label = `${TILE_TOOL_TEXT[id].label}: ${g.t.ref}`;
    if (!ctx.commit(tilePaintBatch(g.t.ref, { cells: e }, label)))
      refuse(`Couldn't paint ${g.t.ref}.`);
  }

  function pick(t: TileTarget, b: CellBounds): void {
    const tiles: number[][] = [];
    for (let r = b.r0; r <= b.r1; r++) {
      const row: number[] = [];
      for (let c = b.c0; c <= b.c1; c++) row.push(readCell(t.cells, c, r));
      tiles.push(row);
    }
    if (tiles.every((row) => row.every((v) => v === 0)))
      return refuse("There's no tile to pick there.");
    ctx.tiles?.setBrush({ tiles });
    if (id === "tile-pick") ctx.setTool("tile-brush");
  }

  function fill(t: TileTarget, at: Cell): void {
    const cells = floodCells(t.cells, at);
    if (!cells)
      return refuse(
        `That region is larger than a fill paints (${TILE_FILL_CAP.toLocaleString("en-US")} cells); close it off first.`,
      );
    const e = tiledOver(stamp(), at, cells).filter(([c, r, v]) => readCell(t.cells, c, r) !== v);
    if (e.length === 0) return;
    if (!ctx.commit(tilePaintBatch(t.ref, { cells: e }, `${TILE_TOOL_TEXT[id].label}: ${t.ref}`)))
      refuse(`Couldn't paint ${t.ref}.`);
  }

  function down(e: ToolPointerEvent): void {
    const t = tileTargetAt(ctx, e.world);
    if (!t) return refuse(UNSET_MAP);
    const layer = typeof t.entity.layer === "string" ? t.entity.layer : undefined;
    if (layer && ctx.layers().locked.has(layer)) return refuse(`Layer ${layer} is locked.`);
    const cell = cellUnder(t, e.world);
    if (id === "tile-brush" && e.alt) return pick(t, boundsOf(cell, cell));
    if (id === "tile-fill") return fill(t, cell);
    if (id === "tile-auto") {
      const tileset = tilesetOf(t);
      if (!tileset) return refuse(`${t.ref}'s tileset isn't open.`);
      if (!autotileRule(tileset, ctx.tiles?.rule() ?? null))
        return refuse(`${t.ref}'s tileset has no autotile rule to paint with.`);
    }
    if (id === "tile-rect" || id === "tile-pick")
      gesture = { kind: id === "tile-rect" ? "rect" : "pick", t, from: cell, to: cell };
    else gesture = { kind: "stroke", t, last: cell, cells: new Map([[cellKey(cell), cell]]) };
    preview();
  }

  function moveTo(world: Pt): void {
    if (!gesture) return;
    const cell = cellUnder(gesture.t, world);
    if (gesture.kind === "stroke") {
      if (cell[0] === gesture.last[0] && cell[1] === gesture.last[1]) return;
      for (const at of cellLine(gesture.last, cell)) gesture.cells.set(cellKey(at), at);
      gesture.last = cell;
    } else {
      if (cell[0] === gesture.to[0] && cell[1] === gesture.to[1]) return;
      gesture.to = cell;
    }
    preview();
  }

  function track(world: Pt): void {
    const t = gesture?.t ?? tileTargetAt(ctx, world);
    hover = t ? { t, cell: cellUnder(t, world) } : null;
  }

  function turn(how: BrushTurn): boolean {
    ctx.tiles?.setBrush(turnBrush(brush(), how));
    preview();
    share();
    ctx.invalidate();
    return true;
  }

  return {
    pointer(e) {
      if (e.type === "wheel") return false;
      if (e.type === "down" && e.button !== 0) return false;
      if (e.type === "down") down(e);
      else if (e.type === "move") {
        if (e.button === 0) moveTo(e.world);
      } else if (e.type === "up") {
        moveTo(e.world);
        finish();
      }
      track(e.world);
      share();
      ctx.invalidate();
      return e.type !== "move" || gesture !== null;
    },
    key(e) {
      if (e.type !== "down" || e.mod || e.alt) return false;
      const how = brushKeyTurn(e.key, e.shift);
      return how !== null && turn(how);
    },
    command(command) {
      const how = BRUSH_COMMANDS[command];
      return how !== undefined && turn(how);
    },
    cancel() {
      if (!gesture) return false;
      gesture = null;
      ctx.preview(null);
      share();
      return true;
    },
    gesture: () => gesture !== null,
    cursor: () => "crosshair",
    overlay() {
      const cov = covered();
      const out: ToolOverlay = {};
      if (cov) {
        const tone = gesture ? "selected" : "hover";
        out.outlines = [{ shape: cellsBox(cov.t, cov.rect), tone, ref: cov.t.ref }];
        if (gesture && gesture.kind !== "stroke") {
          const w = cov.rect.c1 - cov.rect.c0 + 1;
          const h = cov.rect.r1 - cov.rect.r0 + 1;
          const box = cellsBox(cov.t, cov.rect);
          if (box.type === "poly") out.readout = { at: box.pts[1]!, text: `${w} × ${h} cells` };
        }
      }
      return out;
    },
    destroy() {
      if (shared !== null) ctx.tiles?.shareBrush(undefined);
      shared = null;
    },
  };
}

/** The six tile tools, in toolbar order. */
export function tileTools(): EditorToolDef[] {
  return TILE_TOOL_IDS.map((id) =>
    defineEditorTool({ id, ...TILE_TOOL_TEXT[id], create: (ctx) => createTileTool(id, ctx) }),
  );
}
