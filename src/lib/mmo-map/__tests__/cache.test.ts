import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { MAP_EDGE, mapCacheRouteRules, noStoreHeaders } from "../cache";

const rules = mapCacheRouteRules();

describe("mapCacheRouteRules", () => {
  it("keys the index by tick and the payloads by content", () => {
    expect(rules).toEqual({
      "/api/public/mmo/map/tick": {
        headers: { "cache-control": "public, max-age=0, s-maxage=30" },
      },
      "/api/public/mmo/map/focus": {
        headers: { "cache-control": "public, max-age=0, s-maxage=30" },
      },
      "/api/public/mmo/map/style/**": {
        headers: { "cache-control": "public, max-age=0, s-maxage=31536000" },
      },
      "/api/public/mmo/map/regions/**": {
        headers: { "cache-control": "public, max-age=0, s-maxage=31536000" },
      },
      "/api/public/mmo/map/chunk/**": {
        headers: { "cache-control": "public, max-age=0, s-maxage=31536000" },
      },
      "/api/mmo/map/overlay": { headers: { "cache-control": "private, no-store" } },
    });
  });

  it("never lets a browser pin a shared payload", () => {
    for (const [path, rule] of Object.entries(rules)) {
      if (!path.startsWith("/api/public/")) continue;
      expect(rule.headers["cache-control"]).toMatch(/^public, max-age=0, s-maxage=\d+$/);
    }
  });

  it("keeps the overlay out of the shared tier", () => {
    const shared = Object.keys(rules).filter((path) => path.includes("overlay"));
    expect(shared).toEqual(["/api/mmo/map/overlay"]);
    expect(rules["/api/mmo/map/overlay"].headers["cache-control"]).toBe(MAP_EDGE.overlay);
  });

  it("refuses storage to both the browser and the edge", () => {
    expect(noStoreHeaders()).toEqual({
      "cache-control": "no-store",
      "cdn-cache-control": "no-store",
    });
  });
});

describe("vite.config.ts", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../../vite.config.ts", import.meta.url)),
    "utf8",
  );

  it("spreads the map's rules after the public tier's", () => {
    const publicAt = source.indexOf("...publicCacheRouteRules(),");
    const mapAt = source.indexOf("...mapCacheRouteRules(),");
    expect(publicAt).toBeGreaterThan(-1);
    expect(mapAt).toBeGreaterThan(publicAt);
    expect(source.indexOf('"/api/public/**"')).toBeLessThan(mapAt);
  });
});
