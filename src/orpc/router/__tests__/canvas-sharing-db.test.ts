import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canvases,
  canvasMembers,
  canvasReports,
  moderationActions,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { type CanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";
import { reopenReport } from "@/orpc/router/admin";
import {
  addCanvasMember,
  createCanvas,
  getCanvas,
  getPublicCanvas,
  listCanvasMembers,
  listCanvasReports,
  listPublicCanvases,
  listSharedCanvases,
  moveCanvasToTeam,
  removeCanvasMember,
  reportCanvas,
  resolveCanvasReport,
  setCanvasHidden,
  setCanvasVisibility,
  updateCanvasMember,
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
const nonMembers = new Set<string>();
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async (discordId: string) => !nonMembers.has(discordId),
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
let canvasesEnabled = true;
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => canvasesEnabled,
}));
vi.mock("@/lib/rate-limit", async () => {
  const { ORPCError } = await import("@orpc/client");
  const counters = new Map<string, number>();
  return {
    checkRateLimit: async () => true,
    assertRateLimit: async (bucket: string, userId: string, limit: number, message: string) => {
      const key = `${bucket}:${userId}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
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
  canvasesEnabled = true;
  nonMembers.clear();
  await db.delete(canvasReports);
  await db.delete(moderationActions);
  await db.delete(notifications);
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
afterEach(() => stopListening());

async function personalCanvas(userId = "alice", path = "Plan.canvas") {
  const { id } = await call(createCanvas, { scope: { kind: "personal" }, path }, asUser(userId));
  return id;
}

async function teamCanvas(path = "Board.canvas") {
  const { id } = await call(
    createCanvas,
    { scope: { kind: "team", teamId }, path },
    asUser("alice"),
  );
  return id;
}

const setVisibility = (userId: string, canvasId: string, visibility: string) =>
  call(
    setCanvasVisibility,
    { canvasId, visibility: visibility as "private" | "team" | "unlisted" | "public" },
    asUser(userId),
  );

describe("setCanvasVisibility", () => {
  it("takes the values that fit the canvas's kind, from its owner only", async () => {
    const mine = await personalCanvas();
    const team = await teamCanvas();

    await expect(setVisibility("alice", mine, "team")).rejects.toThrow(/personal canvas/);
    await expect(setVisibility("alice", team, "private")).rejects.toThrow(/team canvas/);
    await expect(setVisibility("bob", team, "public")).rejects.toThrow(/owner/);
    await expect(setVisibility("stranger", mine, "public")).rejects.toThrow(/not found/i);

    await setVisibility("alice", mine, "public");
    await setVisibility("alice", team, "unlisted");
    expect(events.map((e) => e.type)).toEqual(["visibility_changed", "visibility_changed"]);

    // Unchanged: no write, no event.
    await setVisibility("alice", mine, "public");
    expect(events).toHaveLength(2);
  });

  it("refuses an owner outside the guild and a hidden canvas", async () => {
    const mine = await personalCanvas();
    nonMembers.add("discord-alice");
    await expect(setVisibility("alice", mine, "public")).rejects.toThrow(/only view/);
    nonMembers.clear();
    await db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, mine));
    await expect(setVisibility("alice", mine, "public")).rejects.toThrow(/only view/);
  });

  it("lets a team canvas's editors narrow it but only its owners widen it", async () => {
    const team = await teamCanvas();

    await expect(setVisibility("bob", team, "public")).rejects.toThrow(/team's owners/);
    await expect(setVisibility("bob", team, "unlisted")).rejects.toThrow(/team's owners/);
    expect((await call(getCanvas, { canvasId: team }, asUser("bob"))).visibility).toBe("team");

    await setVisibility("alice", team, "public");
    await setVisibility("bob", team, "unlisted");
    await expect(setVisibility("bob", team, "public")).rejects.toThrow(/team's owners/);
    await setVisibility("bob", team, "team");
    expect(events.map((e) => e.type === "visibility_changed" && [e.from, e.to])).toEqual([
      ["team", "public"],
      ["public", "unlisted"],
      ["unlisted", "team"],
    ]);

    const bobView = await call(getCanvas, { canvasId: team }, asUser("bob"));
    expect(bobView).toMatchObject({ canChangeVisibility: true, canWidenVisibility: false });
    const aliceView = await call(getCanvas, { canvasId: team }, asUser("alice"));
    expect(aliceView).toMatchObject({ canChangeVisibility: true, canWidenVisibility: true });
  });

  it("keeps a personal canvas's visibility with its owner, even against an invited editor", async () => {
    const mine = await personalCanvas();
    await setVisibility("alice", mine, "public");
    await call(addCanvasMember, { canvasId: mine, userId: "bob", role: "editor" }, asUser("alice"));

    await expect(setVisibility("bob", mine, "private")).rejects.toThrow(/canvas's owner/);
    await expect(setVisibility("bob", mine, "public")).rejects.toThrow(/canvas's owner/);
    const bobView = await call(getCanvas, { canvasId: mine }, asUser("bob"));
    expect(bobView).toMatchObject({
      visibility: "public",
      canChangeVisibility: false,
      canWidenVisibility: false,
    });
  });
});

describe("members", () => {
  it("adds once with one notice, changes role, removes, and lets a member leave", async () => {
    const id = await personalCanvas();
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "viewer" }, asUser("alice"));
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "viewer" }, asUser("alice"));
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "editor" }, asUser("alice"));

    const notices = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "canvas_shared_with_you"));
    expect(notices.map((n) => n.userId).sort()).toEqual(["bob", "carol"]);

    const bobView = await call(getCanvas, { canvasId: id }, asUser("bob"));
    expect(bobView).toMatchObject({ access: "read", memberRole: "viewer", isMember: true });
    expect(bobView.canShare).toBe(false);

    const listed = await call(listCanvasMembers, { canvasId: id }, asUser("bob"));
    expect(listed.map((m) => [m.userId, m.role])).toEqual([
      ["bob", "viewer"],
      ["carol", "editor"],
    ]);
    await expect(call(listCanvasMembers, { canvasId: id }, asUser("stranger"))).rejects.toThrow();

    await call(
      updateCanvasMember,
      { canvasId: id, userId: "bob", role: "editor" },
      asUser("alice"),
    );
    expect((await call(getCanvas, { canvasId: id }, asUser("bob"))).access).toBe("write");

    await call(removeCanvasMember, { canvasId: id, userId: "carol" }, asUser("alice"));
    await call(removeCanvasMember, { canvasId: id, userId: "bob" }, asUser("bob"));
    await expect(call(getCanvas, { canvasId: id }, asUser("bob"))).rejects.toThrow(/not found/i);

    expect(events.map((e) => e.type)).toEqual([
      "member_added",
      "member_added",
      "member_role_changed",
      "member_removed",
      "member_removed",
    ]);
  });

  it("refuses team canvases, self, strangers removing others, and the cap", async () => {
    const team = await teamCanvas();
    await expect(
      call(addCanvasMember, { canvasId: team, userId: "carol", role: "viewer" }, asUser("alice")),
    ).rejects.toThrow(/roster/);

    const id = await personalCanvas();
    await expect(
      call(addCanvasMember, { canvasId: id, userId: "alice", role: "viewer" }, asUser("alice")),
    ).rejects.toThrow(/already your canvas/);
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "viewer" }, asUser("alice"));
    await expect(
      call(removeCanvasMember, { canvasId: id, userId: "bob" }, asUser("carol")),
    ).rejects.toThrow(/not found/i);

    const filler = Array.from({ length: 49 }, (_, i) => `filler-${i}`);
    for (const fid of filler) await seedUser(db, fid);
    await db
      .insert(canvasMembers)
      .values(filler.map((userId) => ({ canvasId: id, userId, role: "viewer" })));
    await expect(
      call(addCanvasMember, { canvasId: id, userId: "carol", role: "viewer" }, asUser("alice")),
    ).rejects.toThrow(/up to 50/);
  });

  it("lists canvases shared with the viewer", async () => {
    const id = await personalCanvas();
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "editor" }, asUser("alice"));
    const shared = await call(listSharedCanvases, {}, asUser("bob"));
    expect(shared.map((c) => [c.id, c.role, c.owner?.id])).toEqual([[id, "editor", "alice"]]);
    expect(await call(listSharedCanvases, {}, asUser("carol"))).toEqual([]);
  });
});

describe("public tier", () => {
  it("reads public and unlisted canvases for anyone, lists only public ones", async () => {
    const pub = await personalCanvas("alice", "Pub.canvas");
    const unl = await personalCanvas("alice", "Unl.canvas");
    const priv = await personalCanvas("alice", "Priv.canvas");
    await setVisibility("alice", pub, "public");
    await setVisibility("alice", unl, "unlisted");

    expect((await call(getPublicCanvas, { canvasId: pub }, asUser(null))).title).toBe("Pub");
    expect((await call(getPublicCanvas, { canvasId: unl }, asUser(null))).visibility).toBe(
      "unlisted",
    );
    await expect(call(getPublicCanvas, { canvasId: priv }, asUser(null))).rejects.toThrow(
      /not found/i,
    );
    expect((await call(getCanvas, { canvasId: unl }, asUser(null))).access).toBe("read");

    const listed = await call(listPublicCanvases, { ownerId: "alice" }, asUser(null));
    expect(listed.map((c) => c.id)).toEqual([pub]);

    canvasesEnabled = false;
    await expect(call(getPublicCanvas, { canvasId: pub }, asUser(null))).rejects.toThrow(
      /not found/i,
    );
  });

  it("drops canvases of a hidden team", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    expect(await call(listPublicCanvases, { teamId }, asUser(null))).toHaveLength(1);
    await db.update(teams).set({ hiddenAt: new Date() }).where(eq(teams.id, teamId));
    expect(await call(listPublicCanvases, { teamId }, asUser(null))).toEqual([]);
    await expect(call(getPublicCanvas, { canvasId: team }, asUser(null))).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("moveCanvasToTeam", () => {
  it("moves into the team, drops members, maps private and repairs a clash", async () => {
    await teamCanvas("Plan.canvas");
    const id = await personalCanvas("alice", "Plan.canvas");
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "viewer" }, asUser("alice"));
    events = [];

    const moved = await call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice"));
    expect(moved).toMatchObject({ path: "Plan 2.canvas", visibility: "team", teamId });
    expect(await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id))).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["moved_to_team", "member_removed"]);
    expect((await call(getCanvas, { canvasId: id }, asUser("bob"))).access).toBe("write");

    await expect(call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice"))).rejects.toThrow(
      /already belongs/,
    );
  });

  it("refuses non-owners and teams the viewer can't write to", async () => {
    const id = await personalCanvas("carol");
    await expect(call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("carol"))).rejects.toThrow(
      /Team not found/,
    );
    const mine = await personalCanvas("alice");
    await expect(call(moveCanvasToTeam, { canvasId: mine, teamId }, asUser("bob"))).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("reports and staff hide", () => {
  it("reports, resolves with a hide, and the hide reaches every read", async () => {
    const id = await personalCanvas();
    await setVisibility("alice", id, "public");
    expect((await call(getPublicCanvas, { canvasId: id }, asUser(null))).id).toBe(id);

    expect((await call(getCanvas, { canvasId: id }, asUser("stranger"))).canReport).toBe(true);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).canReport).toBe(false);

    await call(reportCanvas, { canvasId: id, reason: "spam" }, asUser("stranger"));
    await call(reportCanvas, { canvasId: id, reason: "rude" }, asUser("carol"));
    await expect(
      call(reportCanvas, { canvasId: id, reason: "again" }, asUser("stranger")),
    ).rejects.toThrow(/already reported/);

    const queue = await call(listCanvasReports, {}, asUser("staff"));
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ canvasId: id, liveVisibility: "public" });

    events = [];
    await call(
      resolveCanvasReport,
      { reportId: queue[0]!.id, action: "hide_canvas", reason: "abuse" },
      asUser("staff"),
    );
    expect(await call(listCanvasReports, {}, asUser("staff"))).toEqual([]);
    const logged = await db.select().from(moderationActions);
    expect(logged.map((r) => r.action).sort()).toEqual(["canvas_hidden", "canvas_hidden"]);
    const resolvedNotices = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "report_resolved"));
    expect(resolvedNotices.map((n) => n.userId).sort()).toEqual(["carol", "stranger"]);

    await expect(call(getPublicCanvas, { canvasId: id }, asUser(null))).rejects.toThrow(
      /not found/i,
    );
    await expect(call(getCanvas, { canvasId: id }, asUser("stranger"))).rejects.toThrow(
      /not found/i,
    );
    expect(await call(listPublicCanvases, { ownerId: "alice" }, asUser(null))).toEqual([]);
    const ownerView = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(ownerView).toMatchObject({ access: "read", hiddenReason: "abuse", canShare: false });
    expect(events.map((e) => e.type)).toEqual(["hidden"]);
    expect(revokesFor(events[0]!)).toEqual([{ canvasId: id }]);

    // Hiding again does nothing: no new log row, no new notice, no event.
    const result = await call(
      setCanvasHidden,
      { canvasId: id, hidden: true, reason: "again" },
      asUser("staff"),
    );
    expect(result.changed).toBe(false);
    expect(await db.select().from(moderationActions)).toHaveLength(2);

    await call(reopenReport, { reportId: queue[0]!.id, kind: "canvas" }, asUser("staff"));
    expect(await call(listCanvasReports, {}, asUser("staff"))).toHaveLength(1);

    await call(setCanvasHidden, { canvasId: id, hidden: false }, asUser("staff"));
    expect((await call(getPublicCanvas, { canvasId: id }, asUser(null))).id).toBe(id);
    expect(events.map((e) => e.type)).toEqual(["hidden", "unhidden"]);
  });

  it("is NOT_FOUND for private canvases and refuses non-staff hides", async () => {
    const id = await personalCanvas();
    await expect(
      call(reportCanvas, { canvasId: id, reason: "x" }, asUser("stranger")),
    ).rejects.toThrow(/not found/i);
    await expect(
      call(setCanvasHidden, { canvasId: id, hidden: true, reason: "x" }, asUser("alice")),
    ).rejects.toThrow();
    await expect(
      call(setCanvasHidden, { canvasId: id, hidden: true }, asUser("staff")),
    ).rejects.toThrow(/reason/);
  });
});
