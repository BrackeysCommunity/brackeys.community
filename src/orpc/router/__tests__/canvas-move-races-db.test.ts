import { call } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  canvasAttachments,
  canvasDocs,
  canvasDocVersions,
  canvases,
  canvasMembers,
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
import { type ImageObjectStore, quarantineImage, restoreImage } from "@/lib/image-quarantine";
import {
  addCanvasMember,
  createCanvas,
  getCanvas,
  getPublicCanvas,
  moveCanvasToTeam,
  removeCanvasMember,
  reportCanvas,
  resolveCanvasReport,
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

describe("move to team: image edge cases", () => {
  it("two cards on one image get one copy; two images clashing in the team get distinct free paths", async () => {
    await db
      .insert(canvasAttachments)
      .values([
        attachment("one", { path: "attachments/shot.png" }),
        attachment("two", { path: "attachments/Shot (1).png" }),
        attachment("taken", { ownerId: "bob", teamId, path: "attachments/shot.png" }),
      ]);
    const id = await imageCanvas("Gallery.canvas", [
      { id: "c1", attachmentId: "one" },
      { id: "c2", attachmentId: "one" },
      { id: "c3", attachmentId: "two" },
    ]);

    await move(id);

    const cards = await storedCardIds(id);
    expect(cards.c1).toBe(cards.c2);
    expect(cards.c1).not.toBe("one");
    expect(cards.c3).not.toBe("two");
    expect(cards.c3).not.toBe(cards.c1);

    const copies = await db
      .select()
      .from(canvasAttachments)
      .where(and(eq(canvasAttachments.teamId, teamId), eq(canvasAttachments.ownerId, "alice")));
    expect(copies).toHaveLength(2);
    const paths = new Set([...copies.map((c) => c.pathKey), "attachments/shot.png"]);
    expect(paths.size).toBe(3);

    const view = await call(getCanvas, { canvasId: id }, asUser("bob"));
    expect(Object.keys(view.attachments).sort()).toEqual(
      [cards.c1 as string, cards.c3 as string].sort(),
    );
  });

  it("a quarantined image stays quarantined in the team copy (no url, flagged)", async () => {
    await db
      .insert(canvasAttachments)
      .values(attachment("bad", { quarantinedAt: new Date("2026-10-01T00:00:00Z") }));
    const id = await imageCanvas("Bad.canvas", [{ id: "c1", attachmentId: "bad" }]);
    await move(id);
    const view = await call(getCanvas, { canvasId: id }, asUser("alice"));
    const [copy] = Object.values(view.attachments);
    expect(copy).toMatchObject({ url: null, quarantined: true });
  });

  it("only the owner's live personal images are copied; other people's and deleted ones are left alone", async () => {
    await db
      .insert(canvasAttachments)
      .values([
        attachment("mine"),
        attachment("bobs", { ownerId: "bob", imageKey: "canvas-images/bob/bobs.png" }),
        attachment("gone", { deletedAt: new Date() }),
      ]);
    const id = await imageCanvas("Mixed.canvas", [
      { id: "c1", attachmentId: "mine" },
      { id: "c2", attachmentId: "bobs" },
      { id: "c3", attachmentId: "gone" },
    ]);
    await move(id);
    const cards = await storedCardIds(id);
    expect(cards.c1).not.toBe("mine");
    expect(cards.c2).toBe("bobs");
    expect(cards.c3).toBe("gone");
    const copies = await db
      .select()
      .from(canvasAttachments)
      .where(eq(canvasAttachments.teamId, teamId));
    expect(copies.map((c) => c.imageKey)).toEqual(["canvas-images/alice/mine.png"]);
  });

  it("a canvas with no stored doc row still moves, copying nothing", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const id = await imageCanvas("NoDoc.canvas", [{ id: "c1", attachmentId: "img" }]);
    await db.delete(canvasDocs).where(eq(canvasDocs.canvasId, id));
    expect(await move(id)).toMatchObject({ teamId, visibility: "team" });
    expect(
      await db.select().from(canvasAttachments).where(eq(canvasAttachments.teamId, teamId)),
    ).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["moved_to_team"]);
  });

  it("a public canvas's copied image is served to anonymous readers after the move", async () => {
    await db.insert(canvasAttachments).values(attachment("pub"));
    const id = await imageCanvas("Pub.canvas", [{ id: "c1", attachmentId: "pub" }], "public");
    await move(id);
    const anon = await call(getPublicCanvas, { canvasId: id }, asUser(null));
    const cards = await storedCardIds(id);
    expect(Object.keys(anon.attachments)).toEqual([cards.c1]);
  });

  it("a quarantine that lands after the move covers the team copy too, and a dismiss restores both", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const key = "canvas-images/alice/img.png";
    await db.insert(imageScans).values({
      objectKey: key,
      ownerType: "canvas_attachment",
      ownerId: "alice",
      uploaderId: "alice",
      status: "scanned",
    });
    const id = await imageCanvas("Q.canvas", [{ id: "c1", attachmentId: "img" }]);
    await move(id);

    await quarantineImage(db as never, fakeStore([key]), key);
    const flagged = await db
      .select()
      .from(canvasAttachments)
      .where(eq(canvasAttachments.imageKey, key));
    expect(flagged).toHaveLength(2);
    expect(flagged.every((row) => row.quarantinedAt != null)).toBe(true);

    await restoreImage(db as never, fakeStore([]), key);
    const restored = await db
      .select()
      .from(canvasAttachments)
      .where(eq(canvasAttachments.imageKey, key));
    expect(restored.every((row) => row.quarantinedAt == null)).toBe(true);
  });

  it("restoring a version from before the move points its images at the team copies", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const id = await imageCanvas("V.canvas", [{ id: "c1", attachmentId: "img" }]);
    const [before] = await db.select().from(canvasDocs).where(eq(canvasDocs.canvasId, id));
    const [version] = await db
      .insert(canvasDocVersions)
      .values({
        docKind: "canvas",
        docId: id,
        reason: "hourly",
        state: before!.state,
        byteSize: before!.state.length,
      })
      .returning({ id: canvasDocVersions.id });
    await move(id);
    const moved = (await storedCardIds(id)).c1;
    expect(moved).not.toBe("img");

    await call(restoreCanvasVersion, { canvasId: id, versionId: version!.id }, asUser("alice"));
    expect((await storedCardIds(id)).c1).toBe(moved);
  });

  it("a move while the image sits in quarantine: a dismiss also restores the team copy", async () => {
    await db.insert(canvasAttachments).values(attachment("img"));
    const key = "canvas-images/alice/img.png";
    await db.insert(imageScans).values({
      objectKey: key,
      ownerType: "canvas_attachment",
      ownerId: "alice",
      uploaderId: "alice",
      status: "scanned",
    });
    const id = await imageCanvas("Q2.canvas", [{ id: "c1", attachmentId: "img" }]);
    await quarantineImage(db as never, fakeStore([key]), key);

    await move(id);

    await restoreImage(db as never, fakeStore([]), key);
    const rows = await db
      .select({ id: canvasAttachments.id, quarantinedAt: canvasAttachments.quarantinedAt })
      .from(canvasAttachments)
      .where(eq(canvasAttachments.imageKey, key));
    expect(rows).toHaveLength(2);
    // The staff dismiss cleared the image; every row using it should come back.
    expect(rows.filter((row) => row.quarantinedAt != null)).toEqual([]);
  });
});

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

describe("move to team: failure and retry paths", () => {
  it("retries a unique-path violation and lands once, with one event", async () => {
    const id = await imageCanvas("Retry.canvas", []);
    const original = db.transaction.bind(db);
    const spy = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      })
      .mockImplementation(original as never);
    expect(await move(id)).toMatchObject({ teamId });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(["moved_to_team"]);
  });

  it("gives up after three unique violations, leaving the canvas personal and silent", async () => {
    const id = await imageCanvas("Stuck.canvas", []);
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "viewer" }, asUser("alice"));
    events = [];
    const spy = vi.spyOn(db, "transaction").mockImplementation(async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });
    await expect(move(id)).rejects.toBeDefined();
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.teamId).toBeNull();
    expect(
      await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id)),
    ).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("does not retry other errors", async () => {
    const id = await imageCanvas("Boom.canvas", []);
    const spy = vi.spyOn(db, "transaction").mockImplementation(async () => {
      throw new Error("connection reset");
    });
    await expect(move(id)).rejects.toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  for (const [label, change] of [
    ["hidden by staff", { hiddenAt: new Date(), hiddenReason: "x" }],
    ["deleted", { deletedAt: new Date() }],
  ] as const) {
    it(`a canvas ${label} between the check and the write is CONFLICT, rolled back and silent`, async () => {
      await db.insert(canvasAttachments).values(attachment("img"));
      const id = await imageCanvas(`Race-${label}.canvas`, [{ id: "c1", attachmentId: "img" }]);
      await call(
        addCanvasMember,
        { canvasId: id, userId: "carol", role: "viewer" },
        asUser("alice"),
      );
      events = [];
      const original = db.transaction.bind(db);
      vi.spyOn(db, "transaction").mockImplementationOnce((async (fn: never) => {
        await db.update(canvases).set(change).where(eq(canvases.id, id));
        return original(fn);
      }) as never);

      await expect(move(id)).rejects.toMatchObject({ code: "CONFLICT" });
      const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
      expect(row!.teamId).toBeNull();
      expect(
        await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id)),
      ).toHaveLength(1);
      expect(
        await db.select().from(canvasAttachments).where(eq(canvasAttachments.teamId, teamId)),
      ).toEqual([]);
      expect(await storedCardIds(id)).toEqual({ c1: "img" });
      expect(events).toEqual([]);
    });
  }

  it("a second move racing the first is CONFLICT, and only one moved_to_team is emitted", async () => {
    const id = await imageCanvas("Twice.canvas", []);
    const results = await Promise.allSettled([move(id), move(id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["CONFLICT", "BAD_REQUEST"]).toContain((failed.reason as { code: string }).code);
    expect(events.filter((e) => e.type === "moved_to_team")).toHaveLength(1);
  });
});

describe("addCanvasMember over the cap", () => {
  async function fill(canvasId: string, n: number) {
    const ids = Array.from({ length: n }, (_, i) => `filler-${i}`);
    for (const fid of ids) await seedUser(db, fid);
    await db
      .insert(canvasMembers)
      .values(ids.map((userId) => ({ canvasId, userId, role: "viewer" })));
  }

  it("an add that lands over 50 backs out: no row, no event, no notice", async () => {
    const id = await imageCanvas("Full.canvas", []);
    await fill(id, 49);
    await seedUser(db, "sneaky");
    // Another add commits between this add's check and its insert.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION canvas.test_sneak() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = 'bob' THEN
          INSERT INTO canvas.canvas_members (canvas_id, user_id, role)
          VALUES (NEW.canvas_id, 'sneaky', 'viewer');
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.execute(sql`
      CREATE TRIGGER test_sneak AFTER INSERT ON canvas.canvas_members
      FOR EACH ROW EXECUTE FUNCTION canvas.test_sneak()`);
    try {
      await expect(
        call(addCanvasMember, { canvasId: id, userId: "bob", role: "viewer" }, asUser("alice")),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      await db.execute(sql`DROP TRIGGER test_sneak ON canvas.canvas_members`);
      await db.execute(sql`DROP FUNCTION canvas.test_sneak()`);
    }
    const rows = await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id));
    expect(rows).toHaveLength(50);
    expect(rows.some((r) => r.userId === "bob")).toBe(false);
    expect(events).toEqual([]);
    expect(await db.select().from(notifications).where(eq(notifications.userId, "bob"))).toEqual(
      [],
    );
  });

  it("concurrent adds near the cap: events and notices match exactly the people who got in", async () => {
    const id = await imageCanvas("Busy.canvas", []);
    await fill(id, 48);
    const people = ["bob", "carol", "stranger", "staff"];
    const results = await Promise.allSettled(
      people.map((userId) =>
        call(addCanvasMember, { canvasId: id, userId, role: "viewer" }, asUser("alice")),
      ),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as { code: string }).code).toBe("BAD_REQUEST");
      }
    }
    const rows = await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id));
    expect(rows.length).toBeLessThanOrEqual(50);
    const added = rows.map((r) => r.userId).filter((u) => people.includes(u));
    expect(
      events
        .filter((e) => e.type === "member_added")
        .map((e) => (e as { userId: string }).userId)
        .sort(),
    ).toEqual([...added].sort());
    const notices = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.type, "canvas_shared_with_you"));
    expect(notices.map((n) => n.userId).sort()).toEqual([...added].sort());
  });
});

describe("reportCanvas: people on the canvas", () => {
  it("a refused report from the owner doesn't spend the report bucket", async () => {
    const id = await imageCanvas("Mine.canvas", [], "public");
    await expect(
      call(reportCanvas, { canvasId: id, reason: "x" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rate.counters.get("report:alice")).toBeUndefined();
  });

  it("a member who leaves can report afterwards; staff can report a canvas they're not on", async () => {
    const id = await imageCanvas("Shared.canvas", [], "public");
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "editor" }, asUser("alice"));
    await expect(
      call(reportCanvas, { canvasId: id, reason: "x" }, asUser("carol")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await call(removeCanvasMember, { canvasId: id }, asUser("carol"));
    expect(await call(reportCanvas, { canvasId: id, reason: "x" }, asUser("carol"))).toHaveProperty(
      "id",
    );
    expect(await call(reportCanvas, { canvasId: id, reason: "y" }, asUser("staff"))).toHaveProperty(
      "id",
    );
  });

  it("a team member reporting a public team canvas is refused; the canvas's former owner is not special-cased once moved", async () => {
    const id = await imageCanvas("TeamPub.canvas", [], "public");
    await move(id);
    for (const by of ["alice", "bob"]) {
      await expect(
        call(reportCanvas, { canvasId: id, reason: "x" }, asUser(by)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(
      await call(reportCanvas, { canvasId: id, reason: "x" }, asUser("stranger")),
    ).toHaveProperty("id");
  });
});

describe("resolveCanvasReport: hide reason edge cases", () => {
  it("a hide reason over 500 characters is refused and nothing is hidden", async () => {
    const id = await imageCanvas("Long.canvas", [], "public");
    const { id: reportId } = await call(
      reportCanvas,
      { canvasId: id, reason: "spam" },
      asUser("stranger"),
    );
    await expect(
      call(
        resolveCanvasReport,
        { reportId, action: "hide_canvas", reason: "x".repeat(501) },
        asUser("staff"),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.hiddenAt).toBeNull();
    const [open] = await db.select().from(canvasReports).where(eq(canvasReports.id, reportId));
    expect(open!.resolvedAt).toBeNull();
  });

  it("an already-hidden canvas still needs a reason on the hide_canvas path", async () => {
    const id = await imageCanvas("Again.canvas", [], "public");
    const { id: reportId } = await call(
      reportCanvas,
      { canvasId: id, reason: "spam" },
      asUser("stranger"),
    );
    await db
      .update(canvases)
      .set({ hiddenAt: new Date(), hiddenReason: "first" })
      .where(eq(canvases.id, id));
    await expect(
      call(resolveCanvasReport, { reportId, action: "hide_canvas" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Dismiss still works without one.
    expect(
      await call(resolveCanvasReport, { reportId, action: "dismiss" }, asUser("staff")),
    ).toEqual({ success: true });
  });
});
