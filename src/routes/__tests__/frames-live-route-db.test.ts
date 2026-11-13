import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  engineBlobs,
  engineProjects,
  engineReleaseObjects,
  engineReleases,
  engineSceneVersionFiles,
  engineSceneVersions,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";

import {
  applyReleaseNotice,
  createFrameRoute,
  forgetLiveFiles,
  forgetRelease,
  parseLivePath,
  type FrameRouteDeps,
} from "../../lib/engine/frame-route";
import { mintFrameToken } from "../../lib/engine/frame-token";
import { memoryReleaseStore } from "../../lib/engine/release-storage";
import { engineAssetKey, engineReleaseObjectKey } from "../../lib/engine/storage-keys";

const SITE = "http://localhost:3000";
const PLAY = "http://play.localhost:3000";

const COMPAT = "c".repeat(64);
const OTHER_COMPAT = "d".repeat(64);

const PUBLIC = "a".repeat(64);
const PRIVATE = "b".repeat(64);
const NO_LIVE = "e".repeat(64);
const OTHER_PROJECT = "f".repeat(64);

const SCENE_HASH = "1".repeat(64);
const PNG_HASH = "2".repeat(64);
const HIDDEN_HASH = "3".repeat(64);
const BLOCKED_HASH = "4".repeat(64);
const OTHER_COMPAT_HASH = "5".repeat(64);
const OTHER_PROJECT_HASH = "6".repeat(64);
const COLLECTED_HASH = "7".repeat(64);
const SHARED_HASH = "8".repeat(64);

const sceneText = new TextEncoder().encode('{"entities":[]}');
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let db: TestDb;
let store: ReturnType<typeof memoryReleaseStore>;
const clock = new Date("2026-11-13T12:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
  vi.stubEnv("ENGINE_FRAME_SECRET", "a-frame-secret-for-tests");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const versionId = (n: number) => n.toString(16).padStart(64, "0");

async function seedRelease(
  projectId: string,
  releaseId: string,
  visibility: string,
  liveCompatKey: string,
) {
  await db.insert(engineProjects).values({
    projectId,
    name: projectId,
    visibility,
    connectOrigins: ["https://api.example.org"],
  });
  await db.insert(engineReleases).values({
    id: releaseId,
    projectId,
    version: 1,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 0,
    fileCount: 0,
    engineVersion: "0.14.5",
    gameId: "tactics",
    snapshot: "9".repeat(64),
    buildHash: "0".repeat(64),
    target: "web",
    liveCompatKey,
  });
}

let nextVersion = 1;

/** A version of `scene` listing a text, and a blob when `blob` is given. */
async function seedVersion(
  projectId: string,
  opts: {
    text: string;
    blob?: string;
    compatKey?: string;
    hiddenAt?: Date;
    blockedAt?: Date;
    collectedAt?: Date;
  },
) {
  const id = versionId(nextVersion);
  await db.insert(engineSceneVersions).values({
    id,
    projectId,
    sceneId: "level-1",
    number: nextVersion++,
    descriptor: opts.collectedAt ? null : "{}",
    compatKey: opts.compatKey ?? COMPAT,
    physics: "rapier",
    sceneHash: opts.text,
    dataBytes: sceneText.byteLength,
    hiddenAt: opts.hiddenAt ?? null,
    blockedAt: opts.blockedAt ?? null,
    blockedBy: opts.blockedAt ? "system" : null,
    collectedAt: opts.collectedAt ?? null,
  });
  await db
    .insert(engineReleaseObjects)
    .values({
      projectId,
      sha256: opts.text,
      bytes: sceneText.byteLength,
      contentType: "application/json",
      storageKey: engineReleaseObjectKey(projectId, opts.text),
    })
    .onConflictDoNothing();
  await store.put(engineReleaseObjectKey(projectId, opts.text), sceneText, "text/plain");
  const files: (typeof engineSceneVersionFiles.$inferInsert)[] = [
    {
      versionId: id,
      projectId,
      sha256: opts.text,
      bytes: sceneText.byteLength,
      role: "scene",
      ext: ".json",
      source: "release",
    },
  ];
  if (opts.blob) {
    await db
      .insert(engineBlobs)
      .values({
        projectId,
        sha256: opts.blob,
        byteSize: png.byteLength,
        contentType: "image/png",
        storageKey: engineAssetKey(projectId, opts.blob),
      })
      .onConflictDoNothing();
    await store.put(engineAssetKey(projectId, opts.blob), png, "application/octet-stream");
    files.push({
      versionId: id,
      projectId,
      sha256: opts.blob,
      bytes: png.byteLength,
      role: "blob",
      ext: ".png",
      source: "blob",
    });
  }
  await db.insert(engineSceneVersionFiles).values(files);
  return id;
}

beforeEach(async () => {
  store = memoryReleaseStore();
  nextVersion = 1;
  for (const id of [PUBLIC, PRIVATE, NO_LIVE, OTHER_PROJECT]) forgetRelease(id);
  for (const project of ["open-game", "secret-game", "no-live-game", "other-game"]) {
    forgetLiveFiles(project);
  }
  await db.delete(engineSceneVersions);
  await db.delete(engineProjects);
  await seedRelease("open-game", PUBLIC, "public", COMPAT);
  await seedRelease("secret-game", PRIVATE, "private", COMPAT);
  await seedRelease("no-live-game", NO_LIVE, "public", "");
  await seedRelease("other-game", OTHER_PROJECT, "public", COMPAT);

  await seedVersion("open-game", { text: SCENE_HASH, blob: PNG_HASH });
  await seedVersion("open-game", { text: HIDDEN_HASH, hiddenAt: clock });
  await seedVersion("open-game", { text: BLOCKED_HASH, blockedAt: clock });
  await seedVersion("open-game", { text: OTHER_COMPAT_HASH, compatKey: OTHER_COMPAT });
  await seedVersion("open-game", { text: COLLECTED_HASH, collectedAt: clock });
  await seedVersion("other-game", { text: OTHER_PROJECT_HASH });
  await seedVersion("secret-game", { text: SCENE_HASH });
  await seedVersion("no-live-game", { text: SCENE_HASH });
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
    syncOrigin: () => null,
    ...overrides,
  });

const get = (path: string, init?: RequestInit) => route()(new Request(`${PLAY}${path}`, init));

const live = (releaseId: string, name: string) => `/frames/${releaseId}/live/${name}`;

/** The frame headers, and the release's own CSP: its connect origins, its base. */
function expectReleaseHeaders(response: Response, base: string) {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("sandbox allow-scripts");
  expect(csp).toContain(`script-src ${base} 'wasm-unsafe-eval'`);
  expect(csp).toContain("https://api.example.org");
}

describe("the live prefix", () => {
  it("serves a listed text and a listed blob with their types, the hash as etag and the release's CSP", async () => {
    const base = `${PLAY}/frames/${PUBLIC}/`;
    const text = await get(live(PUBLIC, `${SCENE_HASH}.json`));
    expect(text.status).toBe(200);
    expect(text.headers.get("content-type")).toBe("application/json");
    expect(text.headers.get("etag")).toBe(`"${SCENE_HASH}"`);
    expect(text.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await text.arrayBuffer())).toEqual(sceneText);
    expectReleaseHeaders(text, base);

    const blob = await get(live(PUBLIC, `${PNG_HASH}.png`));
    expect(blob.status).toBe(200);
    expect(blob.headers.get("content-type")).toBe("image/png");
    expect(blob.headers.get("etag")).toBe(`"${PNG_HASH}"`);
    expect(blob.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
    expectReleaseHeaders(blob, base);
  });

  it("answers 404 for a hash another project lists", async () => {
    const response = await get(live(PUBLIC, `${OTHER_PROJECT_HASH}.json`));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectReleaseHeaders(response, `${PLAY}/frames/${PUBLIC}/`);
    expect((await get(live(OTHER_PROJECT, `${OTHER_PROJECT_HASH}.json`))).status).toBe(200);
  });

  it("answers 404 for a hash only a version with another compat key lists", async () => {
    expect((await get(live(PUBLIC, `${OTHER_COMPAT_HASH}.json`))).status).toBe(404);
  });

  it("answers 404 for a collected version's files, an unlisted hash or a wrong extension", async () => {
    expect((await get(live(PUBLIC, `${COLLECTED_HASH}.json`))).status).toBe(404);
    expect((await get(live(PUBLIC, `${"9".repeat(64)}.json`))).status).toBe(404);
    expect((await get(live(PUBLIC, `${SCENE_HASH}.png`))).status).toBe(404);
  });

  it("answers 404 for a release that takes no live scenes", async () => {
    expect((await get(live(NO_LIVE, `${SCENE_HASH}.json`))).status).toBe(404);
  });

  it("answers 410 for a hidden version's files, with the release's CSP", async () => {
    const response = await get(live(PUBLIC, `${HIDDEN_HASH}.json`));
    expect(response.status).toBe(410);
    expect(await response.text()).toBe("This level was removed");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectReleaseHeaders(response, `${PLAY}/frames/${PUBLIC}/`);
  });

  it("serves a blocked version's files", async () => {
    expect((await get(live(PUBLIC, `${BLOCKED_HASH}.json`))).status).toBe(200);
  });

  it("serves a hash a hidden version shares with a listed one", async () => {
    await seedVersion("open-game", { text: SHARED_HASH, hiddenAt: clock });
    await seedVersion("open-game", { text: SHARED_HASH });
    expect((await get(live(PUBLIC, `${SHARED_HASH}.json`))).status).toBe(200);
  });

  it("refuses .js, .html and malformed names with 404", async () => {
    for (const name of [
      `${SCENE_HASH}.js`,
      `${SCENE_HASH}.html`,
      `${SCENE_HASH}.JSON`,
      `${SCENE_HASH}`,
      `${SCENE_HASH.slice(1)}.json`,
      `nested/${SCENE_HASH}.json`,
    ]) {
      expect((await get(live(PUBLIC, name))).status, name).toBe(404);
    }
    expect((await get(`/frames/${PUBLIC}/live/`)).status).toBe(404);
  });

  it("serves HEAD and answers a matching etag with 304", async () => {
    const head = await get(live(PUBLIC, `${SCENE_HASH}.json`), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    const cached = await get(live(PUBLIC, `${SCENE_HASH}.json`), {
      headers: { "if-none-match": `"${SCENE_HASH}"` },
    });
    expect(cached.status).toBe(304);
  });

  it("answers 404 when the stored object is gone", async () => {
    await store.remove(engineAssetKey("open-game", PNG_HASH));
    const response = await get(live(PUBLIC, `${PNG_HASH}.png`));
    expect(response.status).toBe(404);
    expectReleaseHeaders(response, `${PLAY}/frames/${PUBLIC}/`);
  });

  it("refuses a private release's files on the public prefix", async () => {
    expect((await get(live(PRIVATE, `${SCENE_HASH}.json`))).status).toBe(404);
  });
});

describe("the live prefix's lookup cache", () => {
  const hide = (sha256: string) =>
    db
      .update(engineSceneVersions)
      .set({ hiddenAt: clock })
      .where(eq(engineSceneVersions.sceneHash, sha256));

  it("keeps a listed answer until the project's lookups are dropped", async () => {
    expect((await get(live(PUBLIC, `${SCENE_HASH}.json`))).status).toBe(200);
    await hide(SCENE_HASH);
    expect((await get(live(PUBLIC, `${SCENE_HASH}.json`))).status).toBe(200);
    forgetLiveFiles("other-game");
    expect((await get(live(PUBLIC, `${SCENE_HASH}.json`))).status).toBe(200);
    forgetLiveFiles("open-game");
    expect((await get(live(PUBLIC, `${SCENE_HASH}.json`))).status).toBe(410);
  });

  it("drops a project's lookups on the release notice", async () => {
    expect((await get(live(PUBLIC, `${SCENE_HASH}.json`))).status).toBe(200);
    await hide(SCENE_HASH);
    applyReleaseNotice({ releaseIds: [], projectIds: ["open-game"] });
    expect((await get(live(PUBLIC, `${SCENE_HASH}.json`))).status).toBe(410);
  });

  it("doesn't keep an unknown hash, so a version committed after a probe serves at once", async () => {
    const hash = "9".repeat(64);
    expect((await get(live(PUBLIC, `${hash}.json`))).status).toBe(404);
    await seedVersion("open-game", { text: hash });
    expect((await get(live(PUBLIC, `${hash}.json`))).status).toBe(200);
  });
});

describe("the private live prefix", () => {
  const privateLive = (token: string, name: string) =>
    `/frames-private/${PRIVATE}/${token}/live/${name}`;

  it("serves a listed file with a token for the release, never at the edge", async () => {
    const token = (await mintFrameToken({ releaseId: PRIVATE, userId: "viewer", now: clock }))!;
    const response = await get(privateLive(token, `${SCENE_HASH}.json`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("content-type")).toBe("application/json");
    expectReleaseHeaders(response, `${PLAY}/frames-private/${PRIVATE}/${token}/`);
  });

  it("refuses a bad or another release's token with 403", async () => {
    const other = (await mintFrameToken({ releaseId: PUBLIC, userId: "viewer", now: clock }))!;
    expect((await get(privateLive(other, `${SCENE_HASH}.json`))).status).toBe(403);
    expect((await get(privateLive("not-a-token", `${SCENE_HASH}.json`))).status).toBe(403);
  });
});

describe("parseLivePath", () => {
  it("takes a 64-hex hash with .json or an asset extension", () => {
    expect(parseLivePath(`live/${SCENE_HASH}.json`)).toEqual({
      sha256: SCENE_HASH,
      ext: ".json",
      contentType: "application/json",
    });
    expect(parseLivePath(`live/${PNG_HASH}.ogg`)?.contentType).toBe("audio/ogg");
    expect(parseLivePath(`live/${PNG_HASH}.woff2`)?.contentType).toBe("font/woff2");
    for (const path of [
      `live/${PNG_HASH}.js`,
      `live/${PNG_HASH}.mjs`,
      `live/${PNG_HASH}.html`,
      `live/${PNG_HASH}.svg`,
      `live/${PNG_HASH}.wasm`,
      `data/${PNG_HASH}.json`,
      `live/${"ab".repeat(32).toUpperCase()}.json`,
    ]) {
      expect(parseLivePath(path), path).toBeNull();
    }
  });
});
