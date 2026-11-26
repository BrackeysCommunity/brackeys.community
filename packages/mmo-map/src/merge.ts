import type { MapCell, MapLive, MapOverlay, MapTileView } from "../../mmo-api/src/index.ts";
import { hexKey } from "./hex.ts";

/** A tile as the viewer may see it: the same as Go's mapview.Merge. */
export function mergeTile(cell: MapCell, live: MapLive | undefined): MapTileView {
  if (!live) return { cell, fog: "discovered" };
  return { cell, fog: live.fog, live };
}

export function liveByHex(o: MapOverlay): Map<string, MapLive> {
  const out = new Map<string, MapLive>();
  for (const t of o.tiles) out.set(hexKey(t), t);
  return out;
}

/** Whole world days since a tile left sight. */
export function ageDays(tick: number, left: number, ticksPerDay: number): number {
  if (ticksPerDay <= 0 || tick <= left) return 0;
  return Math.floor((tick - left) / ticksPerDay);
}
