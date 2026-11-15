import { decodeCell, pxPerMetreOf, type CellBounds, type TileDef } from "@jams/engine/game";
import { tilemapIssues, tilesetImageInfo, type TilesetFile } from "@jams/engine/project";
import {
  closest,
  expandScene,
  gridCellBounds,
  isGridValue,
  readCell,
  type GridCells,
} from "@jams/engine/scene";

import { failure, issueLine, openScene, plural, usage, type Tool } from "../context";
import { loadProject } from "./project-show";

export type TilesInput = {
  scene?: string;
  /** The tilemap entity's ref. */
  map?: string;
  /** `c0,r0,c1,r1`, corners inclusive; default the map's painted cells. */
  rect?: string;
};

export const TILES_USAGE = "tiles <scene> <map> [--rect c0,r0,c1,r1]";

/** Regions past this many cells aren't drawn; `--rect` narrows one. */
export const MAX_TILE_CELLS = 40_000;

const RECT_ARG = /^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/;
const EMPTY = ".";
const GLYPHS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SPARE = "!$%&*+=@^~<>";
const OVERFLOW = "?";

/** Tile ids below 62 draw as their base-62 digit; larger ones take spare symbols in id order. */
function glyphsFor(ids: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  let spare = 0;
  for (const id of [...ids].sort((a, b) => a - b))
    out.set(id, GLYPHS[id] ?? SPARE[spare++] ?? OVERFLOW);
  return out;
}

function parseRect(arg: string): CellBounds | null {
  const m = RECT_ARG.exec(arg);
  if (!m) return null;
  const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  return { c0: Math.min(a, c), r0: Math.min(b, d), c1: Math.max(a, c), r1: Math.max(b, d) };
}

function describeDef(def: TileDef | undefined): string {
  if (!def) return "";
  const parts: string[] = [];
  if (def.solid) parts.push(def.oneWay ? `one-way ${def.oneWay}` : "solid");
  if (def.cost !== undefined && !def.solid) parts.push(`cost ${def.cost}`);
  if (def.tags?.length) parts.push(`tags ${def.tags.join(", ")}`);
  if (def.animation?.length) parts.push(`animated ${def.animation.length} frames`);
  return parts.join("; ");
}

/** A tilemap's cells as ASCII, one character per tile, with a legend of the tile ids and tags drawn. */
export const tiles: Tool<TilesInput> = async (input, ctx) => {
  if (!input.scene || !input.map) return usage(TILES_USAGE);
  const asked = input.rect === undefined ? undefined : parseRect(input.rect);
  if (asked === null)
    return usage(`--rect takes c0,r0,c1,r1, e.g. 0,0,15,7 (scene ${TILES_USAGE})`);

  const loaded = await openScene(ctx, input.scene, TILES_USAGE);
  if (!loaded.ok) return loaded.result;
  const { def, registry, prefabs } = loaded;
  const scene = expandScene(def, registry, { prefabs });
  const isTilemap = (type: string) => {
    const t = registry.types.get(type);
    return (t?.base ?? t?.type) === "tilemap";
  };
  const maps = scene.entities.filter((e) => isTilemap(e.type));
  const entity = maps.find((e) => e.id === input.map);
  if (!entity) {
    const ids = maps.map((e) => e.id);
    const guess = closest(input.map, ids);
    return failure(
      `${def.name} has no tilemap ${input.map}${guess ? `; did you mean ${guess}?` : ids.length ? ` (tilemaps: ${ids.join(", ")})` : " (it has no tilemaps)"}`,
    );
  }

  const cells: GridCells = isGridValue(entity.cells) ? entity.cells : {};
  const tilesetId = typeof entity.tileset === "string" ? entity.tileset : undefined;
  const project = loaded.project ? await loadProject(loaded.project) : null;
  const tileset =
    tilesetId === undefined
      ? undefined
      : (project?.values.get(tilesetId) as TilesetFile | undefined);
  const grid = def.settings?.grid;
  const issues = tilemapIssues(
    {
      id: entity.id,
      ...(tilesetId === undefined ? {} : { tileset: tilesetId }),
      cells,
    },
    tileset,
    tileset && project ? tilesetImageInfo(project.view, tileset.image) : null,
    grid ? { settings: grid, pxPerMetre: pxPerMetreOf(registry) } : null,
  );

  const painted = gridCellBounds(cells);
  const bounds = asked ?? painted;
  const header = `${def.name} tilemap ${entity.id}${tilesetId ? ` (tileset ${tilesetId})` : ""}`;
  const data: Record<string, unknown> = {
    ok: issues.length === 0,
    scene: loaded.name,
    map: entity.id,
    tileset: tilesetId ?? null,
    painted,
    rect: bounds,
    issues,
  };
  const text = [header];
  const exitCode: 0 | 1 = issues.length === 0 ? 0 : 1;
  if (!bounds) {
    text.push("  (no painted cells)", ...issues.map(issueLine));
    return { exitCode, data: { ...data, rows: [], legend: [] }, text: text.join("\n") };
  }

  const width = bounds.c1 - bounds.c0 + 1;
  const height = bounds.r1 - bounds.r0 + 1;
  if (width * height > MAX_TILE_CELLS)
    return failure(
      `${header}: cells [${bounds.c0}, ${bounds.r0}]..[${bounds.c1}, ${bounds.r1}] are ${width * height} cells, over ${MAX_TILE_CELLS}; narrow it with --rect`,
    );

  const ids: number[][] = [];
  const counts = new Map<number, { cells: number; flipped: number }>();
  for (let r = bounds.r0; r <= bounds.r1; r++) {
    const row: number[] = [];
    for (let c = bounds.c0; c <= bounds.c1; c++) {
      const tile = decodeCell(readCell(cells, c, r));
      row.push(tile ? tile.id : -1);
      if (!tile) continue;
      const n = counts.get(tile.id) ?? { cells: 0, flipped: 0 };
      n.cells++;
      if (tile.flipX || tile.flipY || tile.flipD) n.flipped++;
      counts.set(tile.id, n);
    }
    ids.push(row);
  }
  const glyph = glyphsFor([...counts.keys()]);
  const rows = ids.map((row) => row.map((id) => (id < 0 ? EMPTY : glyph.get(id)!)).join(""));
  const defs = new Map((tileset?.tiles ?? []).map((t) => [t.id, t]));
  const legend = [...glyph].map(([id, g]) => {
    const def = defs.get(id);
    const n = counts.get(id)!;
    return {
      glyph: g,
      id,
      cells: n.cells,
      flipped: n.flipped,
      solid: def?.solid === true,
      tags: def?.tags ?? [],
    };
  });

  text[0] = `${header}: cells [${bounds.c0}, ${bounds.r0}]..[${bounds.c1}, ${bounds.r1}] (${width}×${height})`;
  text.push(...rows.map((l) => `  ${l}`));
  text.push(`legend (${EMPTY} empty)`);
  for (const l of legend) {
    const about = describeDef(defs.get(l.id));
    const flips = l.flipped ? `, ${l.flipped} flipped` : "";
    text.push(
      `  ${l.glyph}  tile ${l.id}  ${plural(l.cells, "cell")}${flips}${about ? `  ${about}` : ""}`,
    );
  }
  if (legend.length === 0) text.push("  (no tiles in this rectangle)");
  text.push(...issues.map(issueLine));
  return { exitCode, data: { ...data, rows, legend }, text: text.join("\n") };
};
