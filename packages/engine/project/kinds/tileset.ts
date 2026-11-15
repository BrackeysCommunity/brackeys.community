import { z } from "zod";

import { AssetIdSchema, ID_PATTERN } from "../../game/fields";
import { decodeCell, MAX_TILES } from "../../game/tile-cell";
import type { JsonValue } from "../../game/types";
import { forEachRun, GRID_CHUNK, parseChunkKey, type GridCells } from "../../scene/grid";
import { makeIssue } from "../../scene/issues";
import { ShapeTupleSchema } from "../../scene/shapes";
import type { GridSettings, SceneIssue, ShapeTuple } from "../../scene/types";
import { isWholePixel } from "../../scene/units";
import { assetInfo, type AssetInfo } from "../asset-info";
import type { RefSite } from "../refs";
import type { AssetId, ProjectView } from "../types";
import { ATLAS_KIND } from "./atlas";
import { defineAssetKind, type KindEnv } from "./define";
import { MATERIAL_KIND } from "./material";
import { TEXTURE_KIND } from "./texture";

export const TILESET_VERSION = 1;
export const TILESET_SCHEMA_ID = `urn:jams-engine:tileset:v${TILESET_VERSION}`;

/** A grid step's cost, matching the grid geometry's edge cost; tile costs never go below it. */
export const DEFAULT_TILE_COST = 10;

/** One tile's data, keyed by its id in the image (row-major from the top left). */
export type TileDef = {
  id: number;
  solid?: boolean;
  /** One-way solids pass from the opposite side (the grid's oneWay direction). */
  oneWay?: "up" | "down" | "left" | "right";
  /** Path cost to enter the cell on grids, 10 = one step and the least; default 10; ignored when solid. */
  cost?: number;
  material?: AssetId;
  tags?: readonly string[];
  /** Collision shapes in tile px instead of the full square; divided by px per metre when colliders build. */
  shapes?: readonly ShapeTuple[];
  /** Frames by tile id, drawn only. */
  animation?: readonly { tile: number; ms: number }[];
  data?: Readonly<Record<string, JsonValue>>;
};

export type AutotileRule = {
  id: string;
  /** blob47: 8-neighbour masks reduced to Tiled's 47; edge16: 4-neighbour masks. */
  kind: "blob47" | "edge16";
  /** The terrain this rule paints; cells whose tile has this tag count as neighbours. */
  terrain: string;
  /** Mask (as a decimal string) → tile id. */
  tiles: Readonly<Record<string, number>>;
  fallback: number;
};

export type TilesetFile = {
  $schema?: string;
  kind: "tileset";
  v: 1;
  /** A texture or an atlas. */
  image: AssetId;
  /** Tile size in image px; must equal the scene grid's cell × the game's px per metre. */
  tile: [number, number];
  margin?: number;
  spacing?: number;
  columns: number;
  tiles?: TileDef[];
  rules?: AutotileRule[];
};

const tileId = (description: string) =>
  z
    .number()
    .int()
    .min(0)
    .max(MAX_TILES - 1)
    .describe(description);

const px = (description: string) =>
  z.number().int().min(0).describe(description).meta({ unit: "px" });

const tileDefSchema = (tileData: z.ZodRawShape | undefined) =>
  z
    .strictObject({
      id: tileId("The tile's index in the image, row-major from the top left."),
      solid: z.boolean().optional().describe("Collides, and walls the grid."),
      oneWay: z
        .enum(["up", "down", "left", "right"])
        .optional()
        .describe("The one side actors land on; they pass through from the others."),
      cost: z
        .number()
        .int()
        .min(DEFAULT_TILE_COST)
        .optional()
        .describe(
          "Path cost to enter the cell on grids, 10 = one step and the least, since A* needs costs that only add; default 10; ignored when solid.",
        ),
      material: AssetIdSchema.optional().describe("A material asset for the tile's colliders."),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Labels game code and autotile rules read."),
      shapes: z
        .array(ShapeTupleSchema)
        .optional()
        .describe(
          "Collision shapes in tile px, from the tile's top left, instead of the full square.",
        ),
      animation: z
        .array(
          z.strictObject({
            tile: tileId("A frame's tile id."),
            ms: z
              .number()
              .int()
              .positive()
              .describe("How long the frame shows, ms.")
              .meta({ unit: "ms" }),
          }),
        )
        .optional()
        .describe("Frames drawn in turn; drawing only, never collision."),
      data: (tileData ? z.strictObject(tileData) : z.record(z.string(), z.json()))
        .optional()
        .describe("The game's per-tile data (GameDefinition.tileData)."),
    })
    .describe("One tile's data.");

const AutotileRuleSchema = z
  .strictObject({
    id: z.string().regex(ID_PATTERN).describe("The rule's name, unique in the tileset."),
    kind: z
      .enum(["blob47", "edge16"])
      .describe("blob47: 8-neighbour masks reduced to Tiled's 47; edge16: 4-neighbour masks."),
    terrain: z.string().min(1).describe("The tag whose tiles count as this terrain's neighbours."),
    tiles: z
      .record(z.string().regex(/^(?:0|[1-9][0-9]{0,2})$/), tileId("The tile for that mask."))
      .describe("Neighbour mask, as a decimal string, to tile id."),
    fallback: tileId("The tile for a mask the rule doesn't list."),
  })
  .describe("An autotile rule over one terrain.");

/** The tileset schema, each tile's `data` judged by `tileData` when a game declares it. */
export const tilesetSchemaFor = (tileData?: z.ZodRawShape): z.ZodType<TilesetFile> =>
  z
    .strictObject({
      $schema: z.string().optional().describe("The tileset JSON Schema this file follows."),
      kind: z.literal("tileset").describe('Always "tileset".'),
      v: z.literal(TILESET_VERSION).describe("Tileset format version."),
      image: AssetIdSchema.describe("The texture or atlas the tiles are cut from."),
      tile: z
        .tuple([
          z.number().int().positive().describe("w, px.").meta({ unit: "px" }),
          z.number().int().positive().describe("h, px.").meta({ unit: "px" }),
        ])
        .describe(
          "Tile size [w, h] in image px: the scene grid's cell times the game's px per metre.",
        )
        .meta({ unit: "px" }),
      margin: px("Image px around the tiles; default 0.").optional(),
      spacing: px("Image px between tiles; default 0.").optional(),
      columns: z.number().int().positive().describe("Tiles per image row."),
      tiles: z.array(tileDefSchema(tileData)).optional().describe("Per-tile data, by id."),
      rules: z.array(AutotileRuleSchema).optional().describe("Autotile rules, by id."),
    })
    .describe(
      "Tiles cut from one image, with per-tile data and autotile rules.",
    ) as z.ZodType<TilesetFile>;

/** The tileset schema without a game's `tileData`. */
export const tilesetSchema = tilesetSchemaFor();

/** What `tilemapIssues` needs to know of the scene grid: its settings and the game's px per metre. */
export type TileGridInfo = { settings: GridSettings; pxPerMetre: number };

/** A tilemap entity as its cells are judged: its id, the tileset it names and its cells. */
export type TilemapRecord = { id: string; tileset?: AssetId; cells?: GridCells };

/**
 * How many tiles the tileset's image holds: `columns` by the rows its
 * height fits after margin and spacing. Null without the image's size.
 */
export function tilesetTileCount(
  tileset: TilesetFile,
  imageInfo: Pick<AssetInfo, "size"> | null,
): number | null {
  const height = imageInfo?.size?.[1];
  if (height === undefined) return null;
  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  const rows = Math.max(
    0,
    Math.floor((height - 2 * margin + spacing) / (tileset.tile[1] + spacing)),
  );
  return Math.min(MAX_TILES, tileset.columns * rows);
}

/** The image of a tileset: a texture's info, or for an atlas its texture's. */
export function tilesetImageInfo(view: ProjectView | null, image: AssetId): AssetInfo | null {
  if (!view) return null;
  const info = assetInfo(view, image);
  if (info?.kind === ATLAS_KIND && info.texture !== undefined) return assetInfo(view, info.texture);
  return info;
}

const tileWord = (count: number) => `${count} tile${count === 1 ? "" : "s"}`;

/**
 * `tile-unknown` for each autotile rule tile and animation frame beyond
 * the image's tiles; the tileset doc's own half of the tile rule.
 */
export function tilesetIssues(
  tileset: TilesetFile,
  imageInfo: Pick<AssetInfo, "size"> | null,
): SceneIssue[] {
  const count = tilesetTileCount(tileset, imageInfo);
  if (count === null) return [];
  const issues: SceneIssue[] = [];
  const unknown = (tile: number, what: string, path: string) => {
    if (tile < count) return;
    issues.push(
      makeIssue("tile-unknown", {
        message: `${what} names tile ${tile}, but image "${tileset.image}" holds ${tileWord(count)}`,
        path,
        expected: `a tile id below ${count}`,
        got: String(tile),
      }),
    );
  };
  (tileset.tiles ?? []).forEach((def, i) => {
    unknown(def.id, `tile ${def.id}`, `/tiles/${i}/id`);
    (def.animation ?? []).forEach((frame, f) =>
      unknown(
        frame.tile,
        `tile ${def.id}'s animation frame ${f}`,
        `/tiles/${i}/animation/${f}/tile`,
      ),
    );
  });
  (tileset.rules ?? []).forEach((rule, r) => {
    for (const [mask, tile] of Object.entries(rule.tiles))
      unknown(tile, `rule "${rule.id}" mask ${mask}`, `/rules/${r}/tiles/${mask}`);
    unknown(rule.fallback, `rule "${rule.id}"'s fallback`, `/rules/${r}/fallback`);
  });
  return issues;
}

/**
 * The one tilemap rule: `tileset-missing` (no tileset, or none readable),
 * `tileset-grid-mismatch` (tile px ≠ grid cell × px per metre) and
 * `tile-unknown` for each cell value beyond the image's tiles, at its
 * first cell in row-major order. `pointer` is the entity's JSON Pointer
 * in its document, for the issues' paths. The tileset's own rule and frame tiles
 * are `tilesetIssues`'. The scene kind's cross-validation, the tilemap
 * system's spawn and the CLI call it.
 */
export function tilemapIssues(
  entity: TilemapRecord,
  tileset: TilesetFile | undefined,
  imageInfo: Pick<AssetInfo, "size"> | null,
  grid: TileGridInfo | null,
  pointer?: string,
): SceneIssue[] {
  const entityIds = [entity.id];
  const at = (field: string) => (pointer === undefined ? {} : { path: `${pointer}/${field}` });
  if (entity.tileset === undefined || entity.tileset === "" || !tileset)
    return [
      makeIssue("tileset-missing", {
        message:
          entity.tileset === undefined || entity.tileset === ""
            ? `tilemap ${entity.id} names no tileset`
            : `tilemap ${entity.id} names tileset "${entity.tileset}", which the project doesn't have or can't read`,
        entityIds,
        ...at("tileset"),
      }),
    ];
  const issues: SceneIssue[] = [];
  if (grid) {
    const { cell } = grid.settings;
    const ppm = grid.pxPerMetre;
    const whole = isWholePixel(cell[0], ppm) && isWholePixel(cell[1], ppm);
    const expected: [number, number] = [Math.round(cell[0] * ppm), Math.round(cell[1] * ppm)];
    if (whole && (expected[0] !== tileset.tile[0] || expected[1] !== tileset.tile[1]))
      issues.push(
        makeIssue("tileset-grid-mismatch", {
          message: `tilemap ${entity.id}'s tileset "${entity.tileset}" has ${tileset.tile[0]}×${tileset.tile[1]} px tiles, but the scene grid's ${cell[0]}×${cell[1]} m cell is ${expected[0]}×${expected[1]} px at ${ppm} px per metre`,
          entityIds,
          ...at("tileset"),
          expected: `[${expected[0]}, ${expected[1]}]`,
          got: `[${tileset.tile[0]}, ${tileset.tile[1]}]`,
        }),
      );
  }
  const count = tilesetTileCount(tileset, imageInfo);
  if (count === null || !entity.cells) return issues;
  const first = new Map<number, [number, number]>();
  for (const key of Object.keys(entity.cells)) {
    const chunk = parseChunkKey(key);
    const rows = entity.cells[key];
    if (!chunk || !rows) continue;
    rows.forEach((row, r) => {
      // One check per run: its cells share a value and its first is the earliest.
      const unknown: [id: number, c: number][] = [];
      const valid = forEachRun(row, (value, c) => {
        const id = decodeCell(value)?.id;
        if (id !== undefined && id >= count) unknown.push([id, c]);
      });
      if (!valid) return;
      for (const [id, c] of unknown) {
        const col = chunk[0] * GRID_CHUNK + c;
        const row = chunk[1] * GRID_CHUNK + r;
        const seen = first.get(id);
        if (!seen || row < seen[1] || (row === seen[1] && col < seen[0])) first.set(id, [col, row]);
      }
    });
  }
  for (const [id, [col, row]] of [...first].sort((a, b) => a[0] - b[0]))
    issues.push(
      makeIssue("tile-unknown", {
        message: `tilemap ${entity.id}'s cell (${col}, ${row}) names tile ${id}, but tileset "${entity.tileset}"'s image holds ${tileWord(count)}`,
        entityIds,
        ...at("cells"),
        expected: `a tile id below ${count}`,
        got: String(id),
      }),
    );
  return issues;
}

export const TILESET_KIND = defineAssetKind({
  kind: "tileset",
  title: "Tileset",
  description:
    "Tiles cut from one image, with per-tile collision, cost and data, and autotile rules.",
  match: { jsonKind: "tileset" },
  defaultFolder: () => "tilesets",
  storage: "doc",
  version: TILESET_VERSION,
  schemaId: TILESET_SCHEMA_ID,
  runtime: "sim",
  schema: (env) => tilesetSchemaFor(env.registry.game?.tileData),
  layout: {
    as: "map",
    fields: {
      tiles: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
      rules: {
        as: "keyed",
        item: {
          as: "map",
          fields: { tiles: { as: "map", rest: { as: "atomic" } } },
          rest: { as: "atomic" },
        },
      },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 1_048_576, maxItems: MAX_TILES },
  validate: (file: TilesetFile, env: KindEnv): SceneIssue[] =>
    tilesetIssues(file, tilesetImageInfo(env.project, file.image)),
  refs: (file: TilesetFile): RefSite[] => [
    { pointer: "/image", id: file.image, kinds: [TEXTURE_KIND, ATLAS_KIND] },
    ...(file.tiles ?? []).flatMap((t, i): RefSite[] =>
      t.material === undefined
        ? []
        : [{ pointer: `/tiles/${i}/material`, id: t.material, kinds: [MATERIAL_KIND] }],
    ),
  ],
  empty: (_env: KindEnv, init: { id: AssetId }): TilesetFile => ({
    kind: "tileset",
    v: TILESET_VERSION,
    image: `${init.id}-image`,
    tile: [16, 16],
    columns: 1,
  }),
});
