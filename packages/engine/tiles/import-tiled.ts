/** Tiled JSON maps and tilesets to project ops: a one-shot conversion, nothing stays linked. Pure. */
import { ID_PATTERN } from "../game/fields";
import { encodeCell, MAX_TILES } from "../game/tile-cell";
import type { JsonValue } from "../game/types";
import type { TileDef, TilesetFile } from "../project/kinds/tileset";
import type { ProjectOp } from "../project/ops";
import type { AssetId, AssetPath, Licence, ProjectView, Sha256 } from "../project/types";
import { paintGrid } from "../scene/grid";
import { makeIssue } from "../scene/issues";
import type {
  CellEdit,
  EntityInput,
  GridSettings,
  SceneIssue,
  SceneOp,
  ShapeTuple,
} from "../scene/types";
import { pxToMetres, roundLength } from "../scene/units";

export type TileImport = {
  ops: readonly ProjectOp[];
  /** What was dropped and why: image layers, object types with no mapping, isometric maps. */
  notes: readonly SceneIssue[];
};

export type TiledImportOptions = {
  scene: AssetId;
  project: ProjectView;
  /** Px per metre of the game the map imports into: map px are divided by it. */
  pxPerMetre: number;
  /**
   * Tileset images whose bytes are in the content store, keyed by the path
   * as the tileset writes it; each becomes an `importAsset`. An image left
   * out must already be in the project, at that path or in `folder`.
   */
  images?: ReadonlyMap<string, { sha256: Sha256; bytes: number }>;
  /** Where new tilesets and images go; default "tilesets/". */
  folder?: string;
  licence?: Licence;
};

/** Tiled's gid flag bits; an orthogonal map's D is a transpose, a hex map's D and R are 60° and 120° turns. */
const GID_H = 0x80000000;
const GID_V = 0x40000000;
const GID_D = 0x20000000;
const GID_R = 0x10000000;
const GID_MASK = 0x0fffffff;

const ISOMETRIC_REFUSAL = "isometric maps import once plan 57's projections exist";

type Json = Record<string, unknown>;
type Placed = { firstgid: number; id: AssetId; name: string; count: number };

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const stem = (p: string): string => {
  const b = basename(p);
  const dot = b.indexOf(".");
  return dot > 0 ? b.slice(0, dot) : b;
};

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s === "" ? "tileset" : s;
}

const asTag = (v: unknown): string | undefined =>
  typeof v === "string" && ID_PATTERN.test(v) ? v : undefined;

/** Tiled's `properties` array as a plain record, in the file's order. */
function properties(v: unknown): Record<string, JsonValue> | undefined {
  const out: Record<string, JsonValue> = {};
  for (const p of list(v)) {
    if (!isObj(p) || typeof p.name !== "string") continue;
    out[p.name] = (p.value ?? null) as JsonValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Bytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of clean) {
    const v = BASE64.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** A layer's or chunk's gids: a CSV array, or uncompressed base64 of little-endian uint32s. */
function gidsOf(data: unknown, encoding: unknown, compression: unknown): number[] | string {
  if (Array.isArray(data)) return data.map((g) => num(g) >>> 0);
  if (encoding !== "base64" || typeof data !== "string") return "its tile data isn't CSV or base64";
  if (typeof compression === "string" && compression !== "")
    return `its tile data is ${compression}-compressed; re-export it with CSV or uncompressed base64`;
  const bytes = base64Bytes(data);
  if (!bytes || bytes.length % 4 !== 0) return "its base64 tile data doesn't decode";
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 4)
    out.push(
      (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0,
    );
  return out;
}

/** `#rrggbb` or `#aarrggbb` to 0xRRGGBB. */
function rgbOf(v: unknown): number | undefined {
  const m = typeof v === "string" ? /^#(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(v) : null;
  return m ? parseInt(m[1]!, 16) : undefined;
}

/** A tile's collision object in tile px, or null for one with no shape. */
function tileShape(o: Json): ShapeTuple | null {
  const x = num(o.x);
  const y = num(o.y);
  const w = num(o.width);
  const h = num(o.height);
  const rot = num(o.rotation);
  if (Array.isArray(o.polygon) || Array.isArray(o.polyline)) {
    const pts = list(o.polygon ?? o.polyline).flatMap((p) =>
      isObj(p) ? [roundLength(x + num(p.x)), roundLength(y + num(p.y))] : [],
    );
    return [Array.isArray(o.polygon) ? "poly" : "chain", ...pts];
  }
  if (o.point === true || w <= 0 || h <= 0) return null;
  if (o.ellipse === true && w === h && rot === 0)
    return ["circle", roundLength(x + w / 2), roundLength(y + h / 2), w / 2];
  if (o.ellipse === true) return null;
  const [cx, cy] = rectCentre(x, y, w, h, rot);
  return rot === 0
    ? ["box", roundLength(cx), roundLength(cy), w / 2, h / 2]
    : ["box", roundLength(cx), roundLength(cy), w / 2, h / 2, rot];
}

/** Tiled turns a rectangle about its top left, degrees clockwise (y down). */
function rectCentre(x: number, y: number, w: number, h: number, rot: number): [number, number] {
  if (rot === 0) return [x + w / 2, y + h / 2];
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x + (w / 2) * c - (h / 2) * s, y + (w / 2) * s + (h / 2) * c];
}

/**
 * A Tiled map (`.tmj`) and its external tilesets (keyed by each map
 * entry's `source`) as one cross-doc batch: images, tilesets, then the
 * scene's grid, tilemaps, markers and sensors. Any error refuses the whole
 * import with no ops; what it drops is a warning note.
 */
export function importTiled(
  map: unknown,
  tilesets: ReadonlyMap<string, unknown>,
  opts: TiledImportOptions,
): TileImport {
  const notes: SceneIssue[] = [];
  const fail = (message: string, path?: string) =>
    notes.push(makeIssue("import-failed", { message, ...(path ? { path } : {}) }));
  const drop = (message: string, path?: string) =>
    notes.push(
      makeIssue("import-failed", { severity: "warn", message, ...(path ? { path } : {}) }),
    );
  const refused = (): TileImport => ({ ops: [], notes });

  if (!isObj(map) || map.type !== "map") {
    fail("the file isn't a Tiled JSON map (its `type` isn't \"map\")");
    return refused();
  }
  const orientation = str(map.orientation) ?? "orthogonal";
  if (orientation === "isometric" || orientation === "staggered") {
    fail(`the map is ${orientation}: ${ISOMETRIC_REFUSAL}`, "/orientation");
    return refused();
  }
  if (orientation !== "orthogonal" && orientation !== "hexagonal") {
    fail(`the map's orientation "${orientation}" isn't orthogonal or hexagonal`, "/orientation");
    return refused();
  }
  const hex = orientation === "hexagonal";
  const ppm = opts.pxPerMetre;
  const m = (px: number) => pxToMetres(px, ppm);
  const tw = num(map.tilewidth);
  const th = num(map.tileheight);
  if (tw <= 0 || th <= 0) {
    fail("the map's tilewidth and tileheight must be positive");
    return refused();
  }
  const grid: GridSettings = hex
    ? {
        kind: "hex",
        cell: [m(tw), m(th)],
        side: m(num(map.hexsidelength)),
        stagger: map.staggeraxis === "x" ? "x" : "y",
        index: map.staggerindex === "even" ? "even" : "odd",
      }
    : { kind: "square", cell: [m(tw), m(th)] };

  const folder = opts.folder ?? "tilesets/";
  const takenIds = new Set<AssetId>(opts.project.byId.keys());
  const takenPaths = new Set<AssetPath>(opts.project.byPath.keys());
  const freshId = (base: string): AssetId => {
    let id = base;
    for (let n = 2; takenIds.has(id); n++) id = `${base.slice(0, 44)}-${n}`;
    takenIds.add(id);
    return id;
  };
  const freshPath = (name: string): AssetPath => {
    const dot = name.lastIndexOf(".");
    const [s, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let path = `${folder}${name}`;
    for (let n = 2; takenPaths.has(path); n++) path = `${folder}${s}-${n}${ext}`;
    takenPaths.add(path);
    return path;
  };
  const licence = opts.licence ? { licence: opts.licence } : {};

  const assetOps: ProjectOp[] = [];
  const placed: Placed[] = [];
  const imageIds = new Map<string, AssetId>();

  const imageFor = (image: string, where: string): AssetId | undefined => {
    const known = imageIds.get(image);
    if (known) return known;
    const supplied = opts.images?.get(image);
    const existing =
      opts.project.byPath.get(image) ?? opts.project.byPath.get(`${folder}${basename(image)}`);
    let id: AssetId | undefined;
    if (supplied && existing?.sha256 === supplied.sha256) id = existing.id;
    else if (supplied) {
      id = freshId(`${slug(stem(image)).slice(0, 34)}-image`);
      assetOps.push({
        op: "importAsset",
        path: freshPath(basename(image)),
        sha256: supplied.sha256,
        bytes: supplied.bytes,
        kind: "texture",
        id,
        ...licence,
      });
    } else if (existing) id = existing.id;
    else fail(`${where}'s image "${image}" isn't supplied and isn't in the project`);
    if (id) imageIds.set(image, id);
    return id;
  };

  list(map.tilesets).forEach((entry, i) => {
    const path = `/tilesets/${i}`;
    if (!isObj(entry)) return fail("a tileset entry isn't an object", path);
    const firstgid = num(entry.firstgid);
    const source = str(entry.source);
    const ts = source === undefined ? entry : tilesets.get(source);
    if (!isObj(ts)) return fail(`the external tileset "${source}" wasn't supplied`, path);
    const name = str(ts.name) ?? (source ? stem(source) : `tileset-${i}`);
    const image = str(ts.image);
    if (image === undefined)
      return fail(
        `tileset "${name}" is a collection of images; only tilesets cut from one image import`,
        path,
      );
    const tile: [number, number] = [num(ts.tilewidth), num(ts.tileheight)];
    if (tile[0] !== tw || tile[1] !== th)
      drop(
        `tileset "${name}"'s tiles are ${tile[0]}×${tile[1]} px but the map's cells are ${tw}×${th} px`,
        path,
      );
    const count = num(ts.tilecount);
    if (count > MAX_TILES)
      return fail(`tileset "${name}" has ${count} tiles; a tileset holds ${MAX_TILES}`, path);
    const imageId = imageFor(image, `tileset "${name}"`);
    if (!imageId) return;
    if (list(ts.wangsets).length > 0)
      drop(`tileset "${name}"'s Wang sets aren't imported; write autotile rules instead`, path);

    const defs: TileDef[] = [];
    for (const t of list(ts.tiles)) {
      if (!isObj(t) || typeof t.id !== "number") continue;
      const def: { -readonly [K in keyof TileDef]: TileDef[K] } = { id: t.id };
      const tag = asTag(t.class ?? t.type);
      if (tag) def.tags = [tag];
      const shapes = list(isObj(t.objectgroup) ? t.objectgroup.objects : undefined)
        .filter(isObj)
        .map(tileShape)
        .filter((s): s is ShapeTuple => s !== null);
      if (shapes.length > 0) {
        def.solid = true;
        def.shapes = shapes;
      }
      const frames = list(t.animation).filter(isObj);
      if (frames.length > 0)
        def.animation = frames.map((f) => ({ tile: num(f.tileid), ms: num(f.duration) }));
      const data = properties(t.properties);
      if (data) def.data = data;
      if (Object.keys(def).length > 1) defs.push(def);
    }
    defs.sort((a, b) => a.id - b.id);
    const content: TilesetFile = {
      kind: "tileset",
      v: 1,
      image: imageId,
      tile,
      ...(num(ts.margin) > 0 ? { margin: num(ts.margin) } : {}),
      ...(num(ts.spacing) > 0 ? { spacing: num(ts.spacing) } : {}),
      columns: num(ts.columns),
      ...(defs.length > 0 ? { tiles: defs } : {}),
    };
    const id = freshId(slug(name));
    assetOps.push({ op: "createAsset", kind: "tileset", path: folder, id, content, ...licence });
    placed.push({ firstgid, id, name, count });
  });
  placed.sort((a, b) => a.firstgid - b.firstgid);

  const sceneOps: SceneOp[] = [{ op: "setSettings", set: { grid } }];
  let z = 0;

  type Frame = { dx: number; dy: number; alpha: number; off: boolean; prefix: string };
  const walk = (layers: unknown, frame: Frame, at: string) => {
    list(layers).forEach((layer, i) => {
      const path = `${at}/${i}`;
      if (!isObj(layer)) return;
      const name = `${frame.prefix}${str(layer.name) ?? `layer ${i}`}`;
      const here: Frame = {
        dx: frame.dx + num(layer.offsetx),
        dy: frame.dy + num(layer.offsety),
        alpha: frame.alpha * num(layer.opacity, 1),
        off: frame.off || layer.visible === false,
        prefix: frame.prefix,
      };
      if (properties(layer.properties)) drop(`layer "${name}"'s properties aren't imported`, path);
      switch (layer.type) {
        case "group":
          return walk(layer.layers, { ...here, prefix: `${name}/` }, `${path}/layers`);
        case "tilelayer":
          return tileLayer(layer, name, here, path);
        case "objectgroup":
          return objectLayer(layer, name, here, path);
        default:
          return drop(
            `layer "${name}" is a ${String(layer.type)} layer, which doesn't import`,
            path,
          );
      }
    });
  };

  const tilesetOf = (gid: number): Placed | undefined => {
    let found: Placed | undefined;
    for (const p of placed) if (p.firstgid <= gid) found = p;
    return found;
  };

  const tileLayer = (layer: Json, name: string, frame: Frame, path: string) => {
    const byTileset = new Map<Placed, CellEdit[]>();
    let turned = 0;
    let bad = false;
    const put = (col: number, row: number, raw: number) => {
      const gid = raw & GID_MASK;
      if (gid === 0 || bad) return;
      const ts = tilesetOf(gid);
      const id = ts ? gid - ts.firstgid : -1;
      if (!ts || id >= MAX_TILES || (ts.count > 0 && id >= ts.count)) {
        bad = true;
        return fail(`layer "${name}" has gid ${gid}, which no tileset holds`, path);
      }
      const d = (raw & GID_D) !== 0;
      if (hex && (d || (raw & GID_R) !== 0)) turned++;
      const value = encodeCell({
        id,
        flipX: (raw & GID_H) !== 0,
        flipY: (raw & GID_V) !== 0,
        flipD: !hex && d,
      });
      let edits = byTileset.get(ts);
      if (!edits) byTileset.set(ts, (edits = []));
      edits.push([col, row, value]);
    };
    const fill = (gids: number[] | string, x0: number, y0: number, w: number, where: string) => {
      if (typeof gids === "string") return fail(`layer "${name}": ${gids}`, where);
      gids.forEach((g, k) => put(x0 + (k % w), y0 + Math.floor(k / w), g));
    };
    if (Array.isArray(layer.chunks))
      layer.chunks.forEach((c, k) => {
        if (!isObj(c)) return;
        fill(
          gidsOf(c.data, layer.encoding, layer.compression),
          num(c.x),
          num(c.y),
          num(c.width),
          `${path}/chunks/${k}`,
        );
      });
    else fill(gidsOf(layer.data, layer.encoding, layer.compression), 0, 0, num(layer.width), path);
    if (turned > 0)
      drop(
        `layer "${name}" turns ${turned} hex tile(s) by 60° or 120°, which a tile cell can't hold; they import unturned`,
        path,
      );
    if (frame.dx % tw !== 0 || frame.dy % th !== 0 || num(layer.parallaxx, 1) !== 1)
      drop(
        `layer "${name}"'s offset or parallax isn't a whole number of cells; it's dropped`,
        path,
      );
    const at: [number, number] =
      frame.dx % tw === 0 && frame.dy % th === 0 ? [m(frame.dx), m(frame.dy)] : [0, 0];
    const tint = rgbOf(layer.tintcolor);
    const several = byTileset.size > 1;
    for (const ts of placed) {
      const edits = byTileset.get(ts);
      if (!edits) continue;
      const entity: EntityInput = {
        type: "tilemap",
        name: several ? `${name} (${ts.name})` : name,
        z,
        at,
        tileset: ts.id,
        cells: paintGrid({}, { cells: edits }).grid,
        ...(tint !== undefined ? { tint } : {}),
        ...(frame.alpha !== 1 ? { alpha: roundLength(frame.alpha) } : {}),
        ...(frame.off ? { off: true } : {}),
      };
      sceneOps.push({ op: "add", entity });
    }
    z++;
  };

  const objectLayer = (layer: Json, name: string, frame: Frame, path: string) => {
    list(layer.objects).forEach((o, k) => {
      if (!isObj(o)) return;
      const where = `${path}/objects/${k}`;
      const label = str(o.name) || `object ${num(o.id)}`;
      const x = num(o.x) + frame.dx;
      const y = num(o.y) + frame.dy;
      const w = num(o.width);
      const h = num(o.height);
      const kind =
        o.gid !== undefined
          ? "tile"
          : o.ellipse === true
            ? "ellipse"
            : Array.isArray(o.polygon)
              ? "polygon"
              : Array.isArray(o.polyline)
                ? "polyline"
                : o.text !== undefined
                  ? "text"
                  : o.point === true || (w === 0 && h === 0)
                    ? "point"
                    : "rectangle";
      if (kind !== "point" && kind !== "rectangle")
        return drop(`${label} in layer "${name}" is a ${kind} object, which doesn't import`, where);
      const tag = asTag(o.class ?? o.type);
      const extra = properties(o.properties);
      const common = {
        ...(str(o.name) ? { name: o.name as string } : {}),
        ...(tag ? { tags: [tag] } : {}),
        ...(extra ? { extra } : {}),
        ...(frame.off || o.visible === false ? { off: true } : {}),
      };
      if (kind === "point") {
        sceneOps.push({ op: "add", entity: { type: "marker", at: [m(x), m(y)], ...common } });
        return;
      }
      const rot = num(o.rotation);
      const [cx, cy] = rectCentre(x, y, w, h, rot);
      const shape: ShapeTuple =
        rot === 0
          ? ["box", m(cx), m(cy), m(w / 2), m(h / 2)]
          : ["box", m(cx), m(cy), m(w / 2), m(h / 2), rot];
      sceneOps.push({ op: "add", entity: { type: "sensor", shape, ...common } });
    });
  };

  walk(map.layers, { dx: 0, dy: 0, alpha: 1, off: false, prefix: "" }, "/layers");
  if (properties(map.properties)) drop("the map's properties aren't imported", "/properties");

  if (notes.some((n) => n.severity === "error")) return refused();
  const sceneOp: ProjectOp[] = opts.project.byId.has(opts.scene)
    ? []
    : [{ op: "createAsset", kind: "scene", path: "scenes/", id: opts.scene }];
  return {
    ops: [...assetOps, ...sceneOp, { op: "editScene", id: opts.scene, ops: sceneOps }],
    notes,
  };
}
