import { docMeta, docToScene, layoutFromDoc } from "@jams/engine/collab";
import {
  autotileRule,
  floodCells,
  isTilemapType,
  TILE_FILL_CAP,
  TILEMAP_CELLS_FIELD,
  tilePaintBatch,
} from "@jams/engine/editor";
import { applyAutotile, encodeCell, type Registry, type TilesetFile } from "@jams/engine/game";
import {
  closest,
  isGridValue,
  type GridCells,
  type OpBatch,
  type SceneDefinition,
} from "@jams/engine/scene";

import {
  failure,
  isFileArg,
  hostedOptions,
  openScene,
  registryOf,
  usage,
  type Tool,
  type ToolResult,
} from "../context";
import { findScene, openLiveProject, ProjectClientError } from "../project-client";
import { apply } from "./apply";
import { applyLive } from "./apply-live";
import type { WriterFlags } from "./assets-apply";
import { loadProject } from "./project-show";

export type PaintInput = WriterFlags & {
  scene?: string;
  /** The tilemap entity's ref. */
  map?: string;
  /** `c,r=tile`, each tile by id or tag; one value may hold several, space or `;` separated. */
  cells?: readonly string[];
  /** `c0,r0,c1,r1=tile`. */
  rect?: readonly string[];
  /** `c,r=tile`: a bounded flood from the cell over the cells holding its value. */
  fill?: string;
  /** `rule c0,r0,c1,r1`: re-tiles the terrain already in the rectangle and its border by the tileset's autotile rule. */
  auto?: string;
  /** The CLI's word after `--auto rule`: the rectangle written as its own argument, `c0,r0,c1,r1`. */
  autoRect?: string;
};

export const PAINT_USAGE =
  "paint <scene> <map> (--cells c,r=tile… | --rect c0,r0,c1,r1=tile | --fill c,r=tile | --auto rule c0,r0,c1,r1) [writer flags]";

/** Tile names that clear a cell. */
const ERASE = new Set(["empty", "none"]);

const INT = String.raw`(-?\d+)`;
const CELL_ARG = new RegExp(`^${INT},${INT}=(\\S+)$`);
const RECT_ARG = new RegExp(`^${INT},${INT},${INT},${INT}=(\\S+)$`);
const AUTO_ARG = new RegExp(`^(\\S+)\\s+${INT},${INT},${INT},${INT}$`);
const AUTO_RECT_ARG = new RegExp(`^${INT},${INT},${INT},${INT}$`);

class PaintError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message);
  }
}

/** A tile named by id, by tag (the lowest id carrying it), or `empty`/`none`, as a cell value. */
function tileValue(name: string, tileset: TilesetFile | undefined): number {
  if (ERASE.has(name)) return 0;
  if (/^\d+$/.test(name))
    return encodeCell({ id: Number(name), flipX: false, flipY: false, flipD: false });
  const tiles = [...(tileset?.tiles ?? [])].sort((a, b) => a.id - b.id);
  const tagged = tiles.find((t) => t.tags?.includes(name));
  if (tagged) return encodeCell({ id: tagged.id, flipX: false, flipY: false, flipD: false });
  const tags = [...new Set(tiles.flatMap((t) => t.tags ?? []))];
  const guess = closest(name, tags);
  throw new PaintError(
    `no tile has the tag ${JSON.stringify(name)}${guess ? `; did you mean ${guess}?` : tags.length ? ` (tags: ${tags.join(", ")})` : tileset ? " (the tileset's tiles have no tags)" : " (the map has no tileset, so name tiles by id)"}`,
    1,
  );
}

function match(re: RegExp, arg: string, flag: string, form: string): string[] {
  const m = re.exec(arg.trim());
  if (!m) throw new PaintError(`${flag} takes ${form}, got ${JSON.stringify(arg)}`, 2);
  return m.slice(1);
}

const ints = (parts: readonly string[]) => parts.map(Number);

type CellEdit = [col: number, row: number, value: number];
type CellRect = [c0: number, r0: number, c1: number, r1: number, value: number];

type MapState = { def: SceneDefinition; registry: Registry; tileset: TilesetFile | undefined };

/** The batch the input paints, built against the map as `state` holds it; null when there is nothing to change. */
function paintBatch(input: PaintInput, { def, registry, tileset }: MapState): OpBatch | null {
  const maps = (def.entities ?? []).filter((e) => isTilemapType(registry, e.type));
  const entity = maps.find((e) => e.id === input.map);
  if (!entity) {
    const ids = maps.map((e) => e.id);
    const guess = closest(input.map!, ids);
    throw new PaintError(
      `${def.name} has no tilemap ${input.map}${guess ? `; did you mean ${guess}?` : ids.length ? ` (tilemaps: ${ids.join(", ")})` : " (it has no tilemaps)"}`,
      1,
    );
  }
  const map = entity.id;
  const grid: GridCells = isGridValue(entity[TILEMAP_CELLS_FIELD])
    ? (entity[TILEMAP_CELLS_FIELD] as GridCells)
    : {};

  if (input.cells?.length) {
    const cells = input.cells
      .flatMap((v) => v.split(/[\s;]+/))
      .filter(Boolean)
      .map((arg): CellEdit => {
        const [c, r, tile] = match(CELL_ARG, arg, "--cells", "c,r=tile");
        return [Number(c), Number(r), tileValue(tile!, tileset)];
      });
    return tilePaintBatch(map, { cells }, `Paint ${cells.length} cells on ${map}`);
  }
  if (input.rect?.length) {
    const rects = input.rect.map((arg): CellRect => {
      const parts = match(RECT_ARG, arg, "--rect", "c0,r0,c1,r1=tile");
      const [c0, r0, c1, r1] = ints(parts.slice(0, 4)) as [number, number, number, number];
      return [c0, r0, c1, r1, tileValue(parts[4]!, tileset)];
    });
    return tilePaintBatch(map, { rects }, `Paint a rectangle on ${map}`);
  }
  if (input.fill !== undefined) {
    const [c, r, tile] = match(CELL_ARG, input.fill, "--fill", "c,r=tile");
    const value = tileValue(tile!, tileset);
    const region = floodCells(grid, [Number(c), Number(r)]);
    if (!region)
      throw new PaintError(
        `the region at ${c},${r} on ${map} is over ${TILE_FILL_CAP} cells; paint it with --rect`,
        1,
      );
    const cells = region.map(([col, row]): CellEdit => [col, row, value]);
    return tilePaintBatch(map, { cells }, `Fill ${cells.length} cells on ${map}`);
  }
  const [ruleId, ...corners] = match(AUTO_ARG, input.auto!, "--auto", "rule c0,r0,c1,r1");
  if (!tileset) throw new PaintError(`${map} has no tileset, so it has no autotile rules`, 1);
  const rule = autotileRule(tileset, ruleId!);
  if (!rule) {
    const ids = (tileset.rules ?? []).map((r) => r.id);
    const guess = closest(ruleId!, ids);
    throw new PaintError(
      `the tileset has no autotile rule ${ruleId}${guess ? `; did you mean ${guess}?` : ids.length ? ` (rules: ${ids.join(", ")})` : " (it has no rules)"}`,
      1,
    );
  }
  const [a, b, c, d] = ints(corners) as [number, number, number, number];
  const [c0, c1, r0, r1] = [Math.min(a, c), Math.max(a, c), Math.min(b, d), Math.max(b, d)];
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > TILE_FILL_CAP)
    throw new PaintError(`--auto covers over ${TILE_FILL_CAP} cells; narrow the rectangle`, 1);
  const cells = applyAutotile(grid, tileset, rule, { c0, r0, c1, r1 });
  if (cells.length === 0) return null;
  return tilePaintBatch(map, { cells }, `Autotile ${rule.id} on ${map}`);
}

const tilesetId = (def: SceneDefinition, map: string | undefined) => {
  const value = def.entities?.find((e) => e.id === map)?.tileset;
  return typeof value === "string" ? value : undefined;
};

/** The scene, its registry and the map's tileset as the files hold them. */
async function fileState(
  input: PaintInput,
  ctx: Parameters<Tool<PaintInput>>[1],
): Promise<MapState | ToolResult> {
  const loaded = await openScene(ctx, input.scene, PAINT_USAGE);
  if (!loaded.ok) return loaded.result;
  const id = tilesetId(loaded.def, input.map);
  const project = id !== undefined && loaded.project ? await loadProject(loaded.project) : null;
  const tileset =
    id === undefined ? undefined : (project?.values.get(id) as TilesetFile | undefined);
  return { def: loaded.def, registry: loaded.registry, tileset };
}

/** The scene, its registry and the map's tileset as the dev server's docs hold them now. */
async function liveState(
  input: PaintInput,
  ctx: Parameters<Tool<PaintInput>>[1],
): Promise<MapState | ToolResult> {
  const scene = input.scene!;
  const { client, project } = await openLiveProject({
    projects: ctx.projects,
    url: input.url,
    project: ctx.project,
    find: findScene(scene),
    timeoutMs: input.timeoutMs,
    ...hostedOptions(ctx, input.token),
  });
  try {
    const { session } = client;
    const name = session.docNameFor(session.view().byId.get(scene)!)!;
    const opened = await session.open(name);
    let def: SceneDefinition;
    let game: string | undefined;
    try {
      const meta = docMeta(opened.doc);
      if (!meta) return failure(`${name} synced empty: the server didn't seed it.`);
      game = meta.game;
      def = docToScene(opened.doc);
    } finally {
      session.release(name);
    }
    const registry = registryOf(ctx, game, project);
    if (!registry)
      return failure(`${scene} is for game "${game}", which no project of the CLI's has.`);
    const id = tilesetId(def, input.map);
    const entry = id === undefined ? undefined : session.view().byId.get(id);
    const docName = entry ? session.docNameFor(entry) : null;
    let tileset: TilesetFile | undefined;
    if (docName) {
      const doc = await session.open(docName);
      try {
        if (doc.layout) tileset = layoutFromDoc(doc.doc, doc.layout) as unknown as TilesetFile;
      } finally {
        session.release(docName);
      }
    }
    return { def, registry, tileset };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Paints a tilemap's cells as one `paintCells` batch, built by the tile
 * tools' own builder against the map as it is now (the dev server's doc with
 * `--live`), then applied as `scene apply` applies a batch.
 */
export const paint: Tool<PaintInput> = async (input, ctx) => {
  if (!input.scene || !input.map) return usage(PAINT_USAGE);
  const given = [input.cells?.length, input.rect?.length, input.fill, input.auto].filter(
    (v) => v !== undefined && v !== 0,
  );
  if (given.length !== 1) return usage(PAINT_USAGE);
  if (input.live && (isFileArg(input.scene) || input.scene === "-"))
    return usage("scene paint --live takes a scene name; file paths are read-only");
  if (input.autoRect !== undefined) {
    if (input.auto === undefined || /\s/.test(input.auto.trim()))
      return usage(`too many arguments: ${input.autoRect}`);
    if (!AUTO_RECT_ARG.test(input.autoRect))
      return usage(
        `--auto takes rule c0,r0,c1,r1, got ${JSON.stringify(`${input.auto} ${input.autoRect}`)}`,
      );
    input = { ...input, auto: `${input.auto.trim()} ${input.autoRect}`, autoRect: undefined };
  }

  let batch: OpBatch | null;
  try {
    const state = input.live ? await liveState(input, ctx) : await fileState(input, ctx);
    if (!("def" in state)) return state;
    batch = paintBatch(input, state);
  } catch (e) {
    if (e instanceof PaintError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message, { scene: input.scene });
    if (e instanceof ProjectClientError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message, { scene: input.scene });
    throw e;
  }
  if (!batch)
    return {
      exitCode: 0,
      data: { scene: input.scene, map: input.map, written: false, dryRun: input.dryRun ?? false },
      text: `${input.scene}: nothing to autotile on ${input.map}; --auto re-tiles terrain already there, so paint it first (e.g. --rect c0,r0,c1,r1=<terrain tag>)`,
    };

  const text = JSON.stringify(batch);
  const via = { ...ctx, readStdin: async () => text };
  if (input.live)
    return applyLive(
      {
        scene: input.scene,
        ops: "-",
        url: input.url,
        agent: input.agent,
        onBehalfOf: input.onBehalfOf,
        token: input.token,
        dryRun: input.dryRun,
        base: input.base,
        timeoutMs: input.timeoutMs,
      },
      via,
    );
  return apply({ scene: input.scene, ops: "-", dryRun: input.dryRun, base: input.base }, via);
};
