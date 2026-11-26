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

/** The layers on: every layer but those stored as turned off under key in this browser. */
export function readLayers(store: Pick<Storage, "getItem"> | undefined, key: string): Set<LayerId> {
  const on = new Set<LayerId>(DEFAULT_LAYERS);
  try {
    const off: unknown = JSON.parse(store?.getItem(key) ?? "[]");
    if (Array.isArray(off)) for (const id of off) if (isLayer(String(id))) on.delete(id);
  } catch {
    // Unreadable storage leaves every layer on.
  }
  return on;
}

export function writeLayers(
  store: Pick<Storage, "setItem"> | undefined,
  key: string,
  on: ReadonlySet<LayerId>,
): void {
  try {
    store?.setItem(key, JSON.stringify(LAYERS.filter((l) => !on.has(l))));
  } catch {
    // Private browsing keeps the toggles for this visit only.
  }
}

export function browserStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A stable key for a set of layers, for caching what was drawn under it. */
export function layersKey(layers: ReadonlySet<LayerId>): string {
  return LAYERS.filter((l) => layers.has(l)).join(",");
}
