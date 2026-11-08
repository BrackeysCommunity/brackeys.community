/**
 * The grid-field codec: cells in 32×32 chunks keyed `"cx,cy"`, each chunk
 * up to 32 run-length row strings (`"0*4,3*6,7"`). Pure.
 *
 * Row grammar: `Row := "" | Run ("," Run)*`, `Run := Value ("*" Count)?`,
 * `Value := 0 | [1-9][0-9]{0,4}` (≤ 65535), `Count := 2..32`; the counts sum
 * to at most 32 and missing cells are 0. Canonical: maximal runs, a run of
 * one written without `*`, trailing zeros dropped. Cell `(col, row)` is in
 * chunk `(floor(col/32), floor(row/32))` at row `row mod 32`, column
 * `col mod 32`.
 */
import type { Dihedral } from "./transform";
import type { CellEdit, CellRect } from "./types";

export type { CellEdit, CellRect } from "./types";

export const GRID_CHUNK = 32;
/** The largest cell value a row can hold. */
export const GRID_MAX_VALUE = 65535;

/** `"cx,cy"`: a chunk's coordinates in chunks, integers, may be negative. */
export type ChunkKey = string;
/** Run-length cells of one row of a chunk: "" or runs "v" / "v*n" joined by ","; trailing empties dropped. */
export type GridRow = string;
/** Chunks by key; a chunk is up to 32 rows, trailing empty rows dropped; empty chunks absent. */
export type GridCells = Readonly<Record<ChunkKey, readonly GridRow[]>>;

const INT = "-?(?:0|[1-9]\\d{0,8})";
const RUN = "(?:0|[1-9]\\d{0,4})(?:\\*(?:[2-9]|[12]\\d|3[0-2]))?";
/** A chunk key's spelling; `-0` and leading zeros are not keys. */
export const CHUNK_KEY_PATTERN = new RegExp(`^${INT},${INT}$`);
/** A row's spelling; the value bound and the 32-cell sum are checked by `decodeRow`. */
export const GRID_ROW_PATTERN = new RegExp(`^(?:${RUN}(?:,${RUN})*)?$`);
const RUN_RE = /^(0|[1-9]\d{0,4})(?:\*([2-9]|[12]\d|3[0-2]))?$/;

const CELLS = GRID_CHUNK * GRID_CHUNK;
const floorDiv = (n: number) => Math.floor(n / GRID_CHUNK);
const mod = (n: number) => ((n % GRID_CHUNK) + GRID_CHUNK) % GRID_CHUNK;
const keyOf = (cx: number, cy: number): ChunkKey => `${cx + 0},${cy + 0}`;

export function parseChunkKey(key: string): [cx: number, cy: number] | null {
  if (!CHUNK_KEY_PATTERN.test(key) || key.startsWith("-0,") || key.endsWith(",-0")) return null;
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

/** Orders chunk keys row-major by `(cy, cx)` numerically; unparseable keys sort last by code unit. */
export function compareChunkKeys(a: ChunkKey, b: ChunkKey): number {
  const pa = parseChunkKey(a);
  const pb = parseChunkKey(b);
  if (pa && pb) return pa[1] - pb[1] || pa[0] - pb[0];
  if (pa) return -1;
  if (pb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The row's 32 cells, or null when it isn't in the row grammar. */
export function decodeRow(row: GridRow): Uint16Array | null {
  const cells = new Uint16Array(GRID_CHUNK);
  if (row === "") return cells;
  let n = 0;
  for (const run of row.split(",")) {
    const m = RUN_RE.exec(run);
    if (!m) return null;
    const value = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (value > GRID_MAX_VALUE || n + count > GRID_CHUNK) return null;
    if (value !== 0) cells.fill(value, n, n + count);
    n += count;
  }
  return cells;
}

const isCellValue = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= GRID_MAX_VALUE;

/** The canonical row for up to 32 cells. */
export function encodeRow(cells: ArrayLike<number>): GridRow {
  if (cells.length > GRID_CHUNK) throw new RangeError(`a row holds ${GRID_CHUNK} cells`);
  let end = cells.length;
  while (end > 0 && cells[end - 1] === 0) end--;
  const runs: string[] = [];
  for (let i = 0; i < end; ) {
    const v = cells[i]!;
    if (!isCellValue(v))
      throw new RangeError(`cell ${i} is ${String(v)}, not an integer in [0, 65535]`);
    let j = i + 1;
    while (j < end && cells[j] === v) j++;
    runs.push(j - i === 1 ? String(v) : `${v}*${j - i}`);
    i = j;
  }
  return runs.join(",");
}

function decodeOrThrow(row: GridRow, chunk: ChunkKey, r: number): Uint16Array {
  const cells = decodeRow(row);
  if (!cells)
    throw new Error(`grid chunk "${chunk}" row ${r} isn't a valid row: ${JSON.stringify(row)}`);
  return cells;
}

/** A chunk's 1024 cells, row-major. */
function decodeChunk(rows: readonly GridRow[] | undefined, key: ChunkKey): Uint16Array {
  const cells = new Uint16Array(CELLS);
  if (!rows) return cells;
  if (rows.length > GRID_CHUNK) throw new Error(`grid chunk "${key}" has more than 32 rows`);
  rows.forEach((row, r) => {
    if (row !== "") cells.set(decodeOrThrow(row, key, r), r * GRID_CHUNK);
  });
  return cells;
}

/** A chunk's rows, canonical; empty for an empty chunk. */
function encodeChunk(cells: Uint16Array): GridRow[] {
  const rows: GridRow[] = [];
  for (let r = 0; r < GRID_CHUNK; r++)
    rows.push(encodeRow(cells.subarray(r * GRID_CHUNK, (r + 1) * GRID_CHUNK)));
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

function sortedGrid(chunks: Map<ChunkKey, readonly GridRow[]>): GridCells {
  const out: Record<ChunkKey, readonly GridRow[]> = {};
  for (const key of [...chunks.keys()].sort(compareChunkKeys)) {
    const rows = chunks.get(key)!;
    if (rows.length > 0) out[key] = rows;
  }
  return out;
}

export function readCell(grid: GridCells, col: number, row: number): number {
  const key = keyOf(floorDiv(col), floorDiv(row));
  const r = mod(row);
  const text = grid[key]?.[r];
  if (text === undefined || text === "") return 0;
  return decodeOrThrow(text, key, r)[mod(col)]!;
}

function checkCoord(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} ${n} isn't an integer`);
}

function checkValue(v: number): void {
  if (!isCellValue(v))
    throw new RangeError(`cell value ${String(v)} isn't an integer in [0, 65535]`);
}

/**
 * The grid after the edits, which rows changed, and the edits that undo them.
 * Rects are painted first, then single cells, so a cell edit wins over a
 * rect under it. A cell painted to the value it already had is no change;
 * `inverse` holds each changed cell once, with its old value.
 */
export function paintGrid(
  grid: GridCells,
  edit: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] },
): { grid: GridCells; rows: { chunk: ChunkKey; row: number }[]; inverse: CellEdit[] } {
  const touched = new Map<ChunkKey, { before: Uint16Array; after: Uint16Array }>();
  const chunk = (key: ChunkKey) => {
    let c = touched.get(key);
    if (!c) {
      const before = decodeChunk(grid[key], key);
      c = { before, after: before.slice() };
      touched.set(key, c);
    }
    return c.after;
  };
  const paintRow = (row: number, c0: number, c1: number, value: number) => {
    const cy = floorDiv(row);
    const base = mod(row) * GRID_CHUNK;
    for (let cx = floorDiv(c0); cx <= floorDiv(c1); cx++) {
      const from = Math.max(c0, cx * GRID_CHUNK) - cx * GRID_CHUNK;
      const to = Math.min(c1, cx * GRID_CHUNK + GRID_CHUNK - 1) - cx * GRID_CHUNK;
      chunk(keyOf(cx, cy)).fill(value, base + from, base + to + 1);
    }
  };

  for (const [a0, b0, a1, b1, value] of edit.rects ?? []) {
    for (const [n, what] of [
      [a0, "c0"],
      [b0, "r0"],
      [a1, "c1"],
      [b1, "r1"],
    ] as const)
      checkCoord(n, what);
    checkValue(value);
    const [c0, c1] = a0 <= a1 ? [a0, a1] : [a1, a0];
    const [r0, r1] = b0 <= b1 ? [b0, b1] : [b1, b0];
    for (let row = r0; row <= r1; row++) paintRow(row, c0, c1, value);
  }
  for (const [col, row, value] of edit.cells ?? []) {
    checkCoord(col, "col");
    checkCoord(row, "row");
    checkValue(value);
    paintRow(row, col, col, value);
  }

  const chunks = new Map<ChunkKey, readonly GridRow[]>(Object.entries(grid));
  const rows: { chunk: ChunkKey; row: number }[] = [];
  const inverse: CellEdit[] = [];
  for (const key of [...touched.keys()].sort(compareChunkKeys)) {
    const { before, after } = touched.get(key)!;
    const [cx, cy] = parseChunkKey(key)!;
    let changed = false;
    for (let r = 0; r < GRID_CHUNK; r++) {
      let rowChanged = false;
      for (let c = 0; c < GRID_CHUNK; c++) {
        const i = r * GRID_CHUNK + c;
        if (before[i] === after[i]) continue;
        rowChanged = true;
        inverse.push([cx * GRID_CHUNK + c, cy * GRID_CHUNK + r, before[i]!]);
      }
      if (rowChanged) rows.push({ chunk: key, row: r });
      changed ||= rowChanged;
    }
    if (changed) chunks.set(key, encodeChunk(after));
  }
  return { grid: rows.length > 0 ? sortedGrid(chunks) : grid, rows, inverse };
}

/** Maximal runs, no trailing empties, keys row-major by (cy, cx): what files and docs hold. */
export function canonicalGrid(grid: GridCells): GridCells {
  const chunks = new Map<ChunkKey, readonly GridRow[]>();
  for (const [key, rows] of Object.entries(grid)) {
    if (!parseChunkKey(key)) throw new Error(`"${key}" isn't a chunk key "cx,cy"`);
    chunks.set(key, encodeChunk(decodeChunk(rows, key)));
  }
  return sortedGrid(chunks);
}

/** A plain-JSON value that is a grid: an object with ≥ 1 key, every key a chunk key, every value an array of strings. */
export function isGridValue(v: unknown): v is GridCells {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, rows]) =>
        parseChunkKey(key) !== null &&
        Array.isArray(rows) &&
        rows.every((r) => typeof r === "string"),
    )
  );
}

/** One problem with a grid value: where (relative to the value), what, and what was found. */
export type GridProblem = { path: (string | number)[]; message: string; got?: string };

/**
 * Everything wrong with a plain-JSON grid value whose cells may go up to
 * `max`: bad chunk keys, too many rows, rows outside the grammar, values
 * past `max`. Empty when the value is a grid `canonicalGrid` accepts.
 */
export function gridProblems(value: unknown, max = GRID_MAX_VALUE): GridProblem[] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [{ path: [], message: 'a grid is an object of chunks keyed "cx,cy"' }];
  const out: GridProblem[] = [];
  for (const [key, rows] of Object.entries(value)) {
    if (!parseChunkKey(key))
      out.push({
        path: [key],
        message: `"${key}" isn't a chunk key: two integers "cx,cy", no "-0" or leading zeros`,
        got: JSON.stringify(key),
      });
    if (!Array.isArray(rows)) {
      out.push({ path: [key], message: "a chunk is an array of row strings" });
      continue;
    }
    if (rows.length > GRID_CHUNK)
      out.push({
        path: [key],
        message: `a chunk holds at most 32 rows; got ${rows.length}`,
        got: String(rows.length),
      });
    rows.forEach((row: unknown, r) => {
      const cells = typeof row === "string" ? decodeRow(row) : null;
      if (!cells) {
        out.push({
          path: [key, r],
          message:
            'a row is "" or runs "v" / "v*n" (v in 0..65535, n in 2..32) joined by ",", 32 cells at most',
          got: JSON.stringify(row),
        });
        return;
      }
      const over = cells.find((c) => c > max);
      if (over !== undefined)
        out.push({
          path: [key, r],
          message: `cell value ${over} is past this field's largest, ${max}`,
          got: String(over),
        });
    });
  }
  return out;
}

export function gridCellBounds(
  grid: GridCells,
): { c0: number; r0: number; c1: number; r1: number } | null {
  let b: { c0: number; r0: number; c1: number; r1: number } | null = null;
  for (const [key, rows] of Object.entries(grid)) {
    const at = parseChunkKey(key);
    if (!at) throw new Error(`"${key}" isn't a chunk key "cx,cy"`);
    rows.forEach((text, r) => {
      if (text === "") return;
      const cells = decodeOrThrow(text, key, r);
      const first = cells.findIndex((c) => c !== 0);
      if (first < 0) return;
      let last = GRID_CHUNK - 1;
      while (cells[last] === 0) last--;
      const row = at[1] * GRID_CHUNK + r;
      const c0 = at[0] * GRID_CHUNK + first;
      const c1 = at[0] * GRID_CHUNK + last;
      b = b
        ? {
            c0: Math.min(b.c0, c0),
            r0: Math.min(b.r0, row),
            c1: Math.max(b.c1, c1),
            r1: Math.max(b.r1, row),
          }
        : { c0, r0: row, c1, r1: row };
    });
  }
  return b;
}

/** The linear part of `d` as [a, b, c, d]: x' = a·x + c·y, y' = b·x + d·y. */
function dihedralMatrix(d: Dihedral): [number, number, number, number] {
  const turns: [number, number, number, number][] = [
    [1, 0, 0, 1],
    [0, 1, -1, 0],
    [-1, 0, 0, -1],
    [0, -1, 1, 0],
  ];
  const [a, b, c, dd] = turns[((d.rot % 4) + 4) % 4]!;
  return d.flip ? [-a, -b, c, dd] : [a, b, c, dd];
}

/** Cells turned and flipped about cell (0, 0)'s top-left corner; square cells only. */
export function transformGrid(grid: GridCells, d: Dihedral): GridCells {
  const [a, b, c, dd] = dihedralMatrix(d);
  const out = new Map<ChunkKey, Uint16Array>();
  for (const [key, rows] of Object.entries(grid)) {
    const at = parseChunkKey(key);
    if (!at) throw new Error(`"${key}" isn't a chunk key "cx,cy"`);
    const cells = decodeChunk(rows, key);
    for (let i = 0; i < CELLS; i++) {
      const v = cells[i]!;
      if (v === 0) continue;
      // Doubled cell centres keep the arithmetic in integers.
      const x = 2 * (at[0] * GRID_CHUNK + (i % GRID_CHUNK)) + 1;
      const y = 2 * (at[1] * GRID_CHUNK + Math.floor(i / GRID_CHUNK)) + 1;
      const col = (a * x + c * y - 1) / 2;
      const row = (b * x + dd * y - 1) / 2;
      const k = keyOf(floorDiv(col), floorDiv(row));
      let target = out.get(k);
      if (!target) out.set(k, (target = new Uint16Array(CELLS)));
      target[mod(row) * GRID_CHUNK + mod(col)] = v;
    }
  }
  const chunks = new Map<ChunkKey, readonly GridRow[]>();
  for (const [k, cells] of out) chunks.set(k, encodeChunk(cells));
  return sortedGrid(chunks);
}
