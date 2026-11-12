import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { addRoute, createRouter, findAllRoutes } from "rou3";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { playHostOnlyFrames, startInstance } from "@/start";

import { frameRouteRules, playHost, playHostRefusal } from "../frame-route-rules";
import {
  builtRouteHeaders,
  frameRouteOutputFailures,
  SAMPLE_PATHS,
} from "./frame-route-output-check";

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

/** A server bundle with a `findRouteRules` in the shape Nitro compiles route rules to. */
function nitroBundle(rules: Record<string, Rule>): string {
  const layers = Object.entries(rules).map(([route, rule]) => ({
    test: `^${route.replaceAll("**", "\u0000").replaceAll("*", "[^/]+").replaceAll("\u0000", ".*")}$`,
    data: [{ name: "headers", route, options: rule.headers }],
  }));
  return [
    "import x from 'y';",
    "var findRouteRules = /* @__PURE__ */ (() => {",
    `\tconst layers = ${JSON.stringify(layers)};`,
    "\treturn (m, p) => layers.filter((l) => new RegExp(l.test).test(p)).map((l) => ({ data: l.data.map((d) => ({ ...d, handler: headers })) }));",
    "})();",
    "export { findRouteRules };",
  ].join("\n");
}

describe("the built route rules check", () => {
  it("passes a build that carries every hosted-game rule", () => {
    const headersFor = builtRouteHeaders(nitroBundle({ ...DOCUMENTS, ...frameRouteRules }));
    expect(headersFor(SAMPLE_PATHS["/frames/**"])).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
    expect(frameRouteOutputFailures(headersFor)).toEqual([]);
  });

  it("names each header a build without the rules leaves out", () => {
    const failures = frameRouteOutputFailures(builtRouteHeaders(nitroBundle(DOCUMENTS)));
    expect(failures).toHaveLength(4);
    expect(failures[0]).toContain('cache-control is "private, no-cache"');
  });

  it("refuses a bundle with no compiled matcher", () => {
    expect(() => builtRouteHeaders("export {};")).toThrow(/findRouteRules/);
  });
});

describe("the play host", () => {
  const PLAY = "https://play.example.test";
  const RELEASE = "e".repeat(64);
  const on = (path: string, origin = PLAY, method = "GET") =>
    playHostRefusal(new Request(`${origin}${path}`, { method }), playHost(PLAY));

  afterEach(() => vi.unstubAllEnvs());

  it("is ENGINE_PLAY_ORIGIN's host, or none", () => {
    expect(playHost(" https://Play.Example.test:8443/ ")).toBe("play.example.test:8443");
    expect(playHost("")).toBeNull();
    expect(playHost(null)).toBeNull();
    expect(playHost("not a url")).toBeNull();
    vi.stubEnv("ENGINE_PLAY_ORIGIN", PLAY);
    expect(playHost()).toBe("play.example.test");
    vi.stubEnv("ENGINE_PLAY_ORIGIN", "");
    expect(playHost()).toBeNull();
  });

  it("is none when it names the site's own host, so the site never answers itself 404", () => {
    expect(playHost("https://jams.example.test/", "https://Jams.example.test")).toBeNull();
    expect(playHost(PLAY, "https://jams.example.test")).toBe("play.example.test");
    vi.stubEnv("ENGINE_PLAY_ORIGIN", "https://jams.example.test");
    vi.stubEnv("VITE_SITE_ORIGIN", "https://jams.example.test");
    expect(playHost()).toBeNull();
    expect(playHostRefusal(new Request("https://jams.example.test/games/x"))).toBeNull();
  });

  it("answers 404, uncached, for every route but the frames", async () => {
    for (const path of ["/", "/api/rpc/listJams", "/games/x", "/games/x/play/1", "/framesx/a"]) {
      const res = on(path);
      expect(res?.status, path).toBe(404);
      expect(res?.headers.get("cache-control")).toBe("no-store");
      expect(await res?.text()).toBe("Not Found");
    }
    expect(on("/", PLAY, "HEAD")?.body).toBeNull();
  });

  it("lets the frames through, and every route on another host", () => {
    expect(on(`/frames/${RELEASE}/index.html`)).toBeNull();
    expect(on(`/frames-private/${RELEASE}/tok/index.html`)).toBeNull();
    expect(on("/", "https://site.example.test")).toBeNull();
    expect(playHostRefusal(new Request(`${PLAY}/`), null)).toBeNull();
  });

  it("is the server's request middleware", async () => {
    const options = await startInstance.getOptions();
    expect(options.requestMiddleware?.[0]).toBe(playHostOnlyFrames);
    const server = playHostOnlyFrames.options.server;
    if (!server) throw new Error("the middleware has no server half");
    vi.stubEnv("ENGINE_PLAY_ORIGIN", PLAY);
    const next = vi.fn(async () => ({ response: new Response("site") }));
    const run = (url: string) =>
      server({
        request: new Request(url),
        pathname: new URL(url).pathname,
        context: {},
        next,
      } as never);
    const refused = (await run(`${PLAY}/games/x`)) as Response;
    expect(refused.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
    await run(`${PLAY}/frames/${RELEASE}/index.html`);
    await run("https://site.example.test/games/x");
    expect(next).toHaveBeenCalledTimes(2);
  });
});
