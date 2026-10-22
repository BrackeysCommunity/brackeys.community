/**
 * `/api/canvas/image` with an import's `path`, through the real
 * `uploadImageToStorage` (object store and queue faked) so the media-scan
 * row is checked too, not only the attachment row.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { canvasAttachments, developerProfiles, imageScans, user } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

const state = vi.hoisted(() => ({
  allowed: true,
  buckets: [] as string[],
  puts: [] as string[],
  enqueued: [] as string[],
}));

vi.mock("@/polyfill", () => ({}));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/env")>();
  return {
    env: {
      ...original.env,
      MINIO_BUCKET: "bucket",
      MINIO_ENDPOINT: "http://localhost:9000",
      MINIO_ACCESS_KEY: "key",
      MINIO_SECRET_KEY: "secret",
    },
  };
});
vi.mock("minio", () => ({
  Client: class {
    async putObject(_bucket: string, key: string) {
      state.puts.push(key);
    }
  },
}));
vi.mock("@/lib/queue", () => ({
  getMediaScanQueue: async () => ({
    add: async (_name: string, data: { objectKey: string }) => {
      state.enqueued.push(data.objectKey);
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "alice", banned: false } }) } },
}));
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({ refreshDiscordProfileThrottled: async () => {} }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
  withErrorReporting: (_route: string, fn: unknown) => fn,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (bucket: string) => {
    state.buckets.push(bucket);
    return state.allowed;
  },
}));

import { Route } from "../api.$";

const POST = (
  Route as unknown as {
    options: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.POST;

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  Object.assign(state, { allowed: true, buckets: [], puts: [], enqueued: [] });
  await db.delete(imageScans);
  await db.delete(canvasAttachments);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "alice");
});

async function upload(path?: string | Blob, name = "boss.png") {
  const form = new FormData();
  form.append("image", new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" }));
  form.append("scope", "personal");
  if (path !== undefined) form.append("path", path);
  const response = await POST({
    request: new Request("https://jams.team/api/canvas/image", { method: "POST", body: form }),
  });
  return {
    status: response.status,
    body: (await response.json()) as { id?: string; path?: string; url?: string; message?: string },
  };
}

describe("/api/canvas/image with an import's path", () => {
  it("stores at the path, uploads once, records a media-scan row and queues the scan", async () => {
    const { status, body } = await upload("Art/Deep/boss.png");
    expect(status).toBe(201);
    expect(body.path).toBe("Art/Deep/boss.png");
    expect(state.buckets).toEqual(["canvas-image"]);
    expect(state.puts).toHaveLength(1);
    const [scan] = await db
      .select()
      .from(imageScans)
      .where(eq(imageScans.objectKey, state.puts[0]!));
    expect(scan).toMatchObject({ ownerType: "canvas_attachment", uploaderId: "alice" });
    await vi.waitFor(() => expect(state.enqueued).toEqual(state.puts));
    const [row] = await db
      .select()
      .from(canvasAttachments)
      .where(eq(canvasAttachments.id, body.id!));
    expect(row!.imageKey).toBe(state.puts[0]);
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["traversal", "../../etc/boss.png", "Untitled/Untitled/etc/boss.png"],
    ["leading slash", "/abs/boss.png", "abs/boss.png"],
    ["backslashes", "Art\\boss.png", "Art-boss.png"],
    ["reserved Windows name", "Art/con.png", "Art/con_.png"],
    ["trailing dot folder", "Art./boss.png", "Art/boss.png"],
    ["NFD is stored NFC", "Art/naïve.png".normalize("NFD"), "Art/naïve.png".normalize("NFC")],
    ["not an image extension", "Art/boss.exe", "Art/boss.exe.png"],
  ])("%s is repaired, never refused", async (_label, path, expected) => {
    const { status, body } = await upload(path);
    expect(status).toBe(201);
    expect(body.path).toBe(expected);
  });

  it("an empty path falls back to attachments/<name>", async () => {
    expect((await upload("")).body.path).toBe("attachments/boss.png");
  });

  it("an over-long path is cut, not refused", async () => {
    const { status, body } = await upload(`${"a".repeat(3_000)}/boss.png`);
    expect(status).toBe(201);
    expect(new TextEncoder().encode(body.path!).length).toBeLessThanOrEqual(1_024);
  });

  it("a path that differs only in case collides with the existing one", async () => {
    await upload("Art/Boss.png");
    expect((await upload("art/boss.png")).body.path).toBe("art/boss 2.png");
  });

  it("a file sent as the path field is refused", async () => {
    const { status } = await upload(new Blob(["x"]));
    expect(status).toBe(400);
    expect(state.puts).toEqual([]);
  });

  it("concurrent uploads to the same path each land on their own name", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => upload("Art/same.png")));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const paths = results.map((r) => r.body.path);
    expect(new Set(paths).size).toBe(5);
  });

  it("over the budget: refused before storing, scanning or recording anything", async () => {
    state.allowed = false;
    const { status } = await upload("Art/boss.png");
    expect(status).toBe(429);
    expect(state.puts).toEqual([]);
    expect(await db.select().from(canvasAttachments)).toEqual([]);
    expect(await db.select().from(imageScans)).toEqual([]);
  });
});
