// The layers a viewer can toggle (GDD 4.11). Base layers ride on the shared
// payloads; live layers on the viewer's overlay.

export const LAYERS = [
  "terrain",
  "regions",
  "roads",
  "places",
  "threat",
  "corruption",
  "weather",
  "troubles",
  "busy",
  "self",
] as const;

export type LayerId = (typeof LAYERS)[number];

export const LIVE_LAYERS: readonly LayerId[] = [
  "threat",
  "corruption",
  "weather",
  "troubles",
  "busy",
  "self",
];

export const DEFAULT_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(LAYERS);

export function isLayer(id: string): id is LayerId {
  return (LAYERS as readonly string[]).includes(id);
}

/** A stable key for a set of layers, for caching what was drawn under it. */
export function layersKey(layers: ReadonlySet<LayerId>): string {
  return LAYERS.filter((l) => layers.has(l)).join(",");
}
