import { FogDiscovered } from "../../mmo-api/src/index.ts";
import type { MapCell, MapLive, MapOverlay, MapTileView } from "../../mmo-api/src/index.ts";
import { hexKey } from "./hex.ts";

/** A tile as the viewer may see it: the same as Go's mapview.Merge. */
export function mergeTile(cell: MapCell, live: MapLive | undefined): MapTileView {
  if (!live) return { cell, fog: FogDiscovered };
  return { cell, fog: live.fog, live };
}

export function liveByHex(o: MapOverlay): Map<string, MapLive> {
  const out = new Map<string, MapLive>();
  for (const t of o.tiles) out.set(hexKey(t), t);
  return out;
}
