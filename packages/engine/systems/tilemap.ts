import type { Collider, RigidBody } from "@dimforge/rapier2d";

import type { TilemapVisual } from "../context";
import { physicsOf } from "../game/physics-of";
import { decodeCell, type TileCell } from "../game/tile-cell";
import { EngineError } from "../game/types";
import type {
  ColliderTag,
  EngineContext,
  JsonValue,
  RegisteredType,
  SceneSystem,
  Side,
  TileAt,
  TilesContext,
} from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { gridGeometry, type Cell, type CellBounds, type GridGeometry } from "../grid/geometry";
import { shapeColliderDesc } from "../physics";
import { ATLAS_KIND } from "../project/kinds/atlas";
import { tilemapIssues, type TileDef, type TilesetFile } from "../project/kinds/tileset";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import { framePose, type Pose } from "../runtime/poses";
import {
  compareChunkKeys,
  GRID_CHUNK,
  gridCellBounds,
  paintGrid,
  readCell,
  type CellEdit,
  type CellRect,
  type ChunkKey,
  type GridCells,
} from "../scene/grid";
import { aabb, shapeAtPose } from "../scene/shape-geometry";
import { parseShape } from "../scene/shapes";
import { turnRadians } from "../scene/transform";
import type { Aabb, GridSettings, Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import { applyAutotile } from "../tiles/autotile";
import {
  decodeChunks,
  dirtyChunks,
  forEachChunkRun,
  mapCellKey,
  parseMapCellKey,
  tileTraits,
  type TileChunk,
} from "../tiles/chunks";
import {
  DEFAULT_TILE_COLLISION,
  runBoxes,
  outlineChains,
  type TileCollision,
} from "../tiles/colliders";
import { tileOffset } from "../tiles/mesh";
import {
  addGeometryCollider,
  applySurface,
  entityDrawLayer,
  oneWayPasses,
  onOneWaySide,
  removeGeometryCollider,
  surfaceOf,
} from "./bodies";

export type TilemapEntity = RuntimeEntity<{
  at: Pt;
  tileset: AssetId;
  cells: GridCells;
  collision?: TileCollision;
  tint?: number;
  alpha?: number;
}>;

/** The system for tilemap entities, one per runtime whatever types spawn them; `ctx.tiles` reads and writes through it. */
export type TilemapSystem = SceneSystem<TilemapEntity> &
  TilesContext & {
    readonly tilemapSystem: true;
    /** In spawn order. */
    list(): TilemapEntity[];
    /** Rebuilds what runtime writes left dirty; the runtime calls it once per tick after the destroy flush. True when anything was rebuilt. */
    flushWrites(): boolean;
    /** Writes the pose index and moves the map's colliders and drawing with it. */
    setPose(id: string, x: number, y: number, rot: number): void;
    /** Gates one-way tiles for `actorId` alone; other actors fall through to `oneWayPasses`. */
    passesOneWay(actorId: string, actor: Aabb, passing: boolean): void;
    /** How many colliders each chunk of tilemap `id` holds now, by chunk key; for tools and tests. */
    chunkColliders(id: string): ReadonlyMap<ChunkKey, number>;
    /** Tilemap `id`'s cells now: the scene's with runtime writes over them. */
    cells(id: string): GridCells | undefined;
    /**
     * Calls `fn` whenever a map's colliders rebuilt for changed cells (at the
     * write flush, an editor update or a restore), with the chunks rebuilt;
     * returns the unsubscribe.
     */
    watchCells(fn: (id: string, chunks: readonly ChunkKey[]) => void): () => void;
    /** Rebuilds maps whose tileset or its image changed, keeping runtime writes; a map whose tileset no longer loads keeps its last build and is reported. */
    reloadAssets(
      changed: readonly AssetId[],
    ): { entityId: string; error: unknown; reattached: boolean }[];
  };

/** Whether `system` is the tilemap system, whatever type name spawns it. */
export function isTilemapSystem(system: SceneSystem | undefined): system is TilemapSystem {
  return system !== undefined && (system as Partial<TilemapSystem>).tilemapSystem === true;
}

/** The tilemap system among a runtime's systems, if one is registered. */
export function findTilemapSystem(systems: Iterable<SceneSystem>): TilemapSystem | undefined {
  for (const s of systems) if (isTilemapSystem(s)) return s;
  return undefined;
}

const NO_TILES: readonly TileAt[] = Object.freeze([]);
const NO_CELLS: readonly Cell[] = Object.freeze([]);
/** How many writes `inspect` lists before it only counts them. */
const INSPECT_WRITES = 64;

/** Where a map's cells sit in the world: the scene grid, and the grid cell its own cell (0, 0) is. */
export type TilePlacement = { geo: GridGeometry; settings: GridSettings; offset: Cell };

/**
 * The grid a tilemap at `at` sits on: the scene's, else a square grid of
 * `fallbackCell` (m) from the origin; its cell (0, 0) is the grid cell whose
 * top-left corner is `at`.
 */
export function tilePlacement(
  grid: GridSettings | null,
  at: Pt,
  fallbackCell: [number, number],
): TilePlacement {
  const settings: GridSettings = grid ?? { kind: "square", cell: fallbackCell };
  const geo = gridGeometry(settings);
  return { geo, settings, offset: tileOffset(settings, at, geo) };
}

/** The top-left of a map cell's bounding box, world m. */
function cellTopLeft(p: TilePlacement, col: number, row: number): Pt {
  const [cx, cy] = p.geo.center([col + p.offset[0], row + p.offset[1]]);
  return [cx - p.settings.cell[0] / 2, cy - p.settings.cell[1] / 2];
}

/** The world box a map's cells cover, as a polygon; null when it has none. */
export function tilemapExtent(cells: GridCells, p: TilePlacement): ShapeObj | null {
  const b = gridCellBounds(cells);
  if (!b) return null;
  const [w, h] = p.settings.cell;
  const corners = [
    cellTopLeft(p, b.c0, b.r0),
    cellTopLeft(p, b.c1, b.r1),
    cellTopLeft(p, b.c0, b.r1),
    cellTopLeft(p, b.c1, b.r0),
  ];
  // Staggered hex rows push alternate cells half a cell along: take the widest.
  if (p.settings.kind === "hex")
    for (const [c, r] of [
      [b.c0 + 1, b.r0 + 1],
      [b.c1 - 1, b.r1 - 1],
    ] as const)
      if (c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1) corners.push(cellTopLeft(p, c, r));
  const minX = Math.min(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxX = Math.max(...corners.map((c) => c[0])) + w;
  const maxY = Math.max(...corners.map((c) => c[1])) + h;
  return {
    type: "poly",
    pts: [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ],
  };
}

/** A tilemap entity's world box at spawn, for `ctx.query`'s area queries; null without cells. */
export function tilemapExtentOf(
  ctx: Pick<EngineContext, "settings" | "project" | "registry">,
  e: { readonly [field: string]: unknown },
): ShapeObj | null {
  if (!Array.isArray(e.at) || e.cells === null || typeof e.cells !== "object") return null;
  const at = e.at as Pt;
  let fallback: [number, number] = [1, 1];
  if (!ctx.settings.grid && typeof e.tileset === "string") {
    const tile = ctx.project?.doc?.<TilesetFile>("tileset", e.tileset)?.tile;
    const ppm = pxPerMetreOf(ctx.registry);
    if (tile) fallback = [tile[0] / ppm, tile[1] / ppm];
  }
  return tilemapExtent(e.cells as GridCells, tilePlacement(ctx.settings.grid, at, fallback));
}

/** A one-way tile's side under its cell's flips: Tiled's diagonal flip first, then horizontal, then vertical. */
function flippedSide(side: Side, flipX: boolean, flipY: boolean, flipD: boolean): Side {
  let s = side;
  if (flipD) s = ({ up: "left", left: "up", down: "right", right: "down" } as const)[s];
  if (flipX && (s === "left" || s === "right")) s = s === "left" ? "right" : "left";
  if (flipY && (s === "up" || s === "down")) s = s === "up" ? "down" : "up";
  return s;
}

/** A tile's own collision shape (tile px about its top-left) in metres at `topLeft`, under its cell's flips. */
function tileShape(
  shape: ShapeObj,
  topLeft: Pt,
  tile: [number, number],
  ppm: number,
  flips: { flipX: boolean; flipY: boolean; flipD: boolean },
): ShapeObj {
  const [tw, th] = tile;
  const move = ([x, y]: Pt): Pt => {
    let px = x;
    let py = y;
    if (flips.flipD) [px, py] = [py, px];
    if (flips.flipX) px = tw - px;
    if (flips.flipY) py = th - py;
    return [topLeft[0] + px / ppm, topLeft[1] + py / ppm];
  };
  const turn = (deg: number): number => {
    const r = (deg * Math.PI) / 180;
    let dx = Math.cos(r);
    let dy = Math.sin(r);
    if (flips.flipD) [dx, dy] = [dy, dx];
    if (flips.flipX) dx = -dx;
    if (flips.flipY) dy = -dy;
    return ((((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;
  };
  switch (shape.type) {
    case "poly":
    case "chain": {
      const pts = shape.pts.map(move);
      const mirrored = flips.flipD !== (flips.flipX !== flips.flipY);
      return { type: shape.type, pts: mirrored ? pts.reverse() : pts };
    }
    case "circle": {
      const [cx, cy] = move([shape.cx, shape.cy]);
      return { ...shape, cx, cy, r: shape.r / ppm };
    }
    case "box": {
      const [cx, cy] = move([shape.cx, shape.cy]);
      return {
        ...shape,
        cx,
        cy,
        hw: shape.hw / ppm,
        hh: shape.hh / ppm,
        rotDeg: turn(shape.rotDeg),
      };
    }
    case "capsule": {
      const [cx, cy] = move([shape.cx, shape.cy]);
      return {
        ...shape,
        cx,
        cy,
        halfLen: shape.halfLen / ppm,
        r: shape.r / ppm,
        rotDeg: turn(shape.rotDeg),
      };
    }
  }
}

/** The image a tileset cuts: a texture's info, or for an atlas its texture's. */
function tilesetImage(project: ProjectRuntimeView, image: AssetId) {
  const info = project.asset(image);
  return info?.kind === ATLAS_KIND && info.texture !== undefined
    ? project.asset(info.texture)
    : info;
}

/** One collider a chunk built: its shape at spawn (world m) and, when one-way, its side. */
type Part = { shape: ShapeObj; tag: ColliderTag; side: Side | null };

type Built = { handle: number; collider: Collider | null; part: Part };

type LiveMap = {
  e: TilemapEntity;
  tileset: TilesetFile | undefined;
  /** The sha256 of the image the tileset cuts, as last drawn. */
  image: string | undefined;
  defs: ReadonlyMap<number, TileDef>;
  place: TilePlacement;
  /** Where the map's colliders and drawing were built: its `at`, at its frame's angle. */
  drawn: Pose;
  /** The shift from `drawn` to where the map is now. */
  delta: Pose;
  body: RigidBody | null;
  chunks: Map<ChunkKey, Built[]>;
  /** The scene's cells with `writes` over them. */
  cells: GridCells;
  /** Runtime writes that differ from the scene's cells, by map-local `"col,row"`. */
  writes: Map<string, number>;
  /** Chunks painted since the last flush. */
  dirty: Set<ChunkKey>;
};

type Write = [col: number, row: number, value: number];

/** Writes as `[col, row, value]`, row-major. */
function sortedWrites(writes: ReadonlyMap<string, number>): Write[] {
  const out: Write[] = [];
  for (const [key, value] of writes) {
    const [col, row] = parseMapCellKey(key);
    out.push([col, row, value]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function isWrite(v: JsonValue): v is Write {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isSafeInteger(n));
}

const IDENTITY: Pose = Object.freeze({ x: 0, y: 0, rot: 0 });

/** An outline chain in world m, its first point repeated at the end: colliders build chains open. */
function closedChain(chain: readonly Pt[], ox: number, oy: number, w: number, h: number): Pt[] {
  const pts = chain.map(([x, y]): Pt => [ox + x * w, oy + y * h]);
  if (pts.length > 2) pts.push([pts[0]![0], pts[0]![1]]);
  return pts;
}

const sameTileset = (a: TilesetFile | undefined, b: TilesetFile | undefined) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Tilemaps: colliders built per chunk from `tileTraits`, posed by the map's frame; the view gets data only. */
export function createTilemapSystem(ctx: EngineContext, _type: RegisteredType): TilemapSystem {
  const live = new Map<string, LiveMap>();
  const groups = ctx.registry.collisionGroups("static");
  const ppm = pxPerMetreOf(ctx.registry);
  /** The one-way handles this system put in each actor's passes. */
  const passed = new Map<string, Set<number>>();

  function resolveTileset(e: TilemapEntity, cells: GridCells = e.cells): TilesetFile | undefined {
    const project = ctx.project;
    if (!project) return undefined;
    const tileset = project.doc?.<TilesetFile>("tileset", e.tileset);
    const grid = ctx.settings.grid;
    const issues = tilemapIssues(
      { id: e.id, tileset: e.tileset, cells },
      tileset,
      tileset ? (tilesetImage(project, tileset.image) ?? null) : null,
      grid ? { settings: grid, pxPerMetre: ppm } : null,
    );
    const bad = issues.find((i) => i.severity === "error");
    if (bad) throw new EngineError(bad.code, bad.message, e.id);
    return tileset;
  }

  function partsOf(m: LiveMap, chunk: TileChunk): Part[] {
    const mode = m.e.collision ?? DEFAULT_TILE_COLLISION;
    if (mode === "none" || !m.tileset) return [];
    const tile = m.tileset.tile;
    const [w, h] = m.place.settings.cell;
    const hex = m.place.settings.kind === "hex";
    const c0 = chunk.cx * GRID_CHUNK;
    const r0 = chunk.cy * GRID_CHUNK;
    const rect: CellBounds = { c0, r0, c1: c0 + GRID_CHUNK - 1, r1: r0 + GRID_CHUNK - 1 };
    const valueAt = (col: number, row: number) =>
      col < rect.c0 || col > rect.c1 || row < rect.r0 || row > rect.r1
        ? 0
        : (chunk.values[(row - r0) * GRID_CHUNK + (col - c0)] ?? 0);

    const tagOf = (
      tileId: number,
      cell: Cell,
      material: AssetId | undefined,
      side: Side | null,
    ) => {
      const tag: ColliderTag = {
        entityId: m.e.id,
        type: m.e.type,
        tile: { map: m.e.id, tile: tileId, cell },
      };
      if (material !== undefined) tag.material = material;
      if (side) {
        tag.oneWay = true;
        tag.oneWaySide = side;
      }
      return tag;
    };
    const cellBox = (b: CellBounds): ShapeObj => {
      const [x0, y0] = cellTopLeft(m.place, b.c0, b.r0);
      const hw = ((b.c1 - b.c0 + 1) * w) / 2;
      const hh = ((b.r1 - b.r0 + 1) * h) / 2;
      return { type: "box", cx: x0 + hw, cy: y0 + hh, hw, hh, rotDeg: 0 };
    };

    const parts: Part[] = [];
    /** Plain solid cells by material and one-way side: what merges, in first-seen order. */
    const merged = new Map<
      string,
      { group: number; material: AssetId | undefined; side: Side | null; runs: number[][] }
    >();
    /** Each cell's merge group, 1-based; 0 for cells that don't merge. */
    const groupOf = new Int32Array(chunk.values.length);
    /** The run being extended: its group's runs, row and first and last column. */
    let run: { runs: number[][]; row: number; c0: number; c1: number } | null = null;
    const closeRun = () => {
      if (!run) return;
      const row = (run.runs[run.row - r0] ??= []);
      row.push(run.c0, run.c1);
      run = null;
    };
    /** Per cell value, its decoded tile and traits; null for empty or non-solid values. */
    const solids = new Map<
      number,
      { cell: NonNullable<TileCell>; def: TileDef | undefined; side: Side | null } | null
    >();
    // Run by run, as the rows encode them: most of a chunk is long runs.
    forEachChunkRun(chunk.key, m.cells[chunk.key], (value, c, r, count) => {
      if (value === 0) return;
      let solid = solids.get(value);
      if (solid === undefined) {
        const cell = decodeCell(value);
        const def = cell ? m.defs.get(cell.id) : undefined;
        const traits = tileTraits(def);
        solid =
          cell && traits.solid
            ? {
                cell,
                def,
                side: traits.oneWay
                  ? flippedSide(traits.oneWay, cell.flipX, cell.flipY, cell.flipD)
                  : null,
              }
            : null;
        solids.set(value, solid);
      }
      if (!solid) return;
      const { cell, def, side } = solid;
      const row = r0 + r;
      const first = c0 + c;
      const last = first + count - 1;
      const own = def?.shapes;
      if (own && own.length > 0) {
        for (let col = first; col <= last; col++) {
          const topLeft = cellTopLeft(m.place, col, row);
          for (const tuple of own) {
            const parsed = parseShape(tuple);
            if (!parsed.ok) continue;
            parts.push({
              shape: tileShape(parsed.shape, topLeft, tile, ppm, cell),
              tag: tagOf(cell.id, [col, row], def.material, side),
              side,
            });
          }
        }
        return;
      }
      if (hex || mode === "tiles") {
        for (let col = first; col <= last; col++)
          parts.push({
            shape: hex
              ? {
                  type: "poly",
                  pts: m.place.geo.corners([col + m.place.offset[0], row + m.place.offset[1]]),
                }
              : cellBox({ c0: col, r0: row, c1: col, r1: row }),
            tag: tagOf(cell.id, [col, row], def?.material, side),
            side,
          });
        return;
      }
      const key = `${def?.material ?? ""}|${side ?? ""}`;
      let group = merged.get(key);
      if (!group) {
        group = { group: merged.size + 1, material: def?.material, side, runs: [] };
        merged.set(key, group);
      }
      groupOf.fill(group.group, r * GRID_CHUNK + c, r * GRID_CHUNK + c + count);
      if (run && run.runs === group.runs && run.row === row && run.c1 === first - 1) run.c1 = last;
      else {
        closeRun();
        run = { runs: group.runs, row, c0: first, c1: last };
      }
    });
    closeRun();

    const firstCell = (b: CellBounds): { tile: number; cell: Cell } => ({
      tile: decodeCell(valueAt(b.c0, b.r0))?.id ?? 0,
      cell: [b.c0, b.r0],
    });
    for (const key of [...merged.keys()].sort()) {
      const { group, material, side, runs } = merged.get(key)!;
      const inGroup = (col: number, row: number) =>
        col >= rect.c0 &&
        col <= rect.c1 &&
        row >= rect.r0 &&
        row <= rect.r1 &&
        groupOf[(row - r0) * GRID_CHUNK + (col - c0)] === group;
      if (mode === "outline" && !side) {
        let first: CellBounds | null = null;
        for (let i = 0; i < chunk.values.length && !first; i++)
          if (groupOf[i] === group) {
            const col = c0 + (i % GRID_CHUNK);
            const row = r0 + Math.floor(i / GRID_CHUNK);
            first = { c0: col, r0: row, c1: col, r1: row };
          }
        const at = firstCell(first ?? rect);
        const [ox, oy] = cellTopLeft(m.place, 0, 0);
        for (const chain of outlineChains(inGroup, rect))
          parts.push({
            shape: { type: "chain", pts: closedChain(chain, ox, oy, w, h) },
            tag: tagOf(at.tile, at.cell, material, null),
            side: null,
          });
        continue;
      }
      const boxes: CellBounds[] = [];
      runBoxes(runs, r0, boxes);
      for (const b of boxes) {
        const at = firstCell(b);
        parts.push({ shape: cellBox(b), tag: tagOf(at.tile, at.cell, material, side), side });
      }
    }
    return parts;
  }

  function addPart(m: LiveMap, part: Part): Built | null {
    if (ctx.physics) {
      const { rapier, physics } = physicsOf(ctx, m.e.type, m.e.id);
      if (!m.body) {
        const desc = rapier.RigidBodyDesc.fixed()
          .setTranslation(m.delta.x, m.delta.y)
          .setRotation(m.delta.rot);
        m.body = physics.addRigidBody(desc);
      }
      const desc = applySurface(
        shapeColliderDesc(rapier, part.shape, true).setCollisionGroups(groups),
        surfaceOf(ctx, part.tag.material, {}),
      );
      const collider = physics.addCollider(desc, m.body);
      ctx.tags.set(collider.handle, part.tag);
      return { handle: collider.handle, collider, part };
    }
    const shape = m.delta === IDENTITY ? part.shape : shapeAtPose(part.shape, m.delta);
    const handle = addGeometryCollider(ctx, shape, { body: "static" }, part.tag);
    return handle === null ? null : { handle, collider: null, part };
  }

  function removeBuilt(b: Built): void {
    forgetPass(b.handle);
    if (b.collider) {
      ctx.tags.delete(b.handle);
      ctx.physics?.removeCollider(b.collider);
    } else removeGeometryCollider(ctx, b.handle);
  }

  function forgetPass(handle: number): void {
    for (const [actor, mine] of passed) {
      if (!mine.delete(handle)) continue;
      (oneWayPasses(ctx, actor) as Set<number>).delete(handle);
    }
  }

  function buildChunk(m: LiveMap, chunk: TileChunk): void {
    const built: Built[] = [];
    for (const part of partsOf(m, chunk)) {
      const b = addPart(m, part);
      if (b) built.push(b);
    }
    if (built.length > 0) m.chunks.set(chunk.key, built);
  }

  function dropChunk(m: LiveMap, key: ChunkKey): void {
    for (const b of m.chunks.get(key) ?? []) removeBuilt(b);
    m.chunks.delete(key);
  }

  function dropAll(m: LiveMap): void {
    for (const key of [...m.chunks.keys()]) dropChunk(m, key);
    if (m.body) ctx.physics?.removeRigidBody(m.body);
    m.body = null;
  }

  function imageOf(tileset: TilesetFile | undefined): string | undefined {
    const project = ctx.project;
    return tileset && project ? tilesetImage(project, tileset.image)?.sha256 : undefined;
  }

  function visualOf(m: LiveMap): TilemapVisual | null {
    const image = m.image;
    if (!m.tileset || image === undefined) return null;
    const [w, h] = m.place.settings.cell;
    const visual: TilemapVisual = {
      at: [m.e.at[0], m.e.at[1]],
      cell: [w * ppm, h * ppm],
      grid: m.place.settings,
      tileset: m.tileset,
      image,
      layer: entityDrawLayer(ctx, m.e, "terrain"),
    };
    if (m.e.tint !== undefined) visual.tint = m.e.tint;
    if (m.e.alpha !== undefined) visual.alpha = m.e.alpha;
    return visual;
  }

  function drawMap(m: LiveMap, dirty: readonly ChunkKey[] | null): void {
    const view = ctx.view;
    if (!view?.tilemap) return;
    const visual = visualOf(m);
    if (!visual) return view.removeTilemap?.(m.e.id);
    if (dirty === null) {
      view.tilemap(m.e.id, visual);
      if (m.e.z !== undefined) view.depth?.(m.e.id, m.e.z);
      view.pose(m.e.id, m.delta.x, m.delta.y, m.delta.rot, true);
    }
    const keys = dirty ?? Object.keys(m.cells).sort(compareChunkKeys);
    if (keys.length > 0) view.tileChunks?.(m.e.id, m.cells, keys);
  }

  function open(e: TilemapEntity): LiveMap {
    const tileset = resolveTileset(e);
    const defs = new Map((tileset?.tiles ?? []).map((t) => [t.id, t] as const));
    const fallback: [number, number] = tileset
      ? [tileset.tile[0] / ppm, tileset.tile[1] / ppm]
      : [1, 1];
    const drawn: Pose = { x: e.at[0], y: e.at[1], rot: turnRadians(e.transform?.rot ?? 0) };
    const now = ctx.poses.get(e.id);
    const delta =
      now && (now.x !== drawn.x || now.y !== drawn.y || now.rot !== drawn.rot)
        ? framePose(now, drawn)
        : IDENTITY;
    return {
      e,
      tileset,
      image: imageOf(tileset),
      defs,
      place: tilePlacement(ctx.settings.grid, e.at, fallback),
      drawn,
      delta,
      body: null,
      chunks: new Map(),
      cells: e.cells,
      writes: new Map(),
      dirty: new Set(),
    };
  }

  /** Lays `m.writes` over `base` as its cells, dropping writes the scene's cells now hold. */
  function layWrites(m: LiveMap, base: GridCells): void {
    for (const [key, value] of m.writes) {
      const [col, row] = parseMapCellKey(key);
      if (readCell(base, col, row) === value) m.writes.delete(key);
    }
    m.cells = m.writes.size === 0 ? base : paintGrid(base, { cells: sortedWrites(m.writes) }).grid;
  }

  const watchers = new Set<(id: string, chunks: readonly ChunkKey[]) => void>();

  /** Rebuilds the colliders and drawing of `keys` from the map's cells now. */
  function rebuildChunks(m: LiveMap, keys: readonly ChunkKey[], draw = true): void {
    if (keys.length === 0) return;
    if (ctx.physics || ctx.geometry) {
      const some = Object.fromEntries(keys.flatMap((k) => (m.cells[k] ? [[k, m.cells[k]]] : [])));
      const decoded = new Map(decodeChunks(some).map((c) => [c.key, c] as const));
      for (const key of keys) {
        dropChunk(m, key);
        const chunk = decoded.get(key);
        if (chunk) buildChunk(m, chunk);
      }
    }
    if (draw) drawMap(m, keys);
    for (const fn of watchers) fn(m.e.id, keys);
  }

  /** The chunks whose cells changed from `prev`, plus those painted and not yet flushed. */
  function changedSince(m: LiveMap, prev: GridCells): ChunkKey[] {
    const keys = new Set([...dirtyChunks(prev, m.cells), ...m.dirty]);
    m.dirty.clear();
    return [...keys].sort(compareChunkKeys);
  }

  function spawn(e: TilemapEntity, carried?: Map<string, number>): void {
    const was = live.get(e.id);
    if (was) remove(was);
    const m = open(e);
    if (carried && carried.size > 0) {
      m.writes = carried;
      layWrites(m, e.cells);
    }
    if (ctx.physics || ctx.geometry)
      for (const chunk of decodeChunks(m.cells)) buildChunk(m, chunk);
    live.set(e.id, m);
    drawMap(m, null);
    if (!was) return;
    const keys = [...new Set([...Object.keys(was.cells), ...Object.keys(m.cells)])];
    if (keys.length > 0) for (const fn of watchers) fn(e.id, keys.sort(compareChunkKeys));
  }

  /** Whether the tileset a map would load now differs from the one it was built with. */
  function tilesetMoved(m: LiveMap, tileset: TilesetFile | undefined): boolean {
    return imageOf(tileset) !== m.image || !sameTileset(tileset, m.tileset);
  }

  /** A grid cell's map-local cell. */
  const local = (m: LiveMap, [col, row]: Cell): Cell => [
    col - m.place.offset[0],
    row - m.place.offset[1],
  ];

  function paint(
    map: string,
    edits: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] },
  ): void {
    const m = live.get(map);
    if (!m) return;
    const [ox, oy] = m.place.offset;
    const shifted = {
      cells: (edits.cells ?? []).map(([c, r, v]): CellEdit => [c - ox, r - oy, v]),
      rects: (edits.rects ?? []).map(
        ([c0, r0, c1, r1, v]): CellRect => [c0 - ox, r0 - oy, c1 - ox, r1 - oy, v],
      ),
    };
    const painted = paintGrid(m.cells, shifted);
    if (painted.rows.length === 0) return;
    if (m.tileset) resolveTileset(m.e, paintGrid({}, shifted).grid);
    for (const [col, row] of painted.inverse) {
      const value = readCell(painted.grid, col, row);
      if (readCell(m.e.cells, col, row) === value) m.writes.delete(mapCellKey(col, row));
      else m.writes.set(mapCellKey(col, row), value);
    }
    m.cells = painted.grid;
    for (const { chunk } of painted.rows) m.dirty.add(chunk);
  }

  function tileAt(m: LiveMap, value: number): TileAt | null {
    const tile = decodeCell(value);
    return tile ? { map: m.e.id, value, tile, def: m.defs.get(tile.id) } : null;
  }

  function remove(m: LiveMap): void {
    dropAll(m);
    live.delete(m.e.id);
    ctx.view?.removeTilemap?.(m.e.id);
  }

  /** Whether an edit from `prev` to `e` leaves everything but the cells as they were. */
  const cellsOnly = (prev: TilemapEntity, e: TilemapEntity) =>
    prev.tileset === e.tileset &&
    prev.collision === e.collision &&
    prev.at[0] === e.at[0] &&
    prev.at[1] === e.at[1] &&
    (prev.transform?.rot ?? 0) === (e.transform?.rot ?? 0) &&
    (prev.transform?.flip ?? false) === (e.transform?.flip ?? false);

  const drawnAlike = (prev: TilemapEntity, e: TilemapEntity) =>
    prev.tint === e.tint && prev.alpha === e.alpha && prev.layer === e.layer && prev.z === e.z;

  function setPose(id: string, x: number, y: number, rot: number): void {
    const m = live.get(id);
    if (!m) return;
    ctx.poses.set(id, x, y, rot);
    const delta = framePose({ x, y, rot }, m.drawn);
    m.delta = delta.x === 0 && delta.y === 0 && delta.rot === 0 ? IDENTITY : delta;
    if (m.body && ctx.physics) {
      const { rapier, physics } = physicsOf(ctx, m.e.type, id);
      m.body.setTranslation(new rapier.Vector2(m.delta.x, m.delta.y), true);
      m.body.setRotation(m.delta.rot, true);
      physics.moved(m.body);
    } else if (ctx.geometry) {
      for (const built of m.chunks.values())
        for (const b of built) {
          const shape = m.delta === IDENTITY ? b.part.shape : shapeAtPose(b.part.shape, m.delta);
          ctx.geometry.remove(b.handle);
          ctx.tags.delete(b.handle);
          const handle = addGeometryCollider(ctx, shape, { body: "static" }, b.part.tag);
          forgetPass(b.handle);
          if (handle !== null) b.handle = handle;
        }
    }
    ctx.view?.pose(id, m.delta.x, m.delta.y, m.delta.rot);
  }

  return {
    tilemapSystem: true,
    spawn,
    update(e, prev) {
      const m = live.get(e.id);
      if (!m || !cellsOnly(prev, e)) return spawn(e, m?.writes);
      if (tilesetMoved(m, resolveTileset(e))) return spawn(e, m.writes);
      m.e = e;
      const was = m.cells;
      layWrites(m, e.cells);
      const dirty = changedSince(m, was);
      const redraw = !drawnAlike(prev, e);
      rebuildChunks(m, dirty, !redraw);
      if (redraw) drawMap(m, null);
    },
    despawn(id) {
      const m = live.get(id);
      if (m) remove(m);
    },
    clear() {
      for (const m of [...live.values()]) remove(m);
      for (const [actor, mine] of passed) {
        const all = oneWayPasses(ctx, actor) as Set<number>;
        for (const h of mine) all.delete(h);
      }
      passed.clear();
    },
    size: () => live.size,
    list: () => [...live.values()].map((m) => m.e),
    setPose,
    passesOneWay(actorId, actor, passing) {
      const all = oneWayPasses(ctx, actorId) as Set<number>;
      let mine = passed.get(actorId);
      if (!mine) passed.set(actorId, (mine = new Set()));
      for (const h of mine) all.delete(h);
      mine.clear();
      for (const m of live.values())
        for (const built of m.chunks.values())
          for (const b of built) {
            const side = b.part.side;
            if (!side) continue;
            const box = aabb(
              m.delta === IDENTITY ? b.part.shape : shapeAtPose(b.part.shape, m.delta),
            );
            if ((passing && side === "up") || !onOneWaySide(side, box, actor)) {
              mine.add(b.handle);
              all.add(b.handle);
            }
          }
    },
    chunkColliders(id) {
      const out = new Map<ChunkKey, number>();
      for (const [key, built] of live.get(id)?.chunks ?? []) out.set(key, built.length);
      return out;
    },
    cells: (id) => live.get(id)?.cells,
    watchCells(fn) {
      watchers.add(fn);
      return () => void watchers.delete(fn);
    },
    at(cell) {
      const found: { at: TileAt; z: number; order: number }[] = [];
      let order = 0;
      for (const m of live.values()) {
        const [col, row] = local(m, cell);
        const at = tileAt(m, readCell(m.cells, col, row));
        if (at) found.push({ at, z: m.e.z ?? 0, order });
        order++;
      }
      if (found.length === 0) return NO_TILES;
      return found.sort((a, b) => b.z - a.z || b.order - a.order).map((f) => f.at);
    },
    get(map, cell) {
      const m = live.get(map);
      if (!m) return 0;
      const [col, row] = local(m, cell);
      return readCell(m.cells, col, row);
    },
    paint,
    autotile(map, ruleId, rect) {
      const m = live.get(map);
      if (!m?.tileset) return;
      const rule = m.tileset.rules?.find((r) => r.id === ruleId);
      if (!rule) throw new RangeError(`tileset of "${map}" has no autotile rule "${ruleId}"`);
      const [ox, oy] = m.place.offset;
      const bounds = { c0: rect.c0 - ox, r0: rect.r0 - oy, c1: rect.c1 - ox, r1: rect.r1 - oy };
      const edits = applyAutotile(m.cells, m.tileset, rule, bounds);
      if (edits.length > 0)
        paint(map, { cells: edits.map(([c, r, v]): CellEdit => [c + ox, r + oy, v]) });
    },
    find(map, tag) {
      const m = live.get(map);
      if (!m) return NO_CELLS;
      const ids = new Set<number>();
      for (const def of m.defs.values()) if (def.tags?.includes(tag)) ids.add(def.id);
      if (ids.size === 0) return NO_CELLS;
      const out: Cell[] = [];
      for (const chunk of decodeChunks(m.cells))
        for (let i = 0; i < chunk.values.length; i++) {
          const tile = decodeCell(chunk.values[i] ?? 0);
          if (!tile || !ids.has(tile.id)) continue;
          out.push([
            chunk.cx * GRID_CHUNK + (i % GRID_CHUNK) + m.place.offset[0],
            chunk.cy * GRID_CHUNK + Math.floor(i / GRID_CHUNK) + m.place.offset[1],
          ]);
        }
      return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    },
    reloadAssets(changed) {
      const named = new Set(changed);
      const failed: { entityId: string; error: unknown; reattached: boolean }[] = [];
      let rebuilt = false;
      for (const m of [...live.values()]) {
        let tileset: TilesetFile | undefined;
        try {
          tileset = resolveTileset(m.e);
        } catch (error) {
          failed.push({ entityId: m.e.id, error, reattached: false });
          continue;
        }
        if (!named.has(m.e.tileset) && !tilesetMoved(m, tileset)) continue;
        spawn(m.e, m.writes);
        rebuilt = true;
      }
      if (rebuilt) ctx.physics?.refreshQueries();
      return failed;
    },
    flushWrites() {
      let rebuilt = false;
      for (const m of live.values()) {
        if (m.dirty.size === 0) continue;
        const keys = [...m.dirty].sort(compareChunkKeys);
        m.dirty.clear();
        rebuildChunks(m, keys);
        rebuilt = true;
      }
      if (rebuilt) ctx.physics?.refreshQueries();
      return rebuilt;
    },
    save(id) {
      const m = live.get(id);
      return m && m.writes.size > 0 ? sortedWrites(m.writes) : undefined;
    },
    restore(id, state) {
      const m = live.get(id);
      if (!m || !Array.isArray(state)) return;
      const was = m.cells;
      m.writes = new Map(state.filter(isWrite).map(([c, r, v]) => [mapCellKey(c, r), v] as const));
      layWrites(m, m.e.cells);
      rebuildChunks(m, changedSince(m, was));
      ctx.physics?.refreshQueries();
    },
    inspect(id) {
      const m = live.get(id);
      if (!m) return undefined;
      const writes = sortedWrites(m.writes);
      let colliders = 0;
      for (const built of m.chunks.values()) colliders += built.length;
      return {
        dirty: [...m.dirty].sort(compareChunkKeys),
        colliders,
        writeCount: writes.length,
        writes: writes.slice(0, INSPECT_WRITES),
      };
    },
  };
}

/** `ctx.tiles`: the tilemap system's reads and writes, or empty answers while none is registered. */
export function tilesContext(ctx: Pick<EngineContext, "system">): TilesContext {
  const system = () => {
    const s = ctx.system("tilemap");
    return isTilemapSystem(s) ? s : undefined;
  };
  return {
    at: (cell: Cell) => system()?.at(cell) ?? NO_TILES,
    get: (map: string, cell: Cell) => system()?.get(map, cell) ?? 0,
    paint: (map: string, edits: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] }) =>
      system()?.paint(map, edits),
    autotile: (map: string, rule: string, rect: CellBounds) => system()?.autotile(map, rule, rect),
    find: (map: string, tag: string) => system()?.find(map, tag) ?? NO_CELLS,
  };
}
