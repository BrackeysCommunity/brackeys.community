import {
  type MapChunkRef,
  type MapIndex,
  MapOverlayMaxChunks,
  type MapOverlayQuery,
} from "../../mmo-api/src/index.ts";
import { type Camera, type Level, type View, viewBounds } from "./camera.ts";
import { hexCentre } from "./hex.ts";

/** The most chunks an overlay request names. */
export const MAX_OVERLAY_CHUNKS = MapOverlayMaxChunks;

/** A chunk's id on the wire: "a.b". */
export function chunkId(c: { a: number; b: number }): string {
  return `${c.a}.${c.b}`;
}

/** An overlay query on the wire: scope=sight, or the chunks by id. */
export function overlayQueryString(q: MapOverlayQuery): string {
  return q.sight ? "scope=sight" : `chunks=${(q.chunks ?? []).map(chunkId).join(",")}`;
}

/** Where a fetched chunk payload is kept: by level, chunk and rev. */
export function chunkKey(c: { a: number; b: number }, level: Level, rev: string): string {
  return `${level}/${chunkId(c)}/${rev}`;
}

/** The rev of a chunk's payload at a level; region has none. */
export function chunkRev(ref: MapChunkRef, level: Level): string {
  return level === "tile" ? ref.tile : ref.area;
}

/**
 * The chunks a view touches, nearest its centre first, at most max. A chunk
 * is every tile within chunkRadius of its centre, so it lies inside a
 * circle of √3·radius + 1 world px at size 1. Order: dx·dx + dy·dy from the
 * camera to hexCentre(centre, 1), then a, then b; a port must keep it.
 */
export function chunksInView(
  index: MapIndex,
  c: Camera,
  view: View,
  max = MAX_OVERLAY_CHUNKS,
): MapChunkRef[] {
  const b = viewBounds(c, view);
  const reach = Math.sqrt(3) * index.chunkRadius + 1;
  const hits: { ref: MapChunkRef; d: number }[] = [];
  for (const ref of index.chunks) {
    const p = hexCentre(ref.centre, 1);
    const nx = Math.min(Math.max(p.x, b.left), b.right);
    const ny = Math.min(Math.max(p.y, b.top), b.bottom);
    const ox = p.x - nx;
    const oy = p.y - ny;
    if (ox * ox + oy * oy > reach * reach) continue;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    hits.push({ ref, d: dx * dx + dy * dy });
  }
  hits.sort((x, y) => x.d - y.d || x.ref.a - y.ref.a || x.ref.b - y.ref.b);
  return hits.slice(0, Math.max(0, max)).map((h) => h.ref);
}
