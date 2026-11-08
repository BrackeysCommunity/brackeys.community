import { SPRITE, spriteGeometry, type SpriteBlock } from "../game/behaviors/sprite";
import { PRIMITIVE_TYPES, type RegisteredType, type Registry } from "../game/types";
import { assetInfo, type AssetInfo } from "../project/asset-info";
import { ATLAS_KIND } from "../project/kinds/atlas";
import type { ProjectView } from "../project/types";
import { closest } from "./did-you-mean";
import { expandScene, isExpandedScene } from "./expand";
import { decodeRow, GRID_CHUNK, gridCellBounds, parseChunkKey, type GridCells } from "./grid";
import { geometryFields } from "./schema";
import { aabb, aabbUnion, centroid, translateShape } from "./shape-geometry";
import type {
  Aabb,
  Bounds,
  ExpandedScene,
  GridSettings,
  PathDef,
  PrefabLibrary,
  Pt,
  Ref,
  RuntimeEntity,
  SceneDefinition,
  SceneIssue,
  ShapeObj,
} from "./types";

/** What part of the world a render covers. */
export type SceneRegionOptions = {
  /** A world rectangle `[x0, y0, x1, y1]`; wins over `around`. */
  region?: Bounds;
  /** Frame one entity (an id or a `~key:index` bulk ref) and everything within `margin` of it. */
  around?: Ref;
  /** World px around `around`'s box; default 128. */
  margin?: number;
  /** The prefabs a document's instances name; a document is drawn from its resolved view. */
  prefabs?: PrefabLibrary;
  /** The project the scene is in; sprite boxes take their assets' sizes and pivots from it. */
  project?: ProjectView;
};

/** An entity as the renderers draw it: world geometry, with a path rider placed at its first point. */
export type DrawnEntity = {
  id: string;
  /** A bulk entry, `~key:index`. */
  bulk: boolean;
  type: RegisteredType;
  entity: RuntimeEntity;
  /** The base primitive the type behaves as: its `base`, or itself for a primitive. */
  base: string | undefined;
  /** World shape; for a path rider, its local shape placed at the path's first point. */
  shape?: ShapeObj;
  /** A path rider's local shape, to place at each waypoint. */
  localShape?: ShapeObj;
  at?: Pt;
  path?: PathDef;
  tags: readonly string[];
  /** Where its `sprite` block draws, when it carries one. */
  sprite?: DrawnSprite;
  /** World box of everything drawn for it, path waypoints, filled grid cells and its sprite included. */
  box: Aabb;
};

/** A world point as a tuple or as `{ x, y }` (what a playtest report's events carry). */
export type OverlayPoint = Pt | { x: number; y: number };

/**
 * What a render draws over the scene. A `PlaytestReport` fits as it is:
 * its `issues`, `trail`, `events` and `outcome` are these fields.
 */
export type SceneOverlay = {
  issues?: readonly Pick<SceneIssue, "severity" | "code" | "entityIds" | "at">[];
  /** The focus trail, oldest first. */
  trail?: readonly Pt[] | { pts: readonly Pt[] };
  events?: readonly { type: string; at: OverlayPoint; tick?: number; entityId?: string }[];
  outcome?: { result: string; at: OverlayPoint | null; tick?: number; cause?: string } | null;
};

export const DEFAULT_MARGIN = 128;

export function expandedOf(
  scene: SceneDefinition | ExpandedScene,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ExpandedScene {
  return isExpandedScene(scene)
    ? scene
    : expandScene(scene as SceneDefinition, registry, { prefabs });
}

const isPrimitive = (name: string) => (PRIMITIVE_TYPES as readonly string[]).includes(name);

/**
 * Every entity of `scene` with a registered type, in spawn order, with its
 * world geometry; sprites are sized from `assets` when given.
 */
export function drawnEntities(
  scene: ExpandedScene,
  registry: Registry,
  assets?: SpriteAssetLookup,
): DrawnEntity[] {
  const grid = scene.settings.grid;
  const out: DrawnEntity[] = [];
  for (const e of scene.entities) {
    const type = registry.types.get(e.type);
    if (!type) continue;
    let local: ShapeObj | undefined;
    let at: Pt | undefined;
    let path: PathDef | undefined;
    for (const { field, kind } of geometryFields(type)) {
      const value = e[field];
      if (value === undefined) continue;
      if (kind === "shape") local ??= value as ShapeObj;
      else if (kind === "point") at ??= value as Pt;
      else if (kind === "path") path ??= value as PathDef;
    }
    const first = path?.pts[0];
    const shape = local && first ? translateShape(local, first) : local;
    let box: Aabb | undefined = shape ? aabb(shape) : undefined;
    if (local && path)
      for (const p of path.pts) box = aabbUnion(box!, aabb(translateShape(local, p)));
    if (at) {
      const pt = { minX: at[0], minY: at[1], maxX: at[0], maxY: at[1] };
      box = box ? aabbUnion(box, pt) : pt;
      if (grid) box = growOverGrid(box, grid, at, gridValues(type, e));
    }
    if (!box) continue;
    const sprite = spriteBoxOf(
      e.behaviors?.[SPRITE.name],
      { shape, at, path, transform: e.transform },
      assets,
    );
    if (sprite) box = aabbUnion(box, sprite.box);
    const tags = Array.isArray(e.tags)
      ? e.tags.filter((t): t is string => typeof t === "string")
      : [];
    out.push({
      id: e.id,
      bulk: e.id.startsWith("~"),
      type,
      entity: e,
      base: type.base ?? (isPrimitive(type.type) ? type.type : undefined),
      ...(shape ? { shape } : {}),
      ...(local && path ? { localShape: local } : {}),
      ...(at ? { at } : {}),
      ...(path ? { path } : {}),
      tags,
      ...(sprite ? { sprite } : {}),
      box,
    });
  }
  return out;
}

export const overlaps = (b: Aabb, [x0, y0, x1, y1]: Bounds) =>
  b.maxX >= x0 && b.minX <= x1 && b.maxY >= y0 && b.minY <= y1;

/** The world rectangle a render covers: `region`, else `around` plus `margin`, else the scene's bounds. */
export function resolveRegion(
  scene: ExpandedScene,
  entities: readonly DrawnEntity[],
  opts: SceneRegionOptions,
): Bounds {
  if (opts.region) {
    const [x0, y0, x1, y1] = opts.region;
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
      throw new Error(`region [${opts.region.join(", ")}] must be finite with x1 > x0 and y1 > y0`);
    }
    return [x0, y0, x1, y1];
  }
  if (opts.around !== undefined) {
    const hit = entities.find((d) => d.id === opts.around);
    if (!hit) {
      const guess = closest(
        opts.around,
        entities.map((d) => d.id),
      );
      throw new Error(
        `no entity ${JSON.stringify(opts.around)} to frame${guess ? `; did you mean "${guess}"?` : ""}`,
      );
    }
    const m = Math.max(opts.margin ?? DEFAULT_MARGIN, 0);
    // A point with no margin still needs an area to draw.
    const w = hit.box.maxX - hit.box.minX < 1 ? 0.5 : 0;
    const h = hit.box.maxY - hit.box.minY < 1 ? 0.5 : 0;
    return [hit.box.minX - m - w, hit.box.minY - m - h, hit.box.maxX + m + w, hit.box.maxY + m + h];
  }
  const [x0, y0, x1, y1] = scene.bounds;
  return [x0, y0, x1, y1];
}

/** Text a renderer prints: two decimals at most, no `-0`. */
export function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

// ─── Grid fields ─────────────────────────────────────────

/** The most grid cells one render draws; a "…" stands where the rest begin. */
export const SCENE_GRID_MAX_CELLS = 4096;

/** One filled cell of a grid field, placed in the world. */
export type DrawnGridCell = {
  entity: DrawnEntity;
  field: string;
  col: number;
  row: number;
  value: number;
  /** World outline: a rectangle, or a hexagon on a hex grid. */
  outline: Pt[];
  box: Aabb;
};

/** The filled grid cells a render draws, in entity order and row-major within each field. */
export type DrawnGridCells = {
  cells: DrawnGridCell[];
  /** Filled cells in the region past the cap, not drawn. */
  more: number;
  /** The centre of the first cell not drawn. */
  moreAt: Pt | null;
};

const boxOfPts = (pts: readonly Pt[]): Aabb => {
  let b: Aabb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of pts)
    b = {
      minX: Math.min(b.minX, x),
      minY: Math.min(b.minY, y),
      maxX: Math.max(b.maxX, x),
      maxY: Math.max(b.maxY, y),
    };
  return b;
};

/** A cell's outline with the grid's cell (0, 0) top-left corner at `origin`; hex grids stagger as Tiled's do. */
export function gridCellOutline(grid: GridSettings, [ox, oy]: Pt, col: number, row: number): Pt[] {
  const [w, h] = grid.cell;
  if (grid.kind === "square") {
    const x = ox + col * w;
    const y = oy + row * h;
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  const { side } = grid;
  const shifted = (n: number) => ((n & 1) === 1) === (grid.index === "odd");
  if (grid.stagger === "y") {
    const x = ox + col * w + (shifted(row) ? w / 2 : 0);
    const y = oy + (row * (h + side)) / 2;
    const t = (h - side) / 2;
    return [
      [x + w / 2, y],
      [x + w, y + t],
      [x + w, y + t + side],
      [x + w / 2, y + h],
      [x, y + t + side],
      [x, y + t],
    ];
  }
  const x = ox + (col * (w + side)) / 2;
  const y = oy + row * h + (shifted(col) ? h / 2 : 0);
  const t = (w - side) / 2;
  return [
    [x, y + h / 2],
    [x + t, y],
    [x + t + side, y],
    [x + w, y + h / 2],
    [x + t + side, y + h],
    [x + t, y + h],
  ];
}

/** An entity's grid fields that hold a grid value. */
function gridValues(type: RegisteredType, e: RuntimeEntity): { field: string; value: GridCells }[] {
  const out: { field: string; value: GridCells }[] = [];
  for (const { field, kind } of geometryFields(type)) {
    const value = e[field];
    if (kind === "grid" && value !== null && typeof value === "object" && !Array.isArray(value))
      out.push({ field, value: value as GridCells });
  }
  return out;
}

/** `box` grown over the filled cells of `values`, placed at `at`. */
function growOverGrid(
  box: Aabb,
  grid: GridSettings,
  at: Pt,
  values: readonly { value: GridCells }[],
): Aabb {
  for (const { value } of values) {
    const b = gridCellBounds(value);
    if (!b) continue;
    // Both row and column parities at each edge, so a staggered hex row is covered.
    const cols = [...new Set([b.c0, Math.min(b.c0 + 1, b.c1), Math.max(b.c1 - 1, b.c0), b.c1])];
    const rows = [...new Set([b.r0, Math.min(b.r0 + 1, b.r1), Math.max(b.r1 - 1, b.r0), b.r1])];
    for (const c of cols)
      for (const r of rows) box = aabbUnion(box, boxOfPts(gridCellOutline(grid, at, c, r)));
  }
  return box;
}

/**
 * The filled cells of every grid field that fall in `region`, at most `max`
 * of them; cells are local to their entity's `at` and sized by the scene's
 * grid. Nothing without a grid.
 */
export function gridCellsIn(
  entities: readonly DrawnEntity[],
  grid: GridSettings | null,
  [x0, y0, x1, y1]: Bounds,
  max = SCENE_GRID_MAX_CELLS,
): DrawnGridCells {
  const out: DrawnGridCells = { cells: [], more: 0, moreAt: null };
  if (!grid) return out;
  for (const d of entities) {
    if (!d.at) continue;
    for (const { field, value } of gridValues(d.type, d.entity)) {
      const found: DrawnGridCell[] = [];
      for (const [key, rows] of Object.entries(value)) {
        const chunk = parseChunkKey(key);
        if (!chunk || !Array.isArray(rows)) continue;
        rows.forEach((text, r) => {
          const cells = typeof text === "string" ? decodeRow(text) : null;
          if (!cells) return;
          for (let i = 0; i < GRID_CHUNK; i++) {
            const v = cells[i] ?? 0;
            if (v === 0) continue;
            const col = chunk[0] * GRID_CHUNK + i;
            const row = chunk[1] * GRID_CHUNK + r;
            const outline = gridCellOutline(grid, d.at!, col, row);
            const box = boxOfPts(outline);
            if (box.maxX <= x0 || box.minX >= x1 || box.maxY <= y0 || box.minY >= y1) continue;
            found.push({ entity: d, field, col, row, value: v, outline, box });
          }
        });
      }
      found.sort((a, b) => a.row - b.row || a.col - b.col);
      for (const c of found) {
        if (out.cells.length < max) {
          out.cells.push(c);
          continue;
        }
        if (out.more === 0)
          out.moreAt = [(c.box.minX + c.box.maxX) / 2, (c.box.minY + c.box.maxY) / 2];
        out.more++;
      }
    }
  }
  return out;
}

// ─── Sprites ─────────────────────────────────────────────

/** An asset's info by id, and with `frame` an atlas frame's: `assetInfo` over a project, or `ProjectRuntimeView.asset`. */
export type SpriteAssetLookup = (id: string, frame?: string) => AssetInfo | null | undefined;

/** `assetInfo` over `view`, as a sprite lookup. */
export const projectSpriteAssets =
  (view: ProjectView): SpriteAssetLookup =>
  (id, frame) =>
    assetInfo(view, id, frame);

/** The sprite lookup a render's options give. */
export const renderAssets = (opts: Pick<SceneRegionOptions, "project">) =>
  opts.project ? projectSpriteAssets(opts.project) : undefined;

/** Where a sprite block draws in the world. */
export type DrawnSprite = {
  asset?: string;
  frame?: string;
  /** `asset`, `asset:frame`, or `(no asset)`: what the renders print on the box. */
  label: string;
  /** Drawn size, world px: the block's, else its asset's times `scale`, else 32×32. */
  size: [w: number, h: number];
  /** The drawn rectangle in world px, turned with the entity when the sprite turns. */
  shape: Extract<ShapeObj, { type: "box" }>;
  box: Aabb;
};

/** The entity geometry a sprite is posed from: world shape, point and path, and the turns and flips above it. */
export type SpritePoseSource = {
  shape?: ShapeObj;
  at?: Pt;
  path?: Pick<PathDef, "pts">;
  transform?: RuntimeEntity["transform"];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pairOf = (v: unknown, ok: (n: number) => boolean): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && ok(v[0]) && ok(v[1])
    ? [v[0], v[1]]
    : undefined;

/** The fields of a sprite block the geometry reads, each kept only when it has its schema's shape. */
function readSpriteBlock(v: unknown): Partial<SpriteBlock> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  const out: Partial<SpriteBlock> = {};
  if (typeof b.asset === "string") out.asset = b.asset;
  if (typeof b.frame === "string") out.frame = b.frame;
  const size = pairOf(b.size, (n) => n > 0);
  if (size) out.size = size;
  if (isNum(b.scale) && b.scale > 0) out.scale = b.scale;
  const anchor = pairOf(b.anchor, () => true);
  if (anchor) out.anchor = anchor;
  const offset = pairOf(b.offset, () => true);
  if (offset) out.offset = offset;
  if (typeof b.flipX === "boolean") out.flipX = b.flipX;
  if (typeof b.flipY === "boolean") out.flipY = b.flipY;
  if (typeof b.turn === "boolean") out.turn = b.turn;
  return out;
}

/** The info a block sizes from, as the sprite system picks it: a texture's own, an atlas frame's; none for an atlas without a frame. */
function spriteInfo(
  block: Partial<SpriteBlock>,
  assets?: SpriteAssetLookup,
): AssetInfo | undefined {
  if (!assets || block.asset === undefined) return undefined;
  const own = assets(block.asset);
  if (!own) return undefined;
  if (own.kind !== ATLAS_KIND) return own;
  return block.frame === undefined ? undefined : (assets(block.asset, block.frame) ?? undefined);
}

/** `v` turned `deg` degrees clockwise on screen; quarter turns are exact. */
function turnVec([x, y]: Pt, deg: number): Pt {
  switch (((deg % 360) + 360) % 360) {
    case 0:
      return [x, y];
    case 90:
      return [-y + 0, x];
    case 180:
      return [-x + 0, -y + 0];
    case 270:
      return [y, -x + 0];
  }
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/** An entity's pose as the runtime spawns it: a shape's centre and angle, else its point, else its path's first point. */
function spritePose(src: SpritePoseSource): { at: Pt; deg: number } | null {
  const turned = (src.transform?.turn ?? 0) * 90;
  const s = src.shape;
  if (s) {
    switch (s.type) {
      case "box":
      case "capsule":
        return { at: [s.cx, s.cy], deg: s.rotDeg };
      case "circle":
        return { at: [s.cx, s.cy], deg: turned };
      case "poly":
        return { at: centroid(s.pts), deg: turned };
      case "chain": {
        const b = aabb(s);
        return { at: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], deg: turned };
      }
    }
  }
  const p = src.at ?? src.path?.pts[0];
  return p ? { at: [p[0], p[1]], deg: turned } : null;
}

/**
 * Where a `sprite` block draws for an entity posed by `src`, as the sprite
 * system places it: `spriteGeometry` of the block (its flip toggled by the
 * entity's) and its asset's info from `assets`, at the pose plus the
 * offset. The offset mirrors with the entity's flip and turns with the
 * pose, or with `turn: false` with the quarter turns only. Undefined for a
 * value that isn't a block or an entity with no pose.
 */
export function spriteBoxOf(
  block: unknown,
  src: SpritePoseSource,
  assets?: SpriteAssetLookup,
): DrawnSprite | undefined {
  const read = readSpriteBlock(block);
  const pose = read && spritePose(src);
  if (!read || !pose) return undefined;
  const flip = src.transform?.flip ?? false;
  const g = spriteGeometry(
    { ...read, flipX: (read.flipX ?? false) !== flip },
    spriteInfo(read, assets),
  );
  const turn = read.turn !== false;
  const deg = turn ? pose.deg : 0;
  const offset = turnVec(
    flip ? [-g.offset[0] + 0, g.offset[1]] : g.offset,
    turn ? pose.deg : (src.transform?.turn ?? 0) * 90,
  );
  const centre = turnVec([g.box.cx, g.box.cy], deg);
  const shape: DrawnSprite["shape"] = {
    type: "box",
    cx: pose.at[0] + offset[0] + centre[0],
    cy: pose.at[1] + offset[1] + centre[1],
    hw: g.box.hw,
    hh: g.box.hh,
    rotDeg: deg,
  };
  const label =
    read.asset === undefined
      ? "(no asset)"
      : read.frame === undefined
        ? read.asset
        : `${read.asset}:${read.frame}`;
  return {
    ...(read.asset !== undefined ? { asset: read.asset } : {}),
    ...(read.frame !== undefined ? { frame: read.frame } : {}),
    label,
    size: g.size,
    shape,
    box: aabb(shape),
  };
}

/** One entity's sprite in a scene, by its ref. */
export type SceneSprite = DrawnSprite & { ref: string; type: string };

/**
 * Every sprite the scene draws, in spawn order: each entity carrying a
 * `sprite` block (its type's defaults included), its world box sized from
 * `opts.project` when given.
 */
export function sceneSprites(
  scene: SceneDefinition | ExpandedScene,
  opts: Pick<SceneRegionOptions, "prefabs" | "project"> & { registry: Registry },
): SceneSprite[] {
  const expanded = expandedOf(scene, opts.registry, opts.prefabs);
  return drawnEntities(expanded, opts.registry, renderAssets(opts)).flatMap((d) =>
    d.sprite ? [{ ref: d.id, type: d.type.type, ...d.sprite }] : [],
  );
}
