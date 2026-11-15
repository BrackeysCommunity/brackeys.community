import { Container, Mesh, MeshGeometry, Rectangle, type Texture } from "pixi.js";

import type { TilemapVisual } from "../context";
import type { TileDef } from "../project/kinds/tileset";
import type { ChunkKey, GridCells } from "../scene/grid";
import type { Bounds } from "../scene/types";
import { decodeChunks } from "../tiles/chunks";
import { animationFrame, buildChunkMesh, tileOffset, writeTileUVs } from "../tiles/mesh";
import type { TextureSource } from "./pixi-view";

/** A view's tilemaps: one mesh per non-empty chunk, rebuilt by chunk, culled by chunk. */
export interface TilemapView {
  set(id: string, map: TilemapVisual): void;
  /** Rebuilds the named chunks' meshes from the cells. */
  chunks(id: string, cells: GridCells, dirty: readonly ChunkKey[]): void;
  remove(id: string): void;
  /**
   * Each frame: animated tiles' UVs; chunks outside every view rect skip
   * rendering. `views` are in the px space of the view's container; empty
   * culls nothing.
   */
  frame(f: { nowMs: number; views: readonly Bounds[] }): void;
  /** The container tilemap `id` draws in, which the scene view poses and layers; null before `set`. */
  display(id: string): Container | null;
  /** Chunk meshes of tilemap `id` by chunk key, for tools and tests. */
  meshes(id: string): ReadonlyMap<ChunkKey, Mesh>;
  destroy(): void;
}

type ChunkDisplay = {
  mesh: Mesh;
  geometry: MeshGeometry;
  animated: readonly { quad: number; tile: number; flags: number; shown: number }[];
};

type LiveTilemap = {
  container: Container;
  map: TilemapVisual;
  defs: Map<number, TileDef>;
  texture: Texture | null;
  cells: GridCells;
  chunks: Map<ChunkKey, ChunkDisplay>;
};

const defsOf = (map: TilemapVisual) =>
  new Map((map.tileset.tiles ?? []).map((t) => [t.id, t] as const));

/** A `[minX, minY, maxX, maxY]` box as Pixi's cull area. */
export function cullRect(b: Bounds, out: Rectangle): Rectangle {
  out.x = b[0];
  out.y = b[1];
  out.width = b[2] - b[0];
  out.height = b[3] - b[1];
  return out;
}

/**
 * Whether `display`'s `area` (its own px) lies outside every rect of
 * `views`, which are in `space`'s px; `space` is one of its ancestors.
 * Position, scale, rotation and pivot are walked up by hand, so the answer
 * needs no render pass and holds on every renderer.
 */
export function outsideViews(
  display: Container,
  area: Rectangle,
  views: readonly Bounds[],
  space: Container,
): boolean {
  if (views.length === 0) return false;
  const xs = [area.x, area.x + area.width, area.x + area.width, area.x];
  const ys = [area.y, area.y, area.y + area.height, area.y + area.height];
  for (let node: Container | null = display; node && node !== space; node = node.parent) {
    const cos = Math.cos(node.rotation);
    const sin = Math.sin(node.rotation);
    for (let k = 0; k < 4; k++) {
      const lx = (xs[k]! - node.pivot.x) * node.scale.x;
      const ly = (ys[k]! - node.pivot.y) * node.scale.y;
      xs[k] = node.position.x + lx * cos - ly * sin;
      ys[k] = node.position.y + lx * sin + ly * cos;
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return views.every((v) => maxX <= v[0] || minX >= v[2] || maxY <= v[1] || minY >= v[3]);
}

/**
 * Tilemaps drawn as one Pixi `Mesh` per non-empty chunk: quads with UVs into
 * the tileset's texture (by the image's hash in `textures`). A map whose
 * texture hasn't loaded draws once it arrives. New maps' containers start in
 * `container`; the scene view moves them to their layer.
 */
export function createTilemapView(container: Container, textures: TextureSource): TilemapView {
  const maps = new Map<string, LiveTilemap>();
  let unsubscribe: (() => void) | null = null;

  function dropChunk(m: LiveTilemap, key: ChunkKey): void {
    const c = m.chunks.get(key);
    if (!c) return;
    c.mesh.destroy();
    c.geometry.destroy();
    m.chunks.delete(key);
  }

  function rebuild(m: LiveTilemap, keys: readonly ChunkKey[]): void {
    for (const key of keys) dropChunk(m, key);
    const texture = m.texture;
    if (!texture) return;
    const subset: Record<ChunkKey, GridCells[ChunkKey]> = {};
    for (const key of keys) {
      const rows = m.cells[key];
      if (rows) subset[key] = rows;
    }
    const ppm = m.map.cell[0] / m.map.grid.cell[0];
    const input = {
      tileset: m.map.tileset,
      image: [texture.width, texture.height] as [number, number],
      grid: m.map.grid,
      pxPerMetre: ppm,
      offset: tileOffset(m.map.grid, m.map.at),
    };
    for (const chunk of decodeChunks(subset)) {
      const built = buildChunkMesh(chunk, input);
      if (!built) continue;
      const geometry = new MeshGeometry({
        positions: built.positions,
        uvs: built.uvs,
        indices: built.indices,
      });
      const mesh = new Mesh({ geometry, texture });
      mesh.label = `chunk:${chunk.key}`;
      mesh.cullable = true;
      mesh.cullArea = cullRect(built.bounds, new Rectangle());
      m.container.addChild(mesh);
      m.chunks.set(chunk.key, {
        mesh,
        geometry,
        animated: built.animated.map((a) => ({ ...a, shown: -1 })),
      });
    }
  }

  function watch(): void {
    if (unsubscribe) return;
    unsubscribe = textures.onLoad((hash) => {
      for (const m of maps.values()) {
        if (m.texture || m.map.image !== hash) continue;
        m.texture = textures.get(hash);
        if (m.texture) rebuild(m, Object.keys(m.cells));
      }
      if ([...maps.values()].every((m) => m.texture)) {
        unsubscribe?.();
        unsubscribe = null;
      }
    });
  }

  function remove(id: string): void {
    const m = maps.get(id);
    if (!m) return;
    for (const key of [...m.chunks.keys()]) dropChunk(m, key);
    m.container.destroy({ children: true });
    maps.delete(id);
  }

  function applyLook(m: LiveTilemap): void {
    m.container.tint = m.map.tint ?? 0xffffff;
    m.container.alpha = m.map.alpha ?? 1;
  }

  return {
    set(id, map) {
      const m = maps.get(id);
      if (m) {
        const placed =
          m.map.image === map.image &&
          m.map.tileset === map.tileset &&
          m.map.at[0] === map.at[0] &&
          m.map.at[1] === map.at[1] &&
          m.map.cell[0] === map.cell[0] &&
          m.map.cell[1] === map.cell[1] &&
          JSON.stringify(m.map.grid) === JSON.stringify(map.grid);
        m.map = map;
        m.defs = defsOf(map);
        applyLook(m);
        if (placed) return;
        m.texture = textures.get(map.image);
        if (!m.texture) watch();
        rebuild(m, [...new Set([...m.chunks.keys(), ...Object.keys(m.cells)])]);
        return;
      }
      const display = new Container();
      display.label = id;
      container.addChild(display);
      const live: LiveTilemap = {
        container: display,
        map,
        defs: defsOf(map),
        texture: textures.get(map.image),
        cells: {},
        chunks: new Map(),
      };
      applyLook(live);
      maps.set(id, live);
      if (!live.texture) watch();
    },
    chunks(id, cells, dirty) {
      const m = maps.get(id);
      if (!m) return;
      m.cells = cells;
      rebuild(m, dirty);
    },
    remove,
    frame({ nowMs, views }) {
      for (const m of maps.values()) {
        for (const c of m.chunks.values()) {
          c.mesh.culled = outsideViews(c.mesh, c.mesh.cullArea!, views, container);
          if (c.mesh.culled || c.animated.length === 0 || !m.texture) continue;
          const image: [number, number] = [m.texture.width, m.texture.height];
          const uvs = c.geometry.uvs as Float32Array;
          let changed = false;
          for (const a of c.animated) {
            const shown = animationFrame(m.defs.get(a.tile), nowMs);
            if (shown === null || shown === a.shown) continue;
            writeTileUVs(uvs, a.quad, shown, a.flags, m.map.tileset, image);
            a.shown = shown;
            changed = true;
          }
          if (changed) c.geometry.getBuffer("aUV").update();
        }
      }
    },
    display: (id) => maps.get(id)?.container ?? null,
    meshes: (id) => new Map([...(maps.get(id)?.chunks ?? [])].map(([k, c]) => [k, c.mesh])),
    destroy() {
      for (const id of [...maps.keys()]) remove(id);
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
