// Imported by vite.config.ts, so it imports nothing.

/**
 * The live map's cache split. The index changes with the tick; style, regions
 * and chunks sit at content-addressed URLs, so the edge may keep them for good;
 * the overlay is one viewer's and is never stored anywhere.
 */
export const MAP_EDGE = {
  tick: "public, max-age=0, s-maxage=30",
  content: "public, max-age=0, s-maxage=31536000",
  overlay: "private, no-store",
  none: "no-store",
} as const;

/**
 * Nitro route rules for the map's routes. A rule overrides the handler's own
 * `cache-control`, so an error or a stale rev opts out of the edge through
 * `cdn-cache-control`, which no rule sets.
 */
export function mapCacheRouteRules(): Record<string, { headers: { "cache-control": string } }> {
  return {
    "/api/public/mmo/map/tick": { headers: { "cache-control": MAP_EDGE.tick } },
    "/api/public/mmo/map/focus": { headers: { "cache-control": MAP_EDGE.tick } },
    "/api/public/mmo/map/style/**": { headers: { "cache-control": MAP_EDGE.content } },
    "/api/public/mmo/map/regions/**": { headers: { "cache-control": MAP_EDGE.content } },
    "/api/public/mmo/map/chunk/**": { headers: { "cache-control": MAP_EDGE.content } },
    "/api/mmo/map/overlay": { headers: { "cache-control": MAP_EDGE.overlay } },
  };
}

/** Headers for an answer neither the browser nor the edge may keep. */
export function noStoreHeaders(): Record<string, string> {
  return { "cache-control": MAP_EDGE.none, "cdn-cache-control": MAP_EDGE.none };
}
