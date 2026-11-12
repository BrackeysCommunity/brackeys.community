import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  engineBlobs,
  engineProjects,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";

import {
  createFrameRoute,
  forgetProjectReleases,
  forgetRelease,
  parseFramePath,
  resolveRelease,
  type FrameRouteDeps,
} from "../../lib/engine/frame-route";
import { mintFrameToken } from "../../lib/engine/frame-token";
import { memoryReleaseStore } from "../../lib/engine/release-storage";
import { engineAssetKey, engineReleaseObjectKey } from "../../lib/engine/storage-keys";

const SITE = "http://localhost:3000";
const PLAY = "http://play.localhost:3000";
const SYNC = "wss://sync.localhost";

const PUBLIC = "a".repeat(64);
const PRIVATE = "b".repeat(64);
const TEAM = "c".repeat(64);
const HTML_HASH = "1".repeat(64);
const PNG_HASH = "2".repeat(64);
const JS_HASH = "3".repeat(64);

const html = new TextEncoder().encode("<!doctype html><title>Game</title>");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const js = new TextEncoder().encode("export const answer = 42;\n");
const pngPath = `assets/${PNG_HASH}.png`;

let db: TestDb;
let store: ReturnType<typeof memoryReleaseStore>;
let clock = new Date("2026-11-12T12:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
  vi.stubEnv("ENGINE_FRAME_SECRET", "a-frame-secret-for-tests");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const release = (id: string, projectId: string) => ({
  id,
  projectId,
  version: 1,
  manifest: "{}",
  manifestBytes: 2,
  totalBytes: html.byteLength + png.byteLength + js.byteLength,
  fileCount: 3,
  engineVersion: "0.14.1",
  gameId: "tactics",
  snapshot: "d".repeat(64),
  buildHash: "e".repeat(64),
  target: "web",
});

async function seedProject(projectId: string, releaseId: string, visibility: string) {
  await db.insert(engineProjects).values({
    projectId,
    name: projectId,
    visibility,
    connectOrigins: ["https://api.example.org"],
  });
  await db.insert(engineReleases).values(release(releaseId, projectId));
  await db.insert(engineReleaseObjects).values([
    {
      projectId,
      sha256: HTML_HASH,
      bytes: html.byteLength,
      contentType: "text/html",
      storageKey: engineReleaseObjectKey(projectId, HTML_HASH),
    },
    {
      projectId,
      sha256: JS_HASH,
      bytes: js.byteLength,
      contentType: "text/javascript",
      storageKey: engineReleaseObjectKey(projectId, JS_HASH),
    },
  ]);
  await db.insert(engineBlobs).values({
    projectId,
    sha256: PNG_HASH,
    byteSize: png.byteLength,
    contentType: "image/png",
    storageKey: engineAssetKey(projectId, PNG_HASH),
  });
  await db.insert(engineReleaseFiles).values([
    {
      releaseId,
      projectId,
      path: "index.html",
      sha256: HTML_HASH,
      bytes: html.byteLength,
      role: "shell",
      source: "release",
    },
    {
      releaseId,
      projectId,
      path: "code/main.js",
      sha256: JS_HASH,
      bytes: js.byteLength,
      role: "code",
      source: "release",
    },
    {
      releaseId,
      projectId,
      path: pngPath,
      sha256: PNG_HASH,
      bytes: png.byteLength,
      role: "asset",
      source: "blob",
    },
  ]);
  // Stored under a misleading type: the route serves the table's type, never the object's.
  await store.put(engineReleaseObjectKey(projectId, HTML_HASH), html, "application/octet-stream");
  await store.put(engineReleaseObjectKey(projectId, JS_HASH), js, "text/plain");
  await store.put(engineAssetKey(projectId, PNG_HASH), png, "application/octet-stream");
}

beforeEach(async () => {
  clock = new Date("2026-11-12T12:00:00Z");
  store = memoryReleaseStore();
  for (const id of [PUBLIC, PRIVATE, TEAM]) forgetRelease(id);
  await db.delete(engineProjects);
  await seedProject("open-game", PUBLIC, "public");
  await seedProject("secret-game", PRIVATE, "private");
  await seedProject("team-game", TEAM, "team");
});

const route = (overrides: Partial<FrameRouteDeps> = {}) =>
  createFrameRoute({
    store,
    db,
    now: () => clock,
    allowed: () => true,
    playHostOrigin: null,
    playOrigin: () => PLAY,
    siteOrigin: () => SITE,
    syncOrigin: () => SYNC,
    ...overrides,
  });

const get = (path: string, init?: RequestInit, deps?: Partial<FrameRouteDeps>) =>
  route(deps)(new Request(`${PLAY}${path}`, init));

const token = async (releaseId: string, now = clock) =>
  (await mintFrameToken({ releaseId, userId: "viewer", now }))!;

function expectFrameHeaders(response: Response, base?: string) {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("sandbox allow-scripts");
  if (base) expect(csp).toContain(`script-src ${base} 'wasm-unsafe-eval'`);
  // A public or unlisted frame may sit under the embed page on any site; a private one only under ours.
  const privatePrefix = csp.includes(`${PLAY}/frames-private/`);
  expect(csp).toContain(`frame-ancestors ${privatePrefix ? SITE : "*"}`);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  return csp;
}

describe("the public prefix", () => {
  it("serves each file with the table's type, the hash as etag and the frame CSP", async () => {
    const base = `${PLAY}/frames/${PUBLIC}/`;
    const page = await get(`/frames/${PUBLIC}/index.html?host=jams`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html");
    expect(page.headers.get("etag")).toBe(`"${HTML_HASH}"`);
    expect(page.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await page.arrayBuffer())).toEqual(html);
    const csp = expectFrameHeaders(page, base);
    expect(csp).toContain("https://api.example.org");
    expect(csp).not.toContain(SYNC);

    const code = await get(`/frames/${PUBLIC}/code/main.js`);
    expect(code.headers.get("content-type")).toBe("text/javascript");
    const image = await get(`/frames/${PUBLIC}/${pngPath}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  });

  it("adds the sync origin to the CSP only for an online project", async () => {
    await db
      .update(engineProjects)
      .set({ online: true })
      .where(eq(engineProjects.projectId, "open-game"));
    const response = await get(`/frames/${PUBLIC}/index.html`);
    expect(response.headers.get("content-security-policy")).toContain(SYNC);
  });

  it("answers 404 with the frame headers for an unknown release, an unknown path or a bad path", async () => {
    for (const path of [
      `/frames/${"f".repeat(64)}/index.html`,
      `/frames/${PUBLIC}/missing.html`,
      `/frames/${PUBLIC}/`,
      `/frames/${PUBLIC}/code//main.js`,
      `/frames/${PUBLIC}/code%2Fmain.js`,
      `/frames/${PUBLIC.slice(1)}/index.html`,
      `/frames/${PUBLIC.toUpperCase()}/index.html`,
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expectFrameHeaders(response);
    }
    const missing = await get(`/frames/${PUBLIC}/missing.html`);
    expectFrameHeaders(missing, `${PLAY}/frames/${PUBLIC}/`);
  });

  it("answers 404 when the stored object is gone", async () => {
    await store.remove(engineReleaseObjectKey("open-game", HTML_HASH));
    const response = await get(`/frames/${PUBLIC}/index.html`);
    expect(response.status).toBe(404);
    expect(response.headers.get("etag")).toBeNull();
    expectFrameHeaders(response, `${PLAY}/frames/${PUBLIC}/`);
  });

  it("refuses a private or team release with 404", async () => {
    for (const id of [PRIVATE, TEAM]) {
      const response = await get(`/frames/${id}/index.html`);
      expect(response.status).toBe(404);
      expectFrameHeaders(response, `${PLAY}/frames/${id}/`);
    }
  });

  it("serves an unlisted release", async () => {
    await db
      .update(engineProjects)
      .set({ visibility: "unlisted" })
      .where(eq(engineProjects.projectId, "open-game"));
    expect((await get(`/frames/${PUBLIC}/index.html`)).status).toBe(200);
  });

  it("answers 410 for a collected release", async () => {
    await db
      .update(engineReleases)
      .set({ collectedAt: clock, manifest: null })
      .where(eq(engineReleases.id, PUBLIC));
    await db.delete(engineReleaseFiles).where(eq(engineReleaseFiles.releaseId, PUBLIC));
    const response = await get(`/frames/${PUBLIC}/index.html`);
    expect(response.status).toBe(410);
    expect(await response.text()).toBe("This version of the game was removed");
    expectFrameHeaders(response, `${PLAY}/frames/${PUBLIC}/`);
  });

  it("answers 410 for a hidden release and for a hidden project", async () => {
    await db
      .update(engineReleases)
      .set({ hiddenAt: clock, hiddenReason: "Under review." })
      .where(eq(engineReleases.id, PUBLIC));
    const hidden = await get(`/frames/${PUBLIC}/index.html`);
    expect(hidden.status).toBe(410);
    expectFrameHeaders(hidden, `${PLAY}/frames/${PUBLIC}/`);

    await db
      .update(engineReleases)
      .set({ hiddenAt: null, hiddenReason: null })
      .where(eq(engineReleases.id, PUBLIC));
    await db
      .update(engineProjects)
      .set({ hiddenAt: clock })
      .where(eq(engineProjects.projectId, "open-game"));
    forgetProjectReleases("open-game");
    expect((await get(`/frames/${PUBLIC}/index.html`)).status).toBe(410);
  });

  it("answers 404 for a deleted project's release", async () => {
    await db
      .update(engineProjects)
      .set({ deletedAt: clock })
      .where(eq(engineProjects.projectId, "open-game"));
    expect((await get(`/frames/${PUBLIC}/index.html`)).status).toBe(404);
  });

  it("serves a range, HEAD and a 304", async () => {
    const range = await get(`/frames/${PUBLIC}/${pngPath}`, { headers: { range: "bytes=0-3" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 0-3/${png.byteLength}`);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(png.slice(0, 4));
    expectFrameHeaders(range, `${PLAY}/frames/${PUBLIC}/`);

    const head = await get(`/frames/${PUBLIC}/index.html`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(html.byteLength));
    expect(head.headers.get("content-type")).toBe("text/html");
    expect(await head.text()).toBe("");

    const notModified = await get(`/frames/${PUBLIC}/index.html`, {
      headers: { "if-none-match": `"${HTML_HASH}"` },
    });
    expect(notModified.status).toBe(304);
    expectFrameHeaders(notModified, `${PLAY}/frames/${PUBLIC}/`);
  });
});

describe("the private prefix", () => {
  it("serves a private or team release with a token for it, never at the edge", async () => {
    for (const id of [PRIVATE, TEAM]) {
      const t = await token(id);
      const response = await get(`/frames-private/${id}/${t}/index.html`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
      expectFrameHeaders(response, `${PLAY}/frames-private/${id}/${t}/`);
    }
  });

  it("refuses a bad, expired or other release's token with 403", async () => {
    const other = await token(TEAM);
    const expired = await token(PRIVATE, new Date(clock.getTime() - 13 * 60 * 60 * 1000));
    const good = await token(PRIVATE);
    const tampered = `${good.slice(0, -2)}${good.endsWith("AA") ? "BB" : "AA"}`;
    const semicolon = await get(`/frames-private/${PRIVATE}/a%3Bb/index.html`);
    expect(semicolon.status).toBe(404);
    expectFrameHeaders(semicolon);
    for (const t of ["not-a-token", other, expired, tampered]) {
      const response = await get(`/frames-private/${PRIVATE}/${t}/index.html`);
      expect(response.status).toBe(403);
      expectFrameHeaders(response, `${PLAY}/frames-private/${PRIVATE}/${t}/`);
    }
  });

  it("refuses without a frame secret", async () => {
    const t = await token(PRIVATE);
    vi.stubEnv("ENGINE_FRAME_SECRET", "");
    try {
      expect((await get(`/frames-private/${PRIVATE}/${t}/index.html`)).status).toBe(403);
    } finally {
      vi.stubEnv("ENGINE_FRAME_SECRET", "a-frame-secret-for-tests");
    }
  });

  it("answers 410 for a hidden private release with a good token", async () => {
    await db.update(engineReleases).set({ hiddenAt: clock }).where(eq(engineReleases.id, PRIVATE));
    const t = await token(PRIVATE);
    expect((await get(`/frames-private/${PRIVATE}/${t}/index.html`)).status).toBe(410);
  });

  it("reads the prefix from the path when none is given", async () => {
    const t = await token(PRIVATE);
    const handle = route();
    expect(
      (await handle(new Request(`${PLAY}/frames-private/${PRIVATE}/${t}/index.html`))).status,
    ).toBe(200);
    expect((await handle(new Request(`${PLAY}/frames/${PUBLIC}/index.html`))).status).toBe(200);
    expect((await handle(new Request(`${PLAY}/frames/${PRIVATE}/index.html`))).status).toBe(404);
  });
});

describe("the deployment", () => {
  it("refuses everything where games aren't allowed", async () => {
    const response = await get(`/frames/${PUBLIC}/index.html`, undefined, { allowed: () => false });
    expect(response.status).toBe(404);
    expectFrameHeaders(response, `${PLAY}/frames/${PUBLIC}/`);
  });

  it("answers only on the play host when one is configured", async () => {
    const deps = { playHostOrigin: PLAY };
    expect((await get(`/frames/${PUBLIC}/index.html`, undefined, deps)).status).toBe(200);
    const elsewhere = await route(deps)(new Request(`${SITE}/frames/${PUBLIC}/index.html`));
    expect(elsewhere.status).toBe(404);
  });
});

describe("resolveRelease", () => {
  it("resolves a path to its object and keeps the answer until forgotten or stale", async () => {
    const opts = { db, now: () => clock };
    const resolved = await resolveRelease(PUBLIC, pngPath, opts);
    expect(resolved).toMatchObject({
      projectId: "open-game",
      visibility: "public",
      hidden: false,
      collected: false,
      connectOrigins: ["https://api.example.org"],
      online: false,
      file: {
        sha256: PNG_HASH,
        storageKey: engineAssetKey("open-game", PNG_HASH),
        contentType: "image/png",
        bytes: png.byteLength,
      },
    });
    expect((await resolveRelease(PUBLIC, "nope.html", opts))?.file).toBeNull();
    expect(await resolveRelease("f".repeat(64), "index.html", opts)).toBeNull();

    await db
      .update(engineReleases)
      .set({ hiddenAt: clock, hiddenReason: "Under review." })
      .where(eq(engineReleases.id, PUBLIC));
    expect((await resolveRelease(PUBLIC, "index.html", opts))?.hidden).toBe(false);
    forgetRelease(PUBLIC);
    expect(await resolveRelease(PUBLIC, "index.html", opts)).toMatchObject({
      hidden: true,
      hiddenReason: "Under review.",
    });

    await db
      .update(engineReleases)
      .set({ hiddenAt: null, hiddenReason: null })
      .where(eq(engineReleases.id, PUBLIC));
    clock = new Date(clock.getTime() + 9 * 60 * 1000);
    expect((await resolveRelease(PUBLIC, "index.html", opts))?.hidden).toBe(true);
    clock = new Date(clock.getTime() + 2 * 60 * 1000);
    expect((await resolveRelease(PUBLIC, "index.html", opts))?.hidden).toBe(false);
  });
});

describe("parseFramePath", () => {
  it("splits the release, the token and the file", () => {
    expect(parseFramePath(`/frames/${PUBLIC}/code/main.js`, "frames")).toEqual({
      releaseId: PUBLIC,
      token: null,
      path: "code/main.js",
    });
    expect(
      parseFramePath(`/frames-private/${PRIVATE}/tok.sig/index.html`, "frames-private"),
    ).toEqual({
      releaseId: PRIVATE,
      token: "tok.sig",
      path: "index.html",
    });
    expect(parseFramePath(`/frames-private/${PRIVATE}/tok.sig`, "frames-private")).toBeNull();
    expect(
      parseFramePath(
        `/frames-private/${PRIVATE}/tok%3Bscript-src%20*/index.html`,
        "frames-private",
      ),
    ).toBeNull();
    expect(parseFramePath(`/frames/${PUBLIC}/index.html`, "frames-private")).toBeNull();
  });
});
