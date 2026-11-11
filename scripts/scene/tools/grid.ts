import {
  cellKey,
  fieldOfView,
  gridMissingIssue,
  gridPlace,
  gridRoute,
  sceneGrid,
  type Cell,
  type CellKey,
  type GridGeometry,
  type GridPlace,
  type RuntimeGrid,
} from "@jams/engine/game";
import { closest, expandScene, makeIssue } from "@jams/engine/scene";

import {
  failure,
  issueLine,
  isToolResult,
  openScene,
  usage,
  type Tool,
  type ToolResult,
} from "../context";
import { projectRuntime } from "../projects";

export type GridInput = {
  scene?: string;
  /** A cell `c,r` or an entity ref. */
  from?: string;
  to?: string;
  /** `c,r:radius`. */
  fov?: string;
  diagonals: boolean;
};

const USAGE = "grid <scene> [--from c,r|ref] [--to c,r|ref] [--fov c,r:radius] [--diagonals]";

/** Grids past this many cells print no maps; `--json` still lists every wall. */
export const MAX_MAP_CELLS = 40_000;

const CELL_ARG = /^(-?\d+),(-?\d+)$/;

const fmtCell = ([c, r]: Cell) => `[${c}, ${r}]`;

function describeGrid(s: GridGeometry["settings"]): string {
  const size = `${s.cell[0]}×${s.cell[1]}`;
  return s.kind === "square"
    ? `square ${size}`
    : `hex ${size} side ${s.side}, stagger ${s.stagger} ${s.index}`;
}

/**
 * The grid as text, one character per cell. Hex grids keep their stagger:
 * with stagger y the pushed rows are indented half a cell; with stagger x
 * each row takes two lines and the pushed columns sit on the lower one.
 */
function drawMap(grid: RuntimeGrid, glyph: (c: Cell) => string): string[] {
  const { c0, r0, c1, r1 } = grid.bounds;
  const s = grid.geometry.settings;
  const odd = s.kind === "hex" && s.index === "odd";
  const shifted = (n: number) => ((n & 1) === 1) === odd;
  const cols: number[] = [];
  for (let c = c0; c <= c1; c++) cols.push(c);
  const lines: string[] = [];
  for (let r = r0; r <= r1; r++) {
    if (s.kind === "square") lines.push(cols.map((c) => glyph([c, r])).join(""));
    else if (s.stagger === "y")
      lines.push((shifted(r) ? " " : "") + cols.map((c) => glyph([c, r])).join(" "));
    else {
      lines.push(cols.map((c) => (shifted(c) ? " " : glyph([c, r]))).join(""));
      lines.push(cols.map((c) => (shifted(c) ? glyph([c, r]) : " ")).join(""));
    }
  }
  return lines.map((l) => `  ${l}`.trimEnd());
}

/** A scene's grid as ASCII: its walls, a path between two cells or entities, and the cells visible from one. */
export const grid: Tool<GridInput> = async (input, ctx) => {
  const fovMatch = input.fov === undefined ? undefined : /^(.+):(\d+)$/.exec(input.fov);
  if (fovMatch === null) return usage(`--fov takes c,r:radius or ref:radius, e.g. 3,4:6`);
  if ((input.from === undefined) !== (input.to === undefined))
    return usage(`--from and --to go together (scene ${USAGE})`);

  const loaded = await openScene(ctx, input.scene, USAGE);
  if (!loaded.ok) return loaded.result;
  const { def, registry, prefabs } = loaded;
  const engine = loaded.project
    ? (await projectRuntime(loaded.project, registry)).engine
    : undefined;
  const scene = expandScene(def, registry, { prefabs, ...(engine ? { engine } : {}) });
  const g = sceneGrid(scene, registry);
  if (!g) {
    const issue = gridMissingIssue(def.name, "to draw");
    return {
      exitCode: 1,
      data: { ok: false, scene: loaded.name, issues: [issue] },
      text: [`${def.name}: no grid`, issueLine(issue)].join("\n"),
    };
  }

  const byId = new Map(scene.entities.map((e) => [e.id, e]));
  const place = (arg: string, flag: string): GridPlace | ToolResult => {
    const m = CELL_ARG.exec(arg);
    if (m) return gridPlace(g, registry, [Number(m[1]), Number(m[2])]);
    const e = byId.get(arg);
    if (!e) {
      const guess = closest(arg, [...byId.keys()]);
      return failure(
        `${flag}: no cell or loaded entity ${arg} in ${def.name}${guess ? `; did you mean ${guess}?` : ""}`,
      );
    }
    return gridPlace(g, registry, e);
  };

  const { c0, r0, c1, r1 } = g.bounds;
  const cells = (c1 - c0 + 1) * (r1 - r0 + 1);
  const walls: Cell[] = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) if (g.occupancy.wall([c, r])) walls.push([c, r]);
  const wallGlyph = (c: Cell) => (g.occupancy.wall(c) ? "#" : ".");
  const maps = cells <= MAX_MAP_CELLS;

  const text = [
    `${def.name} grid ${describeGrid(g.geometry.settings)}: cells ${fmtCell([c0, r0])}..${fmtCell([c1, r1])} (${c1 - c0 + 1}×${r1 - r0 + 1}), ${walls.length} walls`,
  ];
  if (maps) text.push("walls (# wall, . open)", ...drawMap(g, wallGlyph));
  else text.push(`  (${cells} cells: too many to draw; --json lists every wall)`);
  const data: Record<string, unknown> = {
    ok: true,
    scene: loaded.name,
    grid: { settings: g.geometry.settings, bounds: g.bounds, walls },
  };
  let exitCode: 0 | 1 = 0;

  if (input.from !== undefined && input.to !== undefined) {
    const from = place(input.from, "--from");
    if (isToolResult(from)) return from;
    const to = place(input.to, "--to");
    if (isToolResult(to)) return to;
    const found = gridRoute(g, from.cell, to.cell, input.diagonals);
    const ends = { from: from.cell, to: to.cell, diagonals: input.diagonals };
    if (found) {
      const steps = found.cells.length - 1;
      data.path = { ...ends, cells: found.cells, steps, cost: found.cost };
      text.push(
        `path ${from.label} → ${to.label}: ${steps} steps, cost ${found.cost} (* path, A from, B to)`,
      );
    } else {
      exitCode = 1;
      data.ok = false;
      data.path = null;
      data.issues = [
        makeIssue("grid-unreachable", {
          message: `no path on the grid from ${from.label} to ${to.label}`,
          entityIds: to.ref === undefined ? [] : [to.ref],
          at: g.geometry.center(to.cell),
          detail: ends,
        }),
      ];
      text.push(`no path from ${from.label} to ${to.label} (A from, B to)`);
    }
    if (maps) {
      const on = new Set<CellKey>((found?.cells ?? []).map(cellKey));
      const a = cellKey(from.cell);
      const b = cellKey(to.cell);
      text.push(
        ...drawMap(g, (c) => {
          const k = cellKey(c);
          return k === a ? "A" : k === b ? "B" : on.has(k) ? "*" : wallGlyph(c);
        }),
      );
    }
  }

  if (fovMatch) {
    const origin = place(fovMatch[1]!, "--fov");
    if (isToolResult(origin)) return origin;
    const radius = Number(fovMatch[2]);
    const inBounds = ([c, r]: Cell) => c >= c0 && c <= c1 && r >= r0 && r <= r1;
    const seen = fieldOfView(
      g.geometry,
      origin.cell,
      radius,
      (c) => !inBounds(c) || g.occupancy.wall(c),
    );
    const visible: Cell[] = [];
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (seen.has(cellKey([c, r]))) visible.push([c, r]);
    data.fov = { origin: origin.cell, radius, visible };
    text.push(
      `fov ${origin.label} radius ${radius}: ${visible.length} cells visible (@ origin, # wall, . open, blank unseen)`,
    );
    if (maps) {
      const o = cellKey(origin.cell);
      text.push(
        ...drawMap(g, (c) => {
          const k = cellKey(c);
          return k === o ? "@" : seen.has(k) ? wallGlyph(c) : " ";
        }),
      );
    }
  }

  return { exitCode, data, text: text.join("\n") };
};
