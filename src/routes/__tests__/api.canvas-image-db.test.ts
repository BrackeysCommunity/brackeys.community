import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { canvasAttachments, developerProfiles, user } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

const state = vi.hoisted(() => ({
  allowed: true,
  buckets: [] as [string, string, number, number][],
  uploads: [] as string[],
}));

vi.mock("@/polyfill", () => ({}));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
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
  checkRateLimit: async (bucket: string, userId: string, limit: number, window: number) => {
    state.buckets.push([bucket, userId, limit, window]);
    return state.allowed;
  },
}));
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  // The real one stores the file and queues its media scan.
  uploadImageToStorage: async ({ objectKey }: { objectKey: string }) => {
    state.uploads.push(objectKey);
    return { key: objectKey, url: `/images/${objectKey}` };
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
  state.allowed = true;
  state.buckets = [];
  state.uploads = [];
  await db.delete(canvasAttachments);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "alice");
});

async function upload(path?: string) {
  const form = new FormData();
  form.append("image", new File([new Uint8Array([1, 2, 3])], "boss.png", { type: "image/png" }));
  form.append("scope", "personal");
  if (path !== undefined) form.append("path", path);
  const response = await POST({
    request: new Request("https://jams.team/api/canvas/image", { method: "POST", body: form }),
  });
  return {
    status: response.status,
    body: (await response.json()) as { path?: string; message?: string },
  };
}

describe("/api/canvas/image path field", () => {
  it("defaults to attachments/<name>", async () => {
    expect((await upload()).body.path).toBe("attachments/boss.png");
  });

  it("keeps a valid vault path, through the canvas-image budget and the scanning upload", async () => {
    const { status, body } = await upload("Art/Bosses/boss.png");
    expect(status).toBe(201);
    expect(body.path).toBe("Art/Bosses/boss.png");
    expect(state.buckets).toEqual([["canvas-image", "alice", 200, 86400]]);
    expect(state.uploads).toHaveLength(1);
  });

  it("repairs an invalid path", async () => {
    expect((await upload("Art/bo:ss?.png")).body.path).toBe("Art/bo-ss-.png");
    expect((await upload("Art/notes.md")).body.path).toBe("Art/notes.md.png");
  });

  it("moves a collision to the next free name", async () => {
    await upload("Art/boss.png");
    expect((await upload("Art/boss.png")).body.path).toBe("Art/boss 2.png");
  });

  it("is refused over the daily budget, before uploading", async () => {
    state.allowed = false;
    const { status } = await upload("Art/boss.png");
    expect(status).toBe(429);
    expect(state.uploads).toEqual([]);
  });
});
