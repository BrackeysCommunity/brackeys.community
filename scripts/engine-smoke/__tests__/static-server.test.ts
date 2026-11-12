// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  contentType,
  DEFAULT_MIME,
  normalizeMount,
  resolveRequestPath,
  serveStatic,
  type StaticServer,
} from "../static-server";

let dir: string;
const servers: StaticServer[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "static-server-test-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "empty"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(dir, "release.json"), '{"v":1}');
  writeFileSync(join(dir, "assets", "game-abc.js"), "export {};");
  writeFileSync(join(dir, "assets", "rapier.wasm"), Buffer.from([0, 0x61, 0x73, 0x6d]));
  writeFileSync(join(dir, "app.webmanifest"), "{}");
  writeFileSync(join(dir, "blob"), "raw");
  writeFileSync(join(dir, "big.js"), "x".repeat(64 * 1024));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(mount?: string): Promise<StaticServer> {
  const server = await serveStatic({ dir, ...(mount ? { mount } : {}) });
  servers.push(server);
  return server;
}

type Raw = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

/** A request with the path sent exactly as written, which `fetch` would normalize. */
function raw(
  server: StaticServer,
  path: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<Raw> {
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: server.port,
        path,
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          done({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.once("error", fail);
    req.end();
  });
}

describe("contentType", () => {
  it("names the types a build ships, wasm included", () => {
    expect(contentType("index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("assets/game-abc.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("x.mjs")).toBe("text/javascript; charset=utf-8");
    expect(contentType("style.css")).toBe("text/css; charset=utf-8");
    expect(contentType("release.json")).toBe("application/json; charset=utf-8");
    expect(contentType("app.webmanifest")).toBe("application/manifest+json; charset=utf-8");
    expect(contentType("rapier_wasm2d_bg.wasm")).toBe("application/wasm");
    expect(contentType("icons/icon-192.png")).toBe("image/png");
    expect(contentType("a.JPG")).toBe("image/jpeg");
    expect(contentType("a.webp")).toBe("image/webp");
    expect(contentType("a.svg")).toBe("image/svg+xml");
    expect(contentType("a.ogg")).toBe("audio/ogg");
    expect(contentType("a.woff2")).toBe("font/woff2");
  });

  it("serves anything else as bytes", () => {
    expect(contentType("blob")).toBe(DEFAULT_MIME);
    expect(contentType("a.unknown")).toBe(DEFAULT_MIME);
  });
});

describe("normalizeMount", () => {
  it("keeps one leading and one trailing slash", () => {
    expect(normalizeMount("/")).toBe("/");
    expect(normalizeMount("")).toBe("/");
    expect(normalizeMount("games/t")).toBe("/games/t/");
    expect(normalizeMount("/games/t/")).toBe("/games/t/");
    expect(normalizeMount("//games/t//")).toBe("/games/t/");
  });
});

describe("resolveRequestPath", () => {
  it("maps paths under the mount to files, and a directory URL to its index.html", () => {
    expect(resolveRequestPath(dir, "/", "/")).toBe(join(dir, "index.html"));
    expect(resolveRequestPath(dir, "/", "/release.json?v=2#x")).toBe(join(dir, "release.json"));
    expect(resolveRequestPath(dir, "/", "/assets/")).toBe(join(dir, "assets", "index.html"));
    expect(resolveRequestPath(dir, "/games/t/", "/games/t/")).toBe(join(dir, "index.html"));
    expect(resolveRequestPath(dir, "/games/t/", "/games/t/assets/game-abc.js")).toBe(
      join(dir, "assets", "game-abc.js"),
    );
    expect(resolveRequestPath(dir, "/", "/a%20b.png")).toBe(join(dir, "a b.png"));
  });

  it("names no file outside the mount or the directory", () => {
    expect(resolveRequestPath(dir, "/games/t/", "/")).toBeNull();
    expect(resolveRequestPath(dir, "/games/t/", "/games/t")).toBeNull();
    expect(resolveRequestPath(dir, "/games/t/", "/release.json")).toBeNull();
    expect(resolveRequestPath(dir, "/", "/../etc/passwd")).toBeNull();
    expect(resolveRequestPath(dir, "/", "/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveRequestPath(dir, "/", "/assets%2fgame-abc.js")).toBeNull();
    expect(resolveRequestPath(dir, "/", "/assets/./game-abc.js")).toBeNull();
    expect(resolveRequestPath(dir, "/", "//release.json")).toBeNull();
    expect(resolveRequestPath(dir, "/", "/%E0%A4%A")).toBeNull();
    expect(resolveRequestPath(dir, "/", "/a%00b")).toBeNull();
  });
});

describe("serveStatic", () => {
  it("listens on a random local port and serves files with their types, uncompressed and uncached", async () => {
    const server = await serve();
    expect(server.port).toBeGreaterThan(0);
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.url).toBe(`${server.origin}/`);

    const page = await raw(server, "/", { headers: { "Accept-Encoding": "gzip, br" } });
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["content-encoding"]).toBeUndefined();
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body).toContain("<title>t</title>");

    const wasm = await raw(server, "/assets/rapier.wasm");
    expect(wasm.status).toBe(200);
    expect(wasm.headers["content-type"]).toBe("application/wasm");
    expect(wasm.headers["content-length"]).toBe("4");

    const big = await raw(server, "/big.js", { headers: { "Accept-Encoding": "gzip" } });
    expect(big.headers["content-encoding"]).toBeUndefined();
    expect(big.body).toHaveLength(64 * 1024);

    expect((await raw(server, "/app.webmanifest")).headers["content-type"]).toBe(
      "application/manifest+json; charset=utf-8",
    );
    expect((await raw(server, "/blob")).headers["content-type"]).toBe(DEFAULT_MIME);
  });

  it("has no fallback: an unknown path, a directory without a slash or an index, and a traversal are 404s", async () => {
    const server = await serve();
    for (const path of [
      "/missing.js",
      "/some/route",
      "/assets",
      "/assets/",
      "/empty/",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/../index.html",
    ]) {
      const res = await raw(server, path);
      expect(res.status, path).toBe(404);
      expect(res.headers["content-type"], path).toBe("text/plain; charset=utf-8");
      expect(res.body, path).not.toContain("<title>");
    }
  });

  it("serves a nested mount and nothing outside it", async () => {
    const server = await serve("games/t");
    expect(server.mount).toBe("/games/t/");
    expect(server.url).toBe(`${server.origin}/games/t/`);
    expect((await raw(server, "/games/t/")).status).toBe(200);
    expect((await raw(server, "/games/t/release.json")).body).toBe('{"v":1}');
    expect((await raw(server, "/")).status).toBe(404);
    expect((await raw(server, "/release.json")).status).toBe(404);
    expect((await raw(server, "/games/t")).status).toBe(404);
    expect((await raw(server, "/games/release.json")).status).toBe(404);
  });

  it("answers HEAD without a body and refuses other methods", async () => {
    const server = await serve();
    const head = await raw(server, "/release.json", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(head.headers["content-length"]).toBe("7");
    expect(head.body).toBe("");

    const post = await raw(server, "/release.json", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });

  it("logs every request with its status", async () => {
    const server = await serve();
    await raw(server, "/");
    await raw(server, "/nope");
    expect(server.served).toEqual([
      { method: "GET", path: "/", status: 200 },
      { method: "GET", path: "/nope", status: 404 },
    ]);
  });

  it("closes with a keep-alive connection still open, and closing twice is one close", async () => {
    const server = await serve();
    const res = await fetch(server.url);
    await res.text();
    const first = server.close();
    expect(server.close()).toBe(first);
    await first;
    await expect(fetch(server.url)).rejects.toThrow();
    servers.splice(servers.indexOf(server), 1);
  });
});
