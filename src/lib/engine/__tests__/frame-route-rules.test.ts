import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { addRoute, createRouter, findAllRoutes } from "rou3";
import { describe, expect, it } from "vite-plus/test";

import { frameRouteRules } from "../frame-route-rules";

type Rule = { headers: Record<string, string> };

const DOCUMENTS: Record<string, Rule> = {
  "/**": { headers: { "cache-control": "private, no-cache" } },
};

/** The headers Nitro applies to `path`: every matching rule, least specific first, later ones winning. */
function headersFor(rules: Record<string, Rule>, path: string): Record<string, string> {
  const router = createRouter<Rule>();
  for (const [pattern, rule] of Object.entries(rules)) addRoute(router, undefined, pattern, rule);
  return Object.assign({}, ...findAllRoutes(router, undefined, path).map((m) => m.data.headers));
}

describe("frame route rules", () => {
  it("are the four hosted-game entries", () => {
    expect(frameRouteRules).toEqual({
      "/frames/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
      "/frames-private/**": { headers: { "cache-control": "private, max-age=3600" } },
      "/games/*/play/**": { headers: { "content-security-policy": "frame-ancestors 'self'" } },
      "/games/*/embed/**": { headers: { "content-security-policy": "frame-ancestors *" } },
    });
  });

  it("aren't overridden by the documents' catch-all", () => {
    const rules = { ...DOCUMENTS, ...frameRouteRules };
    const release = "d".repeat(64);
    expect(headersFor(rules, `/frames/${release}/index.html`)["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(headersFor(rules, `/frames/${release}/assets/game.wasm`)["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(headersFor(rules, `/frames-private/${release}/tok/index.html`)["cache-control"]).toBe(
      "private, max-age=3600",
    );
    expect(headersFor(rules, "/games/p1/play/latest")).toEqual({
      "cache-control": "private, no-cache",
      "content-security-policy": "frame-ancestors 'self'",
    });
    expect(headersFor(rules, "/games/p1/embed/3")).toEqual({
      "cache-control": "private, no-cache",
      "content-security-policy": "frame-ancestors *",
    });
    expect(headersFor(rules, "/games/p1")).toEqual({ "cache-control": "private, no-cache" });
  });

  it("are spread into the site's table after the catch-all", () => {
    const config = readFileSync(
      fileURLToPath(new URL("../../../../vite.config.ts", import.meta.url)),
      "utf8",
    );
    const catchAll = config.indexOf('"/**":');
    const spread = config.indexOf("...frameRouteRules");
    expect(catchAll).toBeGreaterThan(-1);
    expect(spread).toBeGreaterThan(catchAll);
  });
});
