import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  canvasAttachments,
  canvasDocs,
  canvasDocVersions,
  canvases,
  canvasReports,
  imageScans,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { type CanvasEvent, onCanvasEvent } from "@/lib/canvas-events";
import { docFromState } from "@/lib/canvas/doc-state";
import { bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas } from "@/lib/canvas/json-canvas";
import {
  type ImageObjectStore,
  purgeImage,
  quarantineImage,
  restoreImage,
} from "@/lib/image-quarantine";
import {
  createCanvas,
  getCanvas,
  moveCanvasToTeam,
  restoreCanvasVersion,
  setCanvasVisibility,
} from "@/orpc/router/canvas";
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
}));
const rate = vi.hoisted(() => ({ counters: new Map<string, number>() }));
vi.mock("@/lib/rate-limit", async () => {
  const { ORPCError } = await import("@orpc/client");
  return {
    checkRateLimit: async () => true,
    assertRateLimit: async (bucket: string, userId: string, limit: number, message: string) => {
      const key = `${bucket}:${userId}`;
      const next = (rate.counters.get(key) ?? 0) + 1;
      rate.counters.set(key, next);
      if (next > limit) throw new ORPCError("TOO_MANY_REQUESTS", { message });
    },
  };
});

let db: TestDb;
let teamId: string;
let events: CanvasEvent[] = [];
let stopListening: () => void = () => {};

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  rate.counters.clear();
  await db.delete(canvasReports);
  await db.delete(notifications);
  await db.delete(imageScans);
  await db.delete(canvasAttachments);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol", "stranger"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "alice" })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "alice", role: "owner" },
    { teamId, userId: "bob", role: "member" },
  ]);
  events = [];
  stopListening = onCanvasEvent((event) => events.push(event));
});
afterEach(() => {
  stopListening();
  vi.restoreAllMocks();
});

type ImageCard = { id: string; attachmentId: string };

async function imageCanvas(path: string, cards: ImageCard[], visibility?: "public") {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, {
    nodes: cards.map((card, i) => ({
      id: card.id,
      type: "file",
      file: `attachments/${card.attachmentId}.png`,
      x: i * 20,
      y: 0,
      width: 10,
      height: 10,
      jamsTeam: { type: "image", attachmentId: card.attachmentId },
    })),
  });
  const { id } = await call(
    createCanvas,
    { scope: { kind: "personal" }, path, initialState: bytesToBase64(Y.encodeStateAsUpdate(doc)) },
    asUser("alice"),
  );
  if (visibility) {
    await call(setCanvasVisibility, { canvasId: id, visibility }, asUser("alice"));
  }
  events = [];
  return id;
}

function attachment(id: string, overrides: Partial<typeof canvasAttachments.$inferInsert> = {}) {
  return {
    id,
    ownerId: "alice",
    path: `attachments/${id}.png`,
    imageKey: `canvas-images/alice/${id}.png`,
    sha256: `sha-${id}`,
    byteSize: 10,
    ...overrides,
  };
}

async function storedCardIds(canvasId: string): Promise<Record<string, unknown>> {
  const [row] = await db.select().from(canvasDocs).where(eq(canvasDocs.canvasId, canvasId));
  const doc = docFromState(new Uint8Array(row!.state));
  // Card ids are re-minted on create, so cards are named c1, c2… by position.
  const nodes = [...doc.getMap<Y.Map<unknown>>("nodes").values()].sort(
    (a, b) => (a.get("x") as number) - (b.get("x") as number),
  );
  return Object.fromEntries(nodes.map((node, i) => [`c${i + 1}`, node.get("attachmentId")]));
}

const move = (canvasId: string, by = "alice") =>
  call(moveCanvasToTeam, { canvasId, teamId }, asUser(by));

function fakeStore(initial: string[]): ImageObjectStore {
  const objects = new Set(initial);
  return {
    async move(from, to) {
      if (!objects.has(from)) return;
      objects.delete(from);
      objects.add(to);
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

const KEY = "canvas-images/alice/img.png";

async function scanRow(objectKey = KEY) {
  await db.insert(imageScans).values({
    objectKey,
    ownerType: "canvas_attachment",
    ownerId: "alice",
    uploaderId: "alice",
    status: "scanned",
  });
}

async function rowsFor(objectKey = KEY) {
  return db
    .select({
      id: canvasAttachments.id,
      teamId: canvasAttachments.teamId,
      quarantinedAt: canvasAttachments.quarantinedAt,
      deletedAt: canvasAttachments.deletedAt,
    })
    .from(canvasAttachments)
    .where(eq(canvasAttachments.imageKey, objectKey));
}

async function versionOf(canvasId: string, state?: Uint8Array) {
  let bytes = state ? Buffer.from(state) : undefined;
  if (!bytes) {
    const [row] = await db.select().from(canvasDocs).where(eq(canvasDocs.canvasId, canvasId));
    bytes = Buffer.from(row!.state);
  }
  const [version] = await db
    .insert(canvasDocVersions)
    .values({
      docKind: "canvas",
      docId: canvasId,
      reason: "hourly",
      state: bytes,
      byteSize: bytes.length,
    })
    .returning({ id: canvasDocVersions.id });
  return version!.id;
}

describe("dismissing a quarantined image restores by key", () => {
  it("only rows of the dismissed key come back; another quarantined key stays put", async () => {
    const other = "canvas-images/alice/other.png";
    await db
      .insert(canvasAttachments)
      .values([attachment("img"), attachment("other", { imageKey: other })]);
    await scanRow();
    await scanRow(other);
    const id = await imageCanvas("Two.canvas", [
      { id: "c1", attachmentId: "img" },
      { id: "c2", attachmentId: "other" },
    ]);
    await quarantineImage(db as never, fakeStore([KEY]), KEY);
    await quarantineImage(db as never, fakeStore([other]), other);
    await move(id);

    await restoreImage(db as never, fakeStore([]), KEY);

    expect((await rowsFor()).every((row) => row.quarantinedAt == null)).toBe(true);
    const otherRows = await rowsFor(other);
    expect(otherRows).toHaveLength(2);
    expect(otherRows.every((row) => row.quarantinedAt != null)).toBe(true);
    const view = await call(getCanvas, { canvasId: id }, asUser("bob"));
    const cards = await storedCardIds(id);
    expect(view.attachments[cards.c1 as string]).toMatchObject({ quarantined: false });
    expect(view.attachments[cards.c2 as string]).toMatchObject({ quarantined: true, url: null });
  });

  it("a purge after the move keeps both rows quarantined, and a later dismiss can't bring them back", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    await scanRow();
    const id = await imageCanvas("Purge.canvas", [{ id: "c1", attachmentId: "img" }]);
    await quarantineImage(db as never, fakeStore([KEY]), KEY);
    await move(id);

    await purgeImage(db as never, fakeStore([]), KEY);
    await restoreImage(db as never, fakeStore([]), KEY);

    const rows = await rowsFor();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.quarantinedAt != null)).toBe(true);
    const view = await call(getCanvas, { canvasId: id }, asUser("bob"));
    const card = (await storedCardIds(id)).c1 as string;
    expect(view.attachments[card]).toMatchObject({ quarantined: true, url: null });
  });

  it("a second dismiss is a no-op, and a soft-deleted row is un-quarantined but stays deleted", async () => {
    await db
      .insert(canvasAttachments)
      .values(attachment("img", { deletedAt: new Date("2026-01-01T00:00:00Z") }));
    await db
      .insert(canvasAttachments)
      .values(attachment("img2", { imageKey: KEY, path: "attachments/b.png" }));
    await scanRow();
    await quarantineImage(db as never, fakeStore([KEY]), KEY);
    expect((await rowsFor()).every((row) => row.quarantinedAt != null)).toBe(true);

    expect(await restoreImage(db as never, fakeStore([]), KEY)).toBe(true);
    expect(await restoreImage(db as never, fakeStore([]), KEY)).toBe(true);

    const rows = await rowsFor();
    expect(rows.every((row) => row.quarantinedAt == null)).toBe(true);
    expect(rows.find((row) => row.id === "img")!.deletedAt).not.toBeNull();
    const [scan] = await db.select().from(imageScans).where(eq(imageScans.objectKey, KEY));
    expect(scan).toMatchObject({ status: "cleared", detached: null });
  });

  it("a later re-quarantine of the same key covers the team copy as well", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    await scanRow();
    const id = await imageCanvas("Again.canvas", [{ id: "c1", attachmentId: "img" }]);
    await quarantineImage(db as never, fakeStore([KEY]), KEY);
    await move(id);
    await restoreImage(db as never, fakeStore([]), KEY);
    // A cleared scan is never re-quarantined by a detector.
    expect(await quarantineImage(db as never, fakeStore([KEY]), KEY)).toBeNull();
    await db.update(imageScans).set({ status: "scanned" }).where(eq(imageScans.objectKey, KEY));
    await quarantineImage(db as never, fakeStore([KEY]), KEY);
    expect((await rowsFor()).every((row) => row.quarantinedAt != null)).toBe(true);
  });
});

describe("restoring a pre-move version", () => {
  it("returns the remapped ids in the update sent back to the caller's tab", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const id = await imageCanvas("Tab.canvas", [{ id: "c1", attachmentId: "img" }]);
    const versionId = await versionOf(id);
    await move(id);
    const copy = (await storedCardIds(id)).c1 as string;

    const [row] = await db.select().from(canvasDocs).where(eq(canvasDocs.canvasId, id));
    const tab = docFromState(new Uint8Array(row!.state));
    const result = await call(
      restoreCanvasVersion,
      { canvasId: id, versionId, stateVector: bytesToBase64(Y.encodeStateVector(tab)) },
      asUser("alice"),
    );
    expect(result.update).not.toBeNull();
    Y.applyUpdate(tab, Uint8Array.from(Buffer.from(result.update!, "base64")));
    const ids = [...tab.getMap<Y.Map<unknown>>("nodes").values()].map((n) => n.get("attachmentId"));
    expect(ids).toEqual([copy]);
    expect(ids).not.toContain("img");
    const view = await call(getCanvas, { canvasId: id }, asUser("bob"));
    expect(Object.keys(view.attachments)).toEqual([copy]);
  });

  it("prefers the oldest live team row for the image; a deleted copy falls through to the next one", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const id = await imageCanvas("Old.canvas", [{ id: "c1", attachmentId: "img" }]);
    const versionId = await versionOf(id);
    await move(id);
    const copy = (await storedCardIds(id)).c1 as string;
    await db.insert(canvasAttachments).values(
      attachment("later", {
        teamId,
        path: "attachments/later.png",
        imageKey: KEY,
        createdAt: new Date(Date.now() + 60_000),
      }),
    );

    await call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("alice"));
    expect((await storedCardIds(id)).c1).toBe(copy);

    await db
      .update(canvasAttachments)
      .set({ deletedAt: new Date() })
      .where(eq(canvasAttachments.id, copy));
    await call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("alice"));
    expect((await storedCardIds(id)).c1).toBe("later");
  });

  it("an image the move never copied keeps its personal id, and the restore still succeeds", async () => {
    await db
      .insert(canvasAttachments)
      .values([
        attachment("img"),
        attachment("extra", { imageKey: "canvas-images/alice/extra.png" }),
      ]);
    const id = await imageCanvas("Extra.canvas", [{ id: "c1", attachmentId: "img" }]);
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: [
        {
          id: "v1",
          type: "file",
          file: "attachments/extra.png",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          jamsTeam: { type: "image", attachmentId: "extra" },
        },
      ],
    });
    const versionId = await versionOf(id, Y.encodeStateAsUpdate(doc));
    await move(id);

    await call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("alice"));
    expect(Object.values(await storedCardIds(id))).toEqual(["extra"]);
    const teamExtras = await db
      .select()
      .from(canvasAttachments)
      .where(
        and(
          eq(canvasAttachments.teamId, teamId),
          eq(canvasAttachments.imageKey, "canvas-images/alice/extra.png"),
        ),
      );
    expect(teamExtras).toEqual([]);
  });

  it("staff restoring the moved canvas remap too, and the edit is stored as a staff version", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const id = await imageCanvas("Staff.canvas", [{ id: "c1", attachmentId: "img" }]);
    const versionId = await versionOf(id);
    await move(id);
    const copy = (await storedCardIds(id)).c1;

    await call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("staff"));
    expect((await storedCardIds(id)).c1).toBe(copy);
    const reasons = await db
      .select({ reason: canvasDocVersions.reason })
      .from(canvasDocVersions)
      .where(eq(canvasDocVersions.docId, id));
    expect(reasons.map((r) => r.reason)).toContain("staff");
  });

  it("a team member with write access can't restore, and a personal canvas restore is untouched by the remap", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const id = await imageCanvas("Mine.canvas", [{ id: "c1", attachmentId: "img" }]);
    const versionId = await versionOf(id);
    await call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("alice"));
    expect((await storedCardIds(id)).c1).toBe("img");

    await move(id);
    await expect(
      call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(restoreCanvasVersion, { canvasId: id, versionId }, asUser("stranger")),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });
});
