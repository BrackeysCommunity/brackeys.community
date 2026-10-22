import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { canvases, canvasMembers, canvasReports, teamMembers, teams, user } from "@/db/schema";
import { cleanupUserData } from "@/lib/account-deletion";
import { type CanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";
import {
  addCanvasMember,
  createCanvas,
  deleteCanvas,
  listCanvasReports,
  reportCanvas,
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
  purgeGuildMemberCache: async () => {},
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
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => true,
  assertRateLimit: async () => {},
}));
vi.mock("@/lib/profile-project-image-storage", () => ({
  removeProfileProjectImageFromStorage: async () => {},
}));

let db: TestDb;
let teamId: string;
let events: CanvasEvent[] = [];
let stopListening: () => void = () => {};

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  await db.delete(canvasReports);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "bob" })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "bob", role: "owner" },
    { teamId, userId: "alice", role: "member" },
  ]);
  events = [];
  stopListening = onCanvasEvent((event) => events.push(event));
});
afterEach(() => stopListening());

async function canvas(owner: string, path: string, scope: "personal" | "team" = "personal") {
  const { id } = await call(
    createCanvas,
    { scope: scope === "team" ? { kind: "team", teamId } : { kind: "personal" }, path },
    asUser(owner),
  );
  return id;
}

/** better-auth's delete: the app hook, then the user row (cascades follow). */
async function deleteAccount(userId: string) {
  await cleanupUserData(userId);
  await db.delete(user).where(eq(user.id, userId));
}

describe("E11 account deletion and canvases", () => {
  it("removes personal canvases, drops memberships, keeps reports with their title, emits after the deletes", async () => {
    const mine = await canvas("alice", "Mine.canvas");
    await call(setCanvasVisibility, { canvasId: mine, visibility: "public" }, asUser("alice"));
    await call(
      addCanvasMember,
      { canvasId: mine, userId: "carol", role: "editor" },
      asUser("alice"),
    );
    const bobs = await canvas("bob", "Bobs.canvas");
    await call(addCanvasMember, { canvasId: bobs, userId: "alice", role: "viewer" }, asUser("bob"));
    const teamOne = await canvas("alice", "Team.canvas", "team");
    await call(reportCanvas, { canvasId: mine, reason: "spam" }, asUser("bob"));
    // A report alice filed goes with her account (reporter cascade).
    const carols = await canvas("carol", "Carols.canvas");
    await call(setCanvasVisibility, { canvasId: carols, visibility: "public" }, asUser("carol"));
    await call(reportCanvas, { canvasId: carols, reason: "meh" }, asUser("alice"));

    events = [];
    const seenRows: Promise<number>[] = [];
    const off = onCanvasEvent((event) => {
      if (event.type === "deleted") {
        seenRows.push(
          db
            .select({ id: canvases.id })
            .from(canvases)
            .where(eq(canvases.id, event.canvasId))
            .then((rows) => rows.length),
        );
      }
    });
    await deleteAccount("alice");
    off();

    expect(await db.select().from(canvases).where(eq(canvases.id, mine))).toEqual([]);
    expect(await db.select().from(canvasMembers).where(eq(canvasMembers.userId, "alice"))).toEqual(
      [],
    );
    expect(await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, mine))).toEqual(
      [],
    );
    // The team canvas stays with the team, its owner id nulled.
    const [team] = await db.select().from(canvases).where(eq(canvases.id, teamOne));
    expect(team).toMatchObject({ teamId, ownerId: null, deletedAt: null });

    const reports = await db.select().from(canvasReports);
    expect(reports.map((r) => [r.canvasId, r.canvasTitle, r.reporterId])).toEqual([
      [null, "Mine", "bob"],
    ]);
    const queue = await call(listCanvasReports, {}, asUser("staff"));
    expect(queue).toMatchObject([{ canvasId: null, canvasTitle: "Mine", liveTitle: null }]);

    expect(events).toEqual([
      { type: "deleted", canvasId: mine, scope: { kind: "personal", ownerId: "alice" } },
      {
        type: "member_removed",
        canvasId: bobs,
        scope: { kind: "personal", ownerId: "bob" },
        userId: "alice",
      },
    ]);
    expect(events.flatMap(revokesFor)).toEqual([
      { canvasId: mine },
      { canvasId: bobs, userId: "alice" },
    ]);
    // Emitted only once the row was already gone.
    expect(await Promise.all(seenRows)).toEqual([0]);
  });

  it("a user with no canvases emits nothing, and an unknown user is a no-op", async () => {
    await deleteAccount("carol");
    await cleanupUserData("nobody");
    expect(events).toEqual([]);
  });

  it("deleting the owner of a canvas they shared tells nobody's membership twice", async () => {
    const mine = await canvas("alice", "Mine.canvas");
    await call(addCanvasMember, { canvasId: mine, userId: "bob", role: "viewer" }, asUser("alice"));
    events = [];
    await deleteAccount("alice");
    // The canvas going covers its members: one deleted event, no member_removed for bob.
    expect(events.map((e) => e.type)).toEqual(["deleted"]);
  });

  it("a canvas already in Recently deleted isn't announced a second time", async () => {
    const gone = await canvas("alice", "Gone.canvas");
    const live = await canvas("alice", "Live.canvas");
    await call(deleteCanvas, { canvasId: gone }, asUser("alice"));
    events = [];
    await deleteAccount("alice");
    expect(await db.select().from(canvases).where(eq(canvases.ownerId, "alice"))).toEqual([]);
    expect(events).toEqual([
      { type: "deleted", canvasId: live, scope: { kind: "personal", ownerId: "alice" } },
    ]);
  });
});
