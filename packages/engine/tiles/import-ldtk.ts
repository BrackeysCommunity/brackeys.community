/**
 * LDtk worlds to project ops: a one-shot conversion, nothing stays linked.
 * Each level becomes a scene; IntGrid, auto and tile layers become
 * tilemaps; entities become markers with their fields in `extra`. Pure.
 */
import { deflateStored, pngFile, zlibStream } from "../export/png-write";
import { parseCssHex } from "../game/color";
import type { JsonValue } from "../game/types";
import type { TileDef, TilesetFile } from "../project/kinds/tileset";
import { TILESET_VERSION } from "../project/kinds/tileset";
import type { ProjectOp } from "../project/ops";
import type { AssetId, Licence, ProjectView, Sha256 } from "../project/types";
import { canonicalGrid, paintGrid, type CellEdit, type GridCells } from "../scene/grid";
import { makeIssue } from "../scene/issues";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type SceneDefinition,
  type SceneIssue,
} from "../scene/types";
import { pxToMetres } from "../scene/units";
import { encodeCell } from "./cell";
import { mapCellKey } from "./chunks";
import type { TileImport } from "./import-tiled";
import { assetSlug, list, obj, optNum, str, type Json } from "./json-read";

export type LdtkImportOptions = {
  /** Level names to import; omitted imports every level. */
  levels?: readonly string[];
  project: ProjectView;
  /** Px per metre of the game the world imports into: LDtk px are divided by it. */
  pxPerMetre: number;
  /** SHA-256 of bytes the import generates or copies, as the content store names them. */
  hash: (bytes: Uint8Array) => Sha256;
  /** Tileset images already in the project, by the `relPath` the world gives them. */
  images?: ReadonlyMap<string, AssetId>;
  /** Tileset image bytes to import, by `relPath`, for images not in `images`. */
  files?: ReadonlyMap<string, Uint8Array>;
  /** The game the scenes are for; omitted writes engine-only scenes. */
  game?: string;
  /** Folder for the scenes, ending in "/"; default "scenes/". */
  sceneFolder?: string;
  /** Folder for tilesets and their images, ending in "/"; default "tilesets/". */
  tilesetFolder?: string;
  licence?: Licence;
};

export type LdtkImport = TileImport & {
  /** Bytes the `importAsset` ops name, by hash: the caller puts them in the content store. */
  blobs: ReadonlyMap<Sha256, Uint8Array>;
};

/** An LDtk identifier (`DarkCave`, `Big_Door`) as an asset or entity id. */
const ldtkSlug = (identifier: string): string =>
  assetSlug(identifier, { fallback: "x", splitCamel: true });

const failed = (message: string, severity: SceneIssue["severity"] = "warn") =>
  makeIssue("import-failed", { message, severity });

/** `#rrggbb` as bytes; grey for anything else. */
function rgb(color: string | undefined): [number, number, number] {
  const n = parseCssHex(color) ?? 0x808080;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** A one-row RGBA PNG of `colors.length` square tiles, `size` px each, one solid colour per tile. */
export function swatchPng(colors: readonly string[], size: number): Uint8Array {
  const width = Math.max(1, colors.length) * size;
  const stride = 1 + width * 4;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    for (let t = 0; t < colors.length; t++) {
      const [r, g, b] = rgb(colors[t]);
      for (let x = 0; x < size; x++) raw.set([r, g, b, 255], row + 1 + (t * size + x) * 4);
    }
  }
  return pngFile({
    width,
    height: size,
    bitDepth: 8,
    colorType: 6,
    zlib: zlibStream(deflateStored(raw), raw),
  });
}

/** LDtk's `customData` string as tile data: its JSON object when it is one, else `{ customData }`. */
function customData(text: string): Record<string, JsonValue> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, JsonValue>;
  } catch {
    // plain text
  }
  return { customData: text };
}

const fileName = (relPath: string) => relPath.split(/[\\/]/).pop() ?? relPath;

class Batch {
  readonly ops: ProjectOp[] = [];
  readonly notes: SceneIssue[] = [];
  readonly blobs = new Map<Sha256, Uint8Array>();
  private readonly taken = new Set<AssetId>();

  constructor(private readonly opts: LdtkImportOptions) {}

  /** False, with a note, when the project or this import already holds `id`. */
  claim(id: AssetId, what: string): boolean {
    if (this.opts.project.byId.has(id) || this.taken.has(id)) {
      this.notes.push(
        failed(`${what} would be asset "${id}", which the project already has`, "error"),
      );
      return false;
    }
    this.taken.add(id);
    return true;
  }

  blob(id: AssetId, path: string, bytes: Uint8Array): void {
    const sha256 = this.opts.hash(bytes);
    this.blobs.set(sha256, bytes);
    this.ops.push({
      op: "importAsset",
      path,
      sha256,
      bytes: bytes.length,
      kind: "texture",
      id,
      ...(this.opts.licence ? { licence: this.opts.licence } : {}),
    });
  }

  doc(kind: string, id: AssetId, path: string, content: unknown): void {
    this.ops.push({
      op: "createAsset",
      kind,
      path,
      id,
      content,
      ...(this.opts.licence ? { licence: this.opts.licence } : {}),
    });
  }
}

type TilesetRef = { id: AssetId; size: number } | null;

export function importLdtk(world: unknown, opts: LdtkImportOptions): LdtkImport {
  const out = new Batch(opts);
  const ppm = opts.pxPerMetre;
  const m = (px: number) => pxToMetres(px, ppm);
  const sceneFolder = opts.sceneFolder ?? "scenes/";
  const tilesetFolder = opts.tilesetFolder ?? "tilesets/";
  const w = obj(world);
  const defs = obj(w.defs);
  const levels = list(w.levels).map(obj);

  if (levels.length === 0 || typeof w.jsonVersion !== "string") {
    out.notes.push(
      failed("the file isn't an LDtk world: it has no jsonVersion or levels", "error"),
    );
    return { ops: out.ops, notes: out.notes, blobs: out.blobs };
  }

  const layerDefs = new Map(list(defs.layers).map((d) => [optNum(obj(d).uid), obj(d)]));
  const tilesetDefs = new Map(list(defs.tilesets).map((d) => [optNum(obj(d).uid), obj(d)]));
  const tilesets = new Map<number, TilesetRef>();
  const intGridSets = new Map<number, TilesetRef>();

  /** The tileset asset for an LDtk tileset def, written the first time a layer uses it. */
  const tilesetFor = (uid: number): TilesetRef => {
    if (tilesets.has(uid)) return tilesets.get(uid)!;
    const def = tilesetDefs.get(uid);
    let ref: TilesetRef = null;
    if (!def)
      out.notes.push(failed(`a layer names tileset ${uid}, which the world doesn't define`));
    else ref = writeTileset(def);
    tilesets.set(uid, ref);
    return ref;
  };

  const writeTileset = (def: Json): TilesetRef => {
    const name = str(def.identifier) ?? `tileset-${optNum(def.uid)}`;
    const relPath = str(def.relPath);
    if (relPath === undefined) {
      out.notes.push(
        failed(`tileset ${name} has no image file (LDtk's embedded atlases don't import)`),
      );
      return null;
    }
    const id = ldtkSlug(name);
    let image = opts.images?.get(relPath);
    const bytes = image === undefined ? opts.files?.get(relPath) : undefined;
    if (image === undefined && bytes === undefined) {
      out.notes.push(
        failed(`tileset ${name}'s image "${relPath}" is neither in the project nor given`, "error"),
      );
      return null;
    }
    if (!out.claim(id, `tileset ${name}`)) return null;
    if (image === undefined) {
      image = `${id}-image`;
      if (!out.claim(image, `tileset ${name}'s image`)) return null;
      out.blob(image, `${tilesetFolder}${fileName(relPath)}`, bytes!);
    }
    const size = optNum(def.tileGridSize) ?? 16;
    const byId = new Map<number, TileDef>();
    const tile = (tileId: number) => {
      let t = byId.get(tileId);
      if (!t) byId.set(tileId, (t = { id: tileId }));
      return t;
    };
    for (const entry of list(def.customData).map(obj)) {
      const tileId = optNum(entry.tileId);
      const data = str(entry.data);
      if (tileId !== undefined && data !== undefined && data !== "")
        tile(tileId).data = customData(data);
    }
    for (const entry of list(def.enumTags).map(obj)) {
      const tag = str(entry.enumValueId);
      if (!tag) continue;
      for (const tileId of list(entry.tileIds)) {
        const n = optNum(tileId);
        if (n === undefined) continue;
        const t = tile(n);
        t.tags = [...(t.tags ?? []), tag];
      }
    }
    const tiles = [...byId.values()].sort((a, b) => a.id - b.id);
    const file: TilesetFile = {
      kind: "tileset",
      v: TILESET_VERSION,
      image,
      tile: [size, size],
      ...(optNum(def.padding) ? { margin: optNum(def.padding) } : {}),
      ...(optNum(def.spacing) ? { spacing: optNum(def.spacing) } : {}),
      columns: Math.max(1, optNum(def.__cWid) ?? 1),
      ...(tiles.length > 0 ? { tiles } : {}),
    };
    out.doc("tileset", id, `${tilesetFolder}${id}.json`, file);
    return { id, size };
  };

  /** The generated one-colour-per-value tileset for an IntGrid layer def. */
  const intGridSetFor = (layerDefUid: number, def: Json, size: number): TilesetRef => {
    if (intGridSets.has(layerDefUid)) return intGridSets.get(layerDefUid)!;
    const name = str(def.identifier) ?? `layer-${layerDefUid}`;
    const id = `${ldtkSlug(name)}-intgrid`.slice(0, 48);
    const image = `${id}-image`;
    let ref: TilesetRef = null;
    if (out.claim(id, `IntGrid layer ${name}'s tileset`) && out.claim(image, `its image`)) {
      const values = list(def.intGridValues).map(obj);
      out.blob(
        image,
        `${tilesetFolder}${id}.png`,
        swatchPng(
          values.map((v) => str(v.color) ?? ""),
          size,
        ),
      );
      const file: TilesetFile = {
        kind: "tileset",
        v: TILESET_VERSION,
        image,
        tile: [size, size],
        columns: Math.max(1, values.length),
        tiles: values.map((v, i) => {
          const label = str(v.identifier);
          return {
            id: i,
            ...(label ? { tags: [label] } : {}),
            data: { intGrid: optNum(v.value) ?? i + 1 },
          };
        }),
      };
      out.doc("tileset", id, `${tilesetFolder}${id}.json`, file);
      ref = { id, size };
    }
    intGridSets.set(layerDefUid, ref);
    return ref;
  };

  const wanted = opts.levels ? new Set(opts.levels) : null;
  for (const name of wanted ?? []) {
    if (!levels.some((l) => l.identifier === name))
      out.notes.push(failed(`the world has no level "${name}"`, "error"));
  }

  for (const level of levels) {
    const name = str(level.identifier) ?? `level-${optNum(level.uid)}`;
    if (wanted && !wanted.has(name)) continue;
    const layers = level.layerInstances;
    if (!Array.isArray(layers)) {
      out.notes.push(
        failed(
          `level ${name} is saved in a separate file (externalRelPath); import that file's world`,
          "error",
        ),
      );
      continue;
    }
    const sceneId = ldtkSlug(name);
    if (!out.claim(sceneId, `level ${name}`)) continue;
    const entities: EntityDef[] = [];
    const usedIds = new Set<string>();
    const entityId = (base: string) => {
      let id = base;
      for (let n = 2; usedIds.has(id); n++) id = `${base.slice(0, 44)}-${n}`;
      usedIds.add(id);
      return id;
    };
    let cell: number | undefined;
    const instances = layers.map(obj);

    instances.forEach((layer, index) => {
      const layerName = str(layer.__identifier) ?? `layer-${index}`;
      const type = str(layer.__type);
      const size = optNum(layer.__gridSize) ?? 16;
      const z = instances.length - 1 - index;
      const offset = [optNum(layer.__pxTotalOffsetX) ?? 0, optNum(layer.__pxTotalOffsetY) ?? 0];

      if (type === "Entities") {
        for (const e of list(layer.entityInstances).map(obj)) {
          const ident = str(e.__identifier) ?? "entity";
          const px = list(e.px).map(optNum);
          const extra: Record<string, unknown> = {};
          for (const f of list(e.fieldInstances).map(obj)) {
            const key = str(f.__identifier);
            if (key !== undefined) extra[key] = f.__value ?? null;
          }
          const iid = str(e.iid);
          if (iid) extra.iid = iid;
          entities.push({
            id: entityId(ldtkSlug(ident)),
            type: "marker",
            name: ident,
            at: [m((px[0] ?? 0) + offset[0]!), m((px[1] ?? 0) + offset[1]!)],
            tags: [ldtkSlug(ident)],
            ...(z !== 0 ? { z } : {}),
            extra: { ...extra, width: m(optNum(e.width) ?? 0), height: m(optNum(e.height) ?? 0) },
          });
        }
        return;
      }

      if (type !== "IntGrid" && type !== "Tiles" && type !== "AutoLayer") {
        out.notes.push(
          failed(
            `level ${name}'s layer ${layerName} is a ${type ?? "unknown"} layer, which doesn't import`,
          ),
        );
        return;
      }
      if (cell === undefined) cell = size;
      else if (cell !== size) {
        out.notes.push(
          failed(
            `level ${name}'s layer ${layerName} has ${size} px cells, but the scene grid's are ${cell} px; the layer is dropped`,
          ),
        );
        return;
      }
      if (offset[0]! % size !== 0 || offset[1]! % size !== 0) {
        out.notes.push(
          failed(
            `level ${name}'s layer ${layerName} is offset by part of a cell; the layer is dropped`,
          ),
        );
        return;
      }

      const tiles = list(type === "Tiles" ? layer.gridTiles : layer.autoLayerTiles).map(obj);
      const tilesetUid = optNum(layer.__tilesetDefUid) ?? optNum(layer.overrideTilesetUid);
      const edits: CellEdit[] = [];
      let tileset: TilesetRef;
      if (tiles.length > 0 && tilesetUid !== undefined) {
        tileset = tilesetFor(tilesetUid);
        if (tileset && tileset.size !== size) {
          out.notes.push(
            failed(
              `level ${name}'s layer ${layerName} has ${size} px cells, but its tileset's tiles are ${tileset.size} px; the layer is dropped`,
            ),
          );
          return;
        }
        const seen = new Set<string>();
        let stacked = 0;
        for (const t of tiles) {
          const [x, y] = list(t.px).map(optNum);
          const id = optNum(t.t);
          if (x === undefined || y === undefined || id === undefined) continue;
          const col = Math.floor(x / size);
          const row = Math.floor(y / size);
          const key = mapCellKey(col, row);
          if (seen.has(key)) stacked++;
          seen.add(key);
          const f = optNum(t.f) ?? 0;
          edits.push([
            col,
            row,
            encodeCell({ id, flipX: (f & 1) !== 0, flipY: (f & 2) !== 0, flipD: false }),
          ]);
        }
        if (stacked > 0)
          out.notes.push(
            failed(
              `level ${name}'s layer ${layerName} stacks tiles in ${stacked} cell${stacked === 1 ? "" : "s"}; the top one is kept`,
            ),
          );
      } else if (type === "IntGrid") {
        const layerDefUid = optNum(layer.layerDefUid) ?? -1;
        const def = layerDefs.get(layerDefUid) ?? {};
        tileset = intGridSetFor(layerDefUid, def, size);
        const order = list(def.intGridValues).map((v) => optNum(obj(v).value));
        const cols = optNum(layer.__cWid) ?? 0;
        list(layer.intGridCsv).forEach((v, i) => {
          const value = optNum(v) ?? 0;
          if (value === 0 || cols === 0) return;
          const tileId = order.indexOf(value);
          if (tileId < 0) return;
          edits.push([
            i % cols,
            Math.floor(i / cols),
            encodeCell({ id: tileId, flipX: false, flipY: false, flipD: false }),
          ]);
        });
      } else return;
      if (!tileset || edits.length === 0) return;
      const cells: GridCells = canonicalGrid(paintGrid({}, { cells: edits }).grid);
      entities.push({
        id: entityId(ldtkSlug(layerName)),
        type: "tilemap",
        name: layerName,
        ...(z !== 0 ? { z } : {}),
        at: [m(offset[0]!), m(offset[1]!)],
        tileset: tileset.id,
        cells,
      });
    });

    const width = optNum(level.pxWid) ?? 0;
    const height = optNum(level.pxHei) ?? 0;
    const scene: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      ...(opts.game ? { game: opts.game } : {}),
      name: sceneId,
      bounds: [0, 0, m(width), m(height)],
      ...(cell === undefined
        ? {}
        : { settings: { grid: { kind: "square", cell: [m(cell), m(cell)] } } }),
      entities: entities.sort((a, b) => (a.type === b.type ? 0 : a.type === "tilemap" ? -1 : 1)),
    };
    out.doc("scene", sceneId, `${sceneFolder}${sceneId}.json`, scene);
  }
  return { ops: out.ops, notes: out.notes, blobs: out.blobs };
}
