import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { canvases, canvasMembers, teamMembers, teams, user } from "@/db/schema";
import { type CanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";
import {
  addCanvasMember,
  createCanvas,
  moveCanvasToTeam,
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
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => true,
  assertRateLimit: async () => {},
}));

type Visibility = "private" | "unlisted" | "public";

let db: TestDb;
let teamId: string;
let events: CanvasEvent[] = [];
let stopListening: () => void = () => {};

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
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

async function personal(owner: string, visibility: Visibility, path = "Board.canvas") {
  const { id } = await call(createCanvas, { scope: { kind: "personal" }, path }, asUser(owner));
  if (visibility !== "private") {
    await call(setCanvasVisibility, { canvasId: id, visibility }, asUser(owner));
  }
  events = [];
  return id;
}

const move = (canvasId: string, by: string) =>
  call(moveCanvasToTeam, { canvasId, teamId }, asUser(by));

async function stored(canvasId: string) {
  const [row] = await db
    .select({ visibility: canvases.visibility, teamId: canvases.teamId })
    .from(canvases)
    .where(eq(canvases.id, canvasId));
  return row;
}

/** Runs `write` after the move's checks, right before its transaction opens. */
function beforeTransaction(write: () => PromiseLike<unknown>) {
  const original = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementationOnce((async (fn: never) => {
    await write();
    return original(fn);
  }) as never);
}

describe("moving a shared personal canvas into a team", () => {
  for (const visibility of ["public", "unlisted"] as const) {
    it(`a plain member's ${visibility} canvas arrives at "team"`, async () => {
      const id = await personal("bob", visibility);
      expect(await move(id, "bob")).toMatchObject({
        teamId,
        visibility: "team",
        linkTurnedOff: true,
      });
      expect(await stored(id)).toEqual({ teamId, visibility: "team" });
    });

    it(`a team owner's ${visibility} canvas keeps its visibility`, async () => {
      const id = await personal("alice", visibility);
      expect(await move(id, "alice")).toMatchObject({ teamId, visibility, linkTurnedOff: false });
      expect(await stored(id)).toEqual({ teamId, visibility });
    });
  }

  it("the capped move still revokes open connections and drops invited members", async () => {
    const id = await personal("bob", "public");
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "editor" }, asUser("bob"));
    events = [];
    await move(id, "bob");
    expect(events.map((e) => e.type)).toEqual(["moved_to_team", "member_removed"]);
    expect(revokesFor(events[0]!)).toEqual([{ canvasId: id }]);
    expect(revokesFor(events[1]!)).toEqual([{ canvasId: id, userId: "carol" }]);
    expect(await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id))).toEqual([]);
  });
});

describe("changes landing between the move's checks and its write", () => {
  it('an owner demoted first moves a public canvas in at "team"', async () => {
    const id = await personal("alice", "public");
    beforeTransaction(() =>
      db
        .update(teamMembers)
        .set({ role: "member" })
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, "alice"))),
    );
    expect(await move(id, "alice")).toMatchObject({ visibility: "team" });
    expect(await stored(id)).toEqual({ teamId, visibility: "team" });
  });

  it("a member removed from the team first can't move, and the canvas stays personal", async () => {
    const id = await personal("bob", "public");
    beforeTransaction(() => db.delete(teamMembers).where(eq(teamMembers.userId, "bob")));
    await expect(move(id, "bob")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await stored(id)).toEqual({ teamId: null, visibility: "public" });
    expect(events).toEqual([]);
  });

  it("a widening that lands first isn't reverted for a team owner", async () => {
    const id = await personal("alice", "unlisted");
    beforeTransaction(() =>
      db.update(canvases).set({ visibility: "public" }).where(eq(canvases.id, id)),
    );
    expect(await move(id, "alice")).toMatchObject({ visibility: "public" });
    expect(await stored(id)).toEqual({ teamId, visibility: "public" });
  });

  it("a widening that lands first is still capped for a plain member", async () => {
    const id = await personal("bob", "private");
    beforeTransaction(() =>
      db.update(canvases).set({ visibility: "public" }).where(eq(canvases.id, id)),
    );
    expect(await move(id, "bob")).toMatchObject({ visibility: "team" });
    expect(await stored(id)).toEqual({ teamId, visibility: "team" });
  });

  it("a team archived first refuses the move, and the canvas stays personal", async () => {
    const id = await personal("alice", "public");
    beforeTransaction(() =>
      db.update(teams).set({ status: "archived" }).where(eq(teams.id, teamId)),
    );
    await expect(move(id, "alice")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "That team is archived, so canvases can't be added to it.",
    });
    expect(await stored(id)).toEqual({ teamId: null, visibility: "public" });
    expect(events).toEqual([]);
  });

  it("a team hidden by staff first refuses the move, and the canvas stays personal", async () => {
    const id = await personal("alice", "public");
    beforeTransaction(() =>
      db.update(teams).set({ hiddenAt: new Date() }).where(eq(teams.id, teamId)),
    );
    await expect(move(id, "alice")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Staff have hidden that team.",
    });
    expect(await stored(id)).toEqual({ teamId: null, visibility: "public" });
    expect(events).toEqual([]);
  });

  it('a narrowing to private that lands first maps to "team"', async () => {
    const id = await personal("alice", "public");
    beforeTransaction(() =>
      db.update(canvases).set({ visibility: "private" }).where(eq(canvases.id, id)),
    );
    expect(await move(id, "alice")).toMatchObject({ visibility: "team", linkTurnedOff: false });
    expect(await stored(id)).toEqual({ teamId, visibility: "team" });
  });
});
