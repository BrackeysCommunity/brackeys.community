import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { canvases, user } from "@/db/schema";
import { createCanvas, setCanvasHidden, setCanvasVisibility } from "@/orpc/router/canvas";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
  withErrorReporting: (_route: string, fn: unknown) => fn,
}));
/** The card data reads through the public client: here, straight into the real procedure. */
vi.mock("@/orpc/client", async () => {
  const { call: callProcedure } = await import("@orpc/server");
  const { getPublicCanvas } = await import("@/orpc/router/canvas");
  return {
    client: {
      getPublicCanvas: (input: { canvasId: string }) =>
        callProcedure(getPublicCanvas, input, { context: { headers: new Headers() } }),
    },
    orpc: {},
  };
});

import { Route } from "../og.$";

const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.GET;

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  await db.delete(canvases);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "alice");
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
});

async function canvas(visibility: "private" | "unlisted" | "public", path = "Ideas.canvas") {
  const { id } = await call(createCanvas, { scope: { kind: "personal" }, path }, asUser("alice"));
  await db
    .update(canvases)
    .set({
      snapshot: {
        nodes: [{ id: "a", type: "text", text: "hi", x: 0, y: 0, width: 200, height: 100 }],
        edges: [],
      },
      nodeCount: 1,
    })
    .where(eq(canvases.id, id));
  if (visibility !== "private") {
    await call(setCanvasVisibility, { canvasId: id, visibility }, asUser("alice"));
  }
  return id;
}

const og = (id: string) =>
  GET({ request: new Request(`https://example.test/og/canvas/${id}.png`) });

describe("/og/canvas/<id>.png", { timeout: 60_000 }, () => {
  it("is a 200 PNG card for a public canvas", async () => {
    const id = await canvas("public");
    const response = await og(id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("cdn-cache-control")).toBeNull();
  });

  it("is a 200 card for an unlisted canvas, marked noindex", async () => {
    const id = await canvas("unlisted", "Unl.canvas");
    const response = await og(id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cdn-cache-control")).toBe("max-age=300");

    await call(setCanvasVisibility, { canvasId: id, visibility: "private" }, asUser("alice"));
    expect((await og(id)).status).toBe(404);
  });

  it("is the 404 card for private, hidden, deleted and unknown canvases", async () => {
    const unl = await canvas("unlisted", "UnlHidden.canvas");
    await call(setCanvasHidden, { canvasId: unl, hidden: true, reason: "x" }, asUser("staff"));
    const priv = await canvas("private", "Priv.canvas");
    const hidden = await canvas("public", "Hidden.canvas");
    await call(setCanvasHidden, { canvasId: hidden, hidden: true, reason: "x" }, asUser("staff"));
    const deleted = await canvas("public", "Deleted.canvas");
    await db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, deleted));

    for (const id of [unl, priv, hidden, deleted, "00000000-0000-0000-0000-000000000000", "x"]) {
      const response = await og(id);
      expect(response.status, id).toBe(404);
      expect(response.headers.get("content-type")).toBe("image/png");
    }

    // Unhiding brings the card back.
    await call(setCanvasHidden, { canvasId: hidden, hidden: false }, asUser("staff"));
    expect((await og(hidden)).status).toBe(200);
  });
});
