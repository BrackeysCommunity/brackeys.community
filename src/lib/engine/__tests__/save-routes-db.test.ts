import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineSaves } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { forgetProjectReleases } from "../frame-route";
import { SITE_SAVE_LIMITS } from "../limits";
import { promote } from "../release-channels";
import { memoryReleaseStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "../release-upload";
import { ENGINE_SAVES_PATH, engineProjectSavesPath, engineSavePath } from "../route-paths";
import { createSaveRoutes } from "../save-routes";
import { engineSaveKey } from "../storage-keys";
import { plannedRelease } from "./release-fixture";

const state = vi.hoisted(() => ({
  allowed: true,
  games: true,
  session: null as null | { user: { id: string; bannedAt?: Date | null } },
}));

vi.mock("@/polyfill", () => ({}));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => state.session } },
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag === "engine-games-enabled" && state.games,
  withErrorReporting: (_route: string, fn: unknown) => fn,
}));
vi.mock("../guard", () => ({ engineGamesAllowed: () => state.allowed }));
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  getMinioClient: () => null,
}));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const db = mockedDb as unknown as TestDb;

const PROJECT = "save-routes";
const GAME = "save-game";
const ORIGIN = "https://site.test";
const NOW = new Date("2026-11-12T15:00:00Z");
const creator: Actor = { kind: "user", userId: "creator" };

let store = memoryReleaseStore();
let routes: ReturnType<typeof createSaveRoutes>;

function saveText(slot: string, data: unknown = null, game = GAME): string {
  const file: SaveFile = {
    kind: "save",
    v: 1,
    game,
    gameVersion: 1,
    engine: "0.14.2",
    release: null,
    project: null,
    slot,
    meta: { title: "Chapter one", scene: "hall", savedAt: 0, playTicks: 60 },
    depth: "progress",
    persist: null,
    scene: { id: "hall", runHash: "", sublevels: [] },
    data: data as SaveFile["data"],
  };
  return formatSaveFile(file);
}

/** A save of exactly `bytes` UTF-8 bytes. */
function saveOfBytes(slot: string, bytes: number): string {
  const base = saveText(slot, "");
  return saveText(slot, "x".repeat(bytes - new TextEncoder().encode(base).length));
}

function call(
  path: string,
  opts: { method?: string; user?: string; body?: BodyInit | ReadableStream<Uint8Array> } = {},
): Request {
  const headers = new Headers();
  if (opts.user) headers.set("x-test-user", opts.user);
  return new Request(`${ORIGIN}${path}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: opts.body, duplex: "half" } : {}),
  } as RequestInit);
}

const send = async (request: Request) => (await routes(request))!;

const put = (slot: string, text: string, user = "player") =>
  send(call(engineSavePath(PROJECT, slot), { method: "PUT", user, body: text }));

async function publishProduction() {
  const deps: ReleaseDeps = {
    db: db as unknown as ReleaseTxDb,
    store,
    now: () => NOW,
    rateLimit: async () => true,
    scan: async () => {},
  };
  const planned = await plannedRelease({
    projectId: PROJECT,
    gameId: GAME,
    engineVersion: "0.14.1",
  });
  const begun = await beginRelease(deps, {
    projectId: PROJECT,
    manifest: planned.text,
    actor: creator,
  });
  for (const file of begun.missing)
    await putReleaseFile(deps, {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: planned.files.get(file.path)!,
      actor: creator,
    });
  await commitRelease(deps, { uploadId: begun.uploadId, actor: creator });
  await promote(
    { projectId: PROJECT, version: 1, channel: "production", actor: creator },
    { db: db as unknown as ReleaseTxDb, now: () => NOW },
  );
}

beforeAll(async () => {
  await seedUser(db, "creator");
  await seedUser(db, "player");
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Save Routes",
    game: GAME,
    createdById: "creator",
    visibility: "public",
    saveMode: "site",
  });
  await publishProduction();
});

beforeEach(async () => {
  state.allowed = true;
  state.games = true;
  state.session = null;
  store = memoryReleaseStore();
  await db.delete(engineSaves);
  await db
    .update(engineProjects)
    .set({ saveMode: "site" })
    .where(eq(engineProjects.projectId, PROJECT));
  forgetProjectReleases(PROJECT);
  routes = createSaveRoutes({
    readSession: async (request) => {
      const id = request.headers.get("x-test-user");
      return id ? { user: { id } } : null;
    },
    saves: { store, rateLimit: async () => true, now: () => NOW },
  });
});

describe("save routes", () => {
  it("lists a game's saves with its limits, its sentence and its mode", async () => {
    const response = await send(call(engineProjectSavesPath(PROJECT), { user: "player" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ saves: [], limits: SITE_SAVE_LIMITS, mode: "site" });
    expect(typeof body.describe).toBe("string");
  });

  it("writes a save, reads its text back, lists it and deletes it", async () => {
    const text = saveText("one", { gold: 3 });
    const written = await put("one", text);
    expect(written.status).toBe(200);
    expect(written.headers.get("cache-control")).toBe("no-store");
    expect(await written.json()).toEqual({ bytes: new TextEncoder().encode(text).length });
    expect(store.objects.has(engineSaveKey("player", PROJECT, "one"))).toBe(true);

    const read = await send(call(engineSavePath(PROJECT, "one"), { user: "player" }));
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toMatch(/^application\/json/);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.text()).toBe(text);

    const listed = await send(call(engineProjectSavesPath(PROJECT), { user: "player" }));
    const { saves } = (await listed.json()) as { saves: { slot: string; bytes: number }[] };
    expect(saves).toEqual([
      expect.objectContaining({ slot: "one", bytes: new TextEncoder().encode(text).length }),
    ]);

    const removed = await send(
      call(engineSavePath(PROJECT, "one"), { method: "DELETE", user: "player" }),
    );
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    const gone = await send(call(engineSavePath(PROJECT, "one"), { user: "player" }));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ code: "not-found" });
  });

  it("answers 404 for an empty slot", async () => {
    const response = await send(call(engineSavePath(PROJECT, "two"), { user: "player" }));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "not-found" });
  });

  it("lists every game's saves on the account for Settings", async () => {
    await put("one", saveText("one"));
    const response = await send(call(ENGINE_SAVES_PATH, { user: "player" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      games: { projectId: string; title: string; saves: { slot: string }[] }[];
      maxBytes: number;
    };
    expect(body.games).toEqual([
      expect.objectContaining({
        projectId: PROJECT,
        title: "Save Routes",
        saves: [expect.objectContaining({ slot: "one" })],
      }),
    ]);
  });

  it("refuses every route signed out with the save API's 401", async () => {
    const requests = [
      call(ENGINE_SAVES_PATH),
      call(engineProjectSavesPath(PROJECT)),
      call(engineSavePath(PROJECT, "one")),
      call(engineSavePath(PROJECT, "one"), { method: "PUT", body: saveText("one") }),
      call(engineSavePath(PROJECT, "one"), { method: "DELETE" }),
    ];
    for (const request of requests) {
      const response = await send(request);
      expect(response.status, `${request.method} ${request.url}`).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ code: "save-forbidden" });
    }
  });

  it("reads as not found while the flag is off or the deployment has no games", async () => {
    state.games = false;
    for (const path of [ENGINE_SAVES_PATH, engineProjectSavesPath(PROJECT)]) {
      const response = await send(call(path, { user: "player" }));
      expect(response.status).toBe(404);
    }
    const write = await put("one", saveText("one"));
    expect(write.status).toBe(404);

    state.games = true;
    state.allowed = false;
    for (const user of ["player", undefined]) {
      const response = await send(call(engineProjectSavesPath(PROJECT), { user }));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not-found" });
    }
    expect(await db.select().from(engineSaves)).toEqual([]);
  });

  it("accepts a save at the cap and refuses one byte over", async () => {
    const atCap = await put("one", saveOfBytes("one", SITE_SAVE_LIMITS.maxBytes));
    expect(atCap.status).toBe(200);
    const over = await put("two", saveOfBytes("two", SITE_SAVE_LIMITS.maxBytes + 1));
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: "save-too-large" });
  });

  it("stops reading an oversize body at the cap", async () => {
    const chunk = new Uint8Array(4_096).fill(0x20);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const response = await send(
      call(engineSavePath(PROJECT, "one"), { method: "PUT", user: "player", body: endless }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "save-too-large" });
    expect(pulled).toBeLessThanOrEqual(SITE_SAVE_LIMITS.maxBytes + 1 + 2 * chunk.byteLength);
    expect(await db.select().from(engineSaves)).toEqual([]);
  });

  it("refuses a body that isn't UTF-8", async () => {
    const response = await send(
      call(engineSavePath(PROJECT, "one"), {
        method: "PUT",
        user: "player",
        body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "schema" });
  });

  it("passes the save API's refusals through with their status", async () => {
    const otherGame = await put("one", saveText("one", null, "another-game"));
    expect(otherGame.status).toBe(422);
    expect(await otherGame.json()).toMatchObject({ code: "schema" });

    await db
      .update(engineProjects)
      .set({ saveMode: "own" })
      .where(eq(engineProjects.projectId, PROJECT));
    forgetProjectReleases(PROJECT);
    const own = await put("one", saveText("one"));
    expect(own.status).toBe(403);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(await own.json()).toMatchObject({ code: "save-forbidden" });
  });

  it("answers 405 for another method and passes other paths on", async () => {
    const post = await send(
      call(engineProjectSavesPath(PROJECT), { method: "POST", user: "player" }),
    );
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    const patch = await send(
      call(engineSavePath(PROJECT, "one"), { method: "PATCH", user: "player" }),
    );
    expect(patch.status).toBe(405);
    expect(await routes(call(`/api/engine/projects/${PROJECT}/releases`))).toBeNull();
    expect(await routes(call(`${ENGINE_SAVES_PATH}/${PROJECT}/one/extra`))).toBeNull();
  });
});

describe("the site's dispatch", () => {
  it("reads a banned session as signed out", async () => {
    const { Route } = await import("@/routes/api.$");
    const handlers = (
      Route as unknown as {
        options: {
          server: { handlers: Record<string, (ctx: { request: Request }) => Promise<Response>> };
        };
      }
    ).options.server.handlers;
    const GET = handlers.GET!;

    state.session = { user: { id: "player", bannedAt: new Date("2026-11-01T00:00:00Z") } };
    const banned = await GET({ request: call(engineProjectSavesPath(PROJECT)) });
    expect(banned.status).toBe(401);
    expect(await banned.json()).toMatchObject({ code: "save-forbidden" });

    state.session = { user: { id: "player", bannedAt: null } };
    const account = await GET({ request: call(ENGINE_SAVES_PATH) });
    expect(account.status).toBe(200);
  });
});
