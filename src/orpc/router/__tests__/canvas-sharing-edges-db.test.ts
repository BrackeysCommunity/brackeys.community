import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  canvasAttachments,
  canvases,
  canvasMembers,
  notifications,
  teamMembers,
  teams,
  user,
  userBlocks,
} from "@/db/schema";
import { type CanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";
import { docFromState } from "@/lib/canvas/doc-state";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas } from "@/lib/canvas/json-canvas";
import * as canvasRouter from "@/orpc/router/canvas";
import {
  addCanvasMember,
  createCanvas,
  deleteCanvas,
  getCanvas,
  getPublicCanvas,
  listCanvasMembers,
  listPublicCanvases,
  listSharedCanvases,
  moveCanvasToTeam,
  removeCanvasMember,
  restoreCanvas,
  saveCanvas,
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
let otherTeamId: string;
let events: CanvasEvent[] = [];
let stopListening: () => void = () => {};

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  canvasesEnabled = true;
  nonMembers.clear();
  rate.counters.clear();
  await db.delete(notifications);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol", "dave", "stranger"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "alice" })
    .returning({ id: teams.id });
  teamId = team!.id;
  const [other] = await db
    .insert(teams)
    .values({ slug: "rivals", name: "Rivals", createdBy: "carol" })
    .returning({ id: teams.id });
  otherTeamId = other!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "alice", role: "owner" },
    { teamId, userId: "bob", role: "member" },
    { teamId: otherTeamId, userId: "carol", role: "owner" },
    { teamId: otherTeamId, userId: "alice", role: "member" },
  ]);
  events = [];
  stopListening = onCanvasEvent((event) => events.push(event));
});
afterEach(() => stopListening());

async function personalCanvas(userId = "alice", path = "Plan.canvas") {
  const { id } = await call(createCanvas, { scope: { kind: "personal" }, path }, asUser(userId));
  return id;
}

async function teamCanvas(path = "Board.canvas", inTeam = teamId, by = "alice") {
  const { id } = await call(
    createCanvas,
    { scope: { kind: "team", teamId: inTeam }, path },
    asUser(by),
  );
  return id;
}

type Visibility = "private" | "team" | "unlisted" | "public";
const setVisibility = (userId: string | null, canvasId: string, visibility: string) =>
  call(setCanvasVisibility, { canvasId, visibility: visibility as Visibility }, asUser(userId));

const share = (canvasId: string, userId: string, role: "editor" | "viewer", by = "alice") =>
  call(addCanvasMember, { canvasId, userId, role }, asUser(by));

/** One save of a text card, as the editor's save loop would send it. */
async function saveText(userId: string, canvasId: string, text: string) {
  const loaded = await call(getCanvas, { canvasId }, asUser("alice"));
  const doc = docFromState(base64ToBytes(loaded.state!));
  const before = Y.encodeStateVector(doc);
  applyJsonCanvas(doc, {
    nodes: [{ id: `n-${text}`, type: "text", text, x: 0, y: 0, width: 100, height: 50 }],
  });
  return call(
    saveCanvas,
    {
      canvasId,
      update: bytesToBase64(Y.encodeStateAsUpdate(doc, before)),
      stateVector: bytesToBase64(Y.encodeStateVector(doc)),
    },
    asUser(userId),
  );
}

function eventTypes() {
  return events.map((e) => e.type);
}

describe("E1 visibility", () => {
  it("takes every value its kind allows and refuses every other, emitting once per real change", async () => {
    const mine = await personalCanvas();
    const team = await teamCanvas();

    for (const v of ["unlisted", "public", "private"] as const) {
      expect(await setVisibility("alice", mine, v)).toMatchObject({ visibility: v });
    }
    for (const v of ["unlisted", "public", "team"] as const) {
      expect(await setVisibility("alice", team, v)).toMatchObject({ visibility: v });
    }
    await expect(setVisibility("alice", mine, "team")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(setVisibility("alice", team, "private")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(setVisibility("alice", mine, "everyone")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(eventTypes()).toEqual(Array(6).fill("visibility_changed"));
    const [row] = await db.select().from(canvases).where(eq(canvases.id, mine));
    expect(row!.visibility).toBe("private");
  });

  it("refuses non-owners of every kind: team member, invited editor, stranger, staff, anon", async () => {
    const mine = await personalCanvas();
    const team = await teamCanvas();
    await share(mine, "bob", "editor");
    events = [];

    await expect(setVisibility("bob", team, "public")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setVisibility("bob", mine, "public")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setVisibility("stranger", mine, "public")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(setVisibility("staff", mine, "public")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setVisibility(null, mine, "public")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(events).toEqual([]);
  });

  it("refuses a team owner outside the guild, a deleted canvas, and a canvas in a hidden team", async () => {
    const team = await teamCanvas();
    nonMembers.add("discord-alice");
    await expect(setVisibility("alice", team, "public")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    nonMembers.clear();

    const doomed = await personalCanvas("alice", "Doomed.canvas");
    await call(deleteCanvas, { canvasId: doomed }, asUser("alice"));
    await expect(setVisibility("alice", doomed, "public")).rejects.toThrow();

    await db.update(teams).set({ hiddenAt: new Date() }).where(eq(teams.id, teamId));
    await expect(setVisibility("alice", team, "public")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [row] = await db.select().from(canvases).where(eq(canvases.id, team));
    expect(row!.visibility).toBe("team");
  });

  it("bumps updatedAt on a visibility change", async () => {
    const mine = await personalCanvas();
    const old = new Date("2026-01-01T00:00:00Z");
    await db.update(canvases).set({ updatedAt: old }).where(eq(canvases.id, mine));
    await setVisibility("alice", mine, "public");
    const [row] = await db.select().from(canvases).where(eq(canvases.id, mine));
    expect(row!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });
});

describe("E2 reading", () => {
  it("anonymous readers see public and unlisted canvases through both reads, and never the doc state", async () => {
    const pub = await personalCanvas("alice", "Pub.canvas");
    const unl = await teamCanvas("Unl.canvas");
    await setVisibility("alice", pub, "public");
    await setVisibility("alice", unl, "unlisted");

    for (const id of [pub, unl]) {
      const viaGet = await call(getCanvas, { canvasId: id }, asUser(null));
      expect(viaGet).toMatchObject({ access: "read", state: null, canReport: false });
      expect((await call(getPublicCanvas, { canvasId: id }, asUser(null))).id).toBe(id);
    }
  });

  it("private and team canvases are NOT_FOUND to anon and strangers through both reads", async () => {
    const priv = await personalCanvas();
    const team = await teamCanvas();
    for (const id of [priv, team]) {
      for (const who of [null, "stranger"]) {
        await expect(call(getCanvas, { canvasId: id }, asUser(who))).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(call(getPublicCanvas, { canvasId: id }, asUser(who))).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      }
    }
    // Owners don't get private content through the public tier either.
    await expect(call(getPublicCanvas, { canvasId: priv }, asUser("alice"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("unknown and malformed ids are NOT_FOUND or BAD_REQUEST, never a 500", async () => {
    await expect(
      call(getPublicCanvas, { canvasId: "00000000-0000-0000-0000-000000000000" }, asUser(null)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|BAD_REQUEST/) });
    await expect(
      call(getPublicCanvas, { canvasId: "'; drop table canvases; --" }, asUser(null)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|BAD_REQUEST/) });
  });

  it("with the flag off for anonymous viewers, both public procedures are NOT_FOUND", async () => {
    const pub = await personalCanvas();
    await setVisibility("alice", pub, "public");
    canvasesEnabled = false;
    await expect(call(getPublicCanvas, { canvasId: pub }, asUser(null))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      call(listPublicCanvases, { ownerId: "alice" }, asUser(null)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the public procedures never read a session: a signed-in caller gets the anonymous answer", async () => {
    const pub = await personalCanvas();
    await setVisibility("alice", pub, "public");
    const anon = await call(getPublicCanvas, { canvasId: pub }, asUser(null));
    const signedIn = await call(getPublicCanvas, { canvasId: pub }, asUser("alice"));
    expect(signedIn).toEqual(anon);
  });

  it("a public canvas whose owner left the guild still reads publicly, read-only for the owner", async () => {
    const pub = await personalCanvas();
    await setVisibility("alice", pub, "public");
    nonMembers.add("discord-alice");
    expect((await call(getPublicCanvas, { canvasId: pub }, asUser(null))).id).toBe(pub);
    const ownerView = await call(getCanvas, { canvasId: pub }, asUser("alice"));
    expect(ownerView).toMatchObject({ access: "read", canShare: false });
  });
});

describe("E3 listings", () => {
  it("lists only live public canvases, never unlisted, private, hidden, deleted or another scope's", async () => {
    const pub = await personalCanvas("alice", "Pub.canvas");
    const unl = await personalCanvas("alice", "Unl.canvas");
    await personalCanvas("alice", "Priv.canvas");
    const hidden = await personalCanvas("alice", "Hidden.canvas");
    const deleted = await personalCanvas("alice", "Deleted.canvas");
    const bobs = await personalCanvas("bob", "Bobs.canvas");
    const teamPub = await teamCanvas("TeamPub.canvas");
    for (const id of [pub, hidden, deleted, teamPub]) await setVisibility("alice", id, "public");
    await setVisibility("bob", bobs, "public");
    await setVisibility("alice", unl, "unlisted");
    await db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, hidden));
    await call(deleteCanvas, { canvasId: deleted }, asUser("alice"));

    const alices = await call(listPublicCanvases, { ownerId: "alice" }, asUser(null));
    // The team canvas alice created is the team's, not on her profile.
    expect(alices.map((c) => c.id)).toEqual([pub]);
    // An empty canvas has no thumbnail yet.
    expect(alices[0]).toMatchObject({ title: "Pub", thumbnail: null });

    const crew = await call(listPublicCanvases, { teamId }, asUser(null));
    expect(crew.map((c) => c.id)).toEqual([teamPub]);
    expect(await call(listPublicCanvases, { teamId: otherTeamId }, asUser(null))).toEqual([]);
    expect(await call(listPublicCanvases, { ownerId: "nobody" }, asUser(null))).toEqual([]);
  });

  it("orders newest first and honours the limit (max 24)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await personalCanvas("alice", `C${i}.canvas`);
      await setVisibility("alice", id, "public");
      await db
        .update(canvases)
        .set({ updatedAt: new Date(Date.UTC(2026, 0, i + 1)) })
        .where(eq(canvases.id, id));
      ids.push(id);
    }
    const listed = await call(listPublicCanvases, { ownerId: "alice", limit: 2 }, asUser(null));
    expect(listed.map((c) => c.id)).toEqual([ids[2], ids[1]]);
    await expect(
      call(listPublicCanvases, { ownerId: "alice", limit: 25 }, asUser(null)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("needs exactly one of ownerId and teamId", async () => {
    await expect(call(listPublicCanvases, {} as never, asUser(null))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      call(listPublicCanvases, { ownerId: "alice", teamId }, asUser(null)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("E4 members", () => {
  it("a viewer member reads but saveCanvas is FORBIDDEN; an editor member saves", async () => {
    const id = await personalCanvas();
    await share(id, "bob", "viewer");
    await share(id, "carol", "editor");

    expect((await call(getCanvas, { canvasId: id }, asUser("bob"))).access).toBe("read");
    await expect(saveText("bob", id, "nope")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await saveText("carol", id, "carol was here");
    const after = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(after.nodeCount).toBe(1);
  });

  it("a member who left the guild drops to read; a hidden canvas shuts members out", async () => {
    const id = await personalCanvas();
    await share(id, "carol", "editor");
    nonMembers.add("discord-carol");
    await expect(saveText("carol", id, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    nonMembers.clear();
    await db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, id));
    await expect(call(getCanvas, { canvasId: id }, asUser("carol"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await call(listSharedCanvases, {}, asUser("carol"))).toEqual([]);
  });

  it("re-adding with a new role is a role change (one event, no second notice)", async () => {
    const id = await personalCanvas();
    await share(id, "bob", "viewer");
    await share(id, "bob", "editor");
    await share(id, "bob", "editor");
    expect(eventTypes()).toEqual(["member_added", "member_role_changed"]);
    const notices = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "canvas_shared_with_you"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: "bob", entityType: "canvas", entityId: id });
  });

  it("refuses unknown, banned and blocked people with NOT_FOUND, and non-owners entirely", async () => {
    const id = await personalCanvas();
    await expect(share(id, "ghost", "viewer")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.update(user).set({ bannedAt: new Date() }).where(eq(user.id, "dave"));
    await expect(share(id, "dave", "viewer")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.insert(userBlocks).values({ blockerId: "carol", blockedId: "alice" });
    await expect(share(id, "carol", "viewer")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await share(id, "bob", "editor");
    // An editor member can't share onward or change roles.
    await expect(share(id, "stranger", "viewer", "bob")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      call(updateCanvasMember, { canvasId: id, userId: "bob", role: "viewer" }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(canvasMembers)).toHaveLength(1);
  });

  it("refuses an invalid role and an empty user id", async () => {
    const id = await personalCanvas();
    await expect(
      call(
        addCanvasMember,
        { canvasId: id, userId: "bob", role: "owner" as "editor" },
        asUser("alice"),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(share(id, "", "viewer")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("enforces the 50-member cap but still lets an existing member's role change at the cap", async () => {
    const id = await personalCanvas();
    const filler = Array.from({ length: 50 }, (_, i) => `filler-${i}`);
    for (const fid of filler) await seedUser(db, fid);
    await db
      .insert(canvasMembers)
      .values(filler.map((userId) => ({ canvasId: id, userId, role: "viewer" })));
    await expect(share(id, "bob", "viewer")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await share(id, "filler-0", "editor")).toMatchObject({ role: "editor" });
  });

  it("rate-limits shares in the canvas-share bucket", async () => {
    const id = await personalCanvas();
    rate.counters.set("canvas-share:alice", 60);
    await expect(share(id, "bob", "viewer")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await db.select().from(canvasMembers)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("team canvases refuse members on every member procedure", async () => {
    const team = await teamCanvas();
    await expect(share(team, "carol", "viewer")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(updateCanvasMember, { canvasId: team, userId: "bob", role: "viewer" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await call(listCanvasMembers, { canvasId: team }, asUser("alice"))).toEqual([]);
  });

  it("update and remove of a non-member are NOT_FOUND and emit nothing", async () => {
    const id = await personalCanvas();
    await expect(
      call(updateCanvasMember, { canvasId: id, userId: "bob", role: "editor" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(removeCanvasMember, { canvasId: id, userId: "bob" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Leaving a canvas you were never on looks the same as a canvas that isn't there.
    await expect(
      call(removeCanvasMember, { canvasId: id }, asUser("stranger")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(events).toEqual([]);
  });

  it("an unchanged role is a no-op without an event; a downgrade revokes only that member", async () => {
    const id = await personalCanvas();
    await share(id, "bob", "editor");
    events = [];
    await call(
      updateCanvasMember,
      { canvasId: id, userId: "bob", role: "editor" },
      asUser("alice"),
    );
    expect(events).toEqual([]);
    await call(
      updateCanvasMember,
      { canvasId: id, userId: "bob", role: "viewer" },
      asUser("alice"),
    );
    expect(events).toHaveLength(1);
    expect(revokesFor(events[0]!)).toEqual([{ canvasId: id, userId: "bob" }]);
  });

  it("a member leaves with no userId; leaving twice is NOT_FOUND; a member can't remove another", async () => {
    const id = await personalCanvas();
    await share(id, "bob", "viewer");
    await share(id, "carol", "viewer");
    await expect(
      call(removeCanvasMember, { canvasId: id, userId: "carol" }, asUser("bob")),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    events = [];
    expect(await call(removeCanvasMember, { canvasId: id }, asUser("bob"))).toEqual({
      userId: "bob",
    });
    expect(events).toEqual([
      {
        type: "member_removed",
        canvasId: id,
        scope: { kind: "personal", ownerId: "alice" },
        userId: "bob",
      },
    ]);
    await expect(call(removeCanvasMember, { canvasId: id }, asUser("bob"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id)),
    ).toHaveLength(1);
  });

  it("listCanvasMembers is for the owner, members and staff only", async () => {
    const id = await personalCanvas();
    await setVisibility("alice", id, "public");
    await share(id, "bob", "viewer");
    expect(await call(listCanvasMembers, { canvasId: id }, asUser("alice"))).toHaveLength(1);
    expect(await call(listCanvasMembers, { canvasId: id }, asUser("staff"))).toHaveLength(1);
    // A stranger can read the public canvas but not see who it's shared with.
    await expect(
      call(listCanvasMembers, { canvasId: id }, asUser("stranger")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("listSharedCanvases skips deleted, team and other people's canvases", async () => {
    const shared = await personalCanvas("alice", "Shared.canvas");
    const gone = await personalCanvas("alice", "Gone.canvas");
    await share(shared, "bob", "viewer");
    await share(gone, "bob", "viewer");
    await call(deleteCanvas, { canvasId: gone }, asUser("alice"));
    const carols = await personalCanvas("carol", "Carols.canvas");
    await share(carols, "dave", "editor", "carol");

    const listed = await call(listSharedCanvases, { thumbnails: true }, asUser("bob"));
    expect(listed.map((c) => c.id)).toEqual([shared]);
    expect(listed[0]).toMatchObject({ role: "viewer", owner: { id: "alice" } });
    expect(listed[0]!.thumbnail).not.toBeUndefined();
    await expect(call(listSharedCanvases, {}, asUser(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("concurrent adds of the same person produce one membership, one added event and one notice", async () => {
    const id = await personalCanvas();
    await Promise.allSettled(Array.from({ length: 6 }, () => share(id, "bob", "viewer")));
    expect(
      await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id)),
    ).toHaveLength(1);
    const notices = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.type, "canvas_shared_with_you"), eq(notifications.userId, "bob")),
      );
    expect(notices).toHaveLength(1);
    expect(eventTypes().filter((t) => t === "member_added")).toHaveLength(1);
  });

  it("concurrent adds at 49 members can't push the canvas over the cap", async () => {
    const id = await personalCanvas();
    const filler = Array.from({ length: 49 }, (_, i) => `filler-${i}`);
    for (const fid of filler) await seedUser(db, fid);
    await db
      .insert(canvasMembers)
      .values(filler.map((userId) => ({ canvasId: id, userId, role: "viewer" })));
    await Promise.allSettled(
      ["bob", "carol", "dave", "stranger"].map((u) => share(id, u, "viewer")),
    );
    const count = (await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id)))
      .length;
    expect(count).toBeLessThanOrEqual(50);
  });
});

describe("E5 move to team", () => {
  it("keeps unlisted and public as they are, and keeps the owner", async () => {
    const unl = await personalCanvas("alice", "Unl.canvas");
    const pub = await personalCanvas("alice", "Pub.canvas");
    await setVisibility("alice", unl, "unlisted");
    await setVisibility("alice", pub, "public");
    expect(await call(moveCanvasToTeam, { canvasId: unl, teamId }, asUser("alice"))).toMatchObject({
      visibility: "unlisted",
    });
    expect(await call(moveCanvasToTeam, { canvasId: pub, teamId }, asUser("alice"))).toMatchObject({
      visibility: "public",
    });
    const [row] = await db.select().from(canvases).where(eq(canvases.id, pub));
    expect(row).toMatchObject({ teamId, ownerId: "alice" });
    // The canvas now shows on the team's page, not the owner's profile.
    expect((await call(listPublicCanvases, { teamId }, asUser(null))).map((c) => c.id)).toEqual([
      pub,
    ]);
    expect(await call(listPublicCanvases, { ownerId: "alice" }, asUser(null))).toEqual([]);
  });

  it("a team member (not owner) may move into their team; the dropped member loses access", async () => {
    const id = await personalCanvas("alice");
    await share(id, "dave", "editor");
    events = [];
    // alice is a plain member of carol's team.
    await call(moveCanvasToTeam, { canvasId: id, teamId: otherTeamId }, asUser("alice"));
    await expect(call(getCanvas, { canvasId: id }, asUser("dave"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await call(getCanvas, { canvasId: id }, asUser("carol"))).access).toBe("owner");
    expect(events.map((e) => [e.type, "userId" in e ? e.userId : null])).toEqual([
      ["moved_to_team", null],
      ["member_removed", "dave"],
    ]);
    expect(events.every((e) => e.scope.kind === "team")).toBe(true);
  });

  it("refuses a hidden team, an archived team, a team the owner is not on, and an unknown team", async () => {
    const id = await personalCanvas("alice");
    await db.update(teams).set({ status: "archived" }).where(eq(teams.id, otherTeamId));
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId: otherTeamId }, asUser("alice")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(teams).set({ hiddenAt: new Date() }).where(eq(teams.id, teamId));
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice")),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId: "no-such-team" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.teamId).toBeNull();
    expect(events).toEqual([]);
  });

  it("refuses an editor member, staff, a deleted canvas and a staff-hidden canvas", async () => {
    const id = await personalCanvas("alice");
    await share(id, "bob", "editor");
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("staff")),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, id));
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice")),
    ).rejects.toThrow();
    const doomed = await personalCanvas("alice", "Doomed.canvas");
    await call(deleteCanvas, { canvasId: doomed }, asUser("alice"));
    await expect(
      call(moveCanvasToTeam, { canvasId: doomed, teamId }, asUser("alice")),
    ).rejects.toThrow();
    expect(
      (await db.select().from(canvasMembers).where(eq(canvasMembers.canvasId, id))).length,
    ).toBe(1);
  });

  it("has no way back: no reverse procedure, and a team canvas refuses another move", async () => {
    const names = Object.keys(canvasRouter);
    expect(names.filter((n) => /move.*(personal|out|back)/i.test(n))).toEqual([]);
    const id = await teamCanvas();
    await expect(
      call(moveCanvasToTeam, { canvasId: id, teamId: otherTeamId }, asUser("alice")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("repairs a clash against a case/Unicode variant of the path", async () => {
    await teamCanvas("plan.canvas");
    const id = await personalCanvas("alice", "Plan.canvas");
    const moved = await call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice"));
    expect(moved.path).not.toBe("Plan.canvas");
    expect(moved.path.toLowerCase()).not.toBe("plan.canvas");
  });

  it("two personal canvases with the same name moved concurrently both land, with distinct paths", async () => {
    const a = await personalCanvas("alice", "Same.canvas");
    const b = await personalCanvas("carol", "Same.canvas");
    await db.insert(teamMembers).values({ teamId, userId: "carol", role: "member" });
    const results = await Promise.allSettled([
      call(moveCanvasToTeam, { canvasId: a, teamId }, asUser("alice")),
      call(moveCanvasToTeam, { canvasId: b, teamId }, asUser("carol")),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const rows = await db.select().from(canvases).where(eq(canvases.teamId, teamId));
    expect(new Set(rows.map((r) => r.pathKey)).size).toBe(rows.length);
  });
});

describe("E5 move to team keeps image cards", () => {
  beforeEach(async () => {
    await db.delete(canvasAttachments);
  });

  async function imageCanvas(path: string, attachmentId: string) {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: [
        {
          id: `card-${path}`,
          type: "file",
          file: "attachments/a.png",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          jamsTeam: { type: "image", attachmentId },
        },
      ],
    });
    const { id } = await call(
      createCanvas,
      {
        scope: { kind: "personal" },
        path,
        initialState: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      },
      asUser("alice"),
    );
    return id;
  }

  it("copies the images into the team and re-points the cards; other canvases keep theirs", async () => {
    await db.insert(canvasAttachments).values([
      {
        id: "img",
        ownerId: "alice",
        path: "attachments/a.png",
        imageKey: "canvas-images/alice/a.png",
        sha256: "x",
        byteSize: 1,
      },
      {
        id: "team-img",
        ownerId: "bob",
        teamId,
        path: "attachments/a.png",
        imageKey: "canvas-images/bob/other.png",
        sha256: "y",
        byteSize: 1,
      },
    ]);
    const moving = await imageCanvas("Moving.canvas", "img");
    const staying = await imageCanvas("Staying.canvas", "img");

    const moved = await call(moveCanvasToTeam, { canvasId: moving, teamId }, asUser("alice"));
    expect(moved.teamId).toBe(teamId);

    const asOwner = await call(getCanvas, { canvasId: moving }, asUser("alice"));
    const [copyId] = Object.keys(asOwner.attachments);
    expect(copyId).toBeDefined();
    expect(copyId).not.toBe("img");
    expect(asOwner.snapshot.nodes[0]).toMatchObject({
      jamsTeam: { type: "image", attachmentId: copyId },
    });
    // The team already had an image at that path, so the copy gets the next free name.
    expect(asOwner.attachments[copyId!]!.path).not.toBe("attachments/a.png");
    // The roster sees it too, and the stored doc matches the snapshot.
    const asTeammate = await call(getCanvas, { canvasId: moving }, asUser("bob"));
    expect(Object.keys(asTeammate.attachments)).toEqual([copyId]);
    const stored = docFromState(base64ToBytes(asTeammate.state!));
    const storedIds = [...stored.getMap<Y.Map<unknown>>("nodes").values()].map((node) =>
      node.get("attachmentId"),
    );
    expect(storedIds).toEqual([copyId]);

    const [copy] = await db
      .select()
      .from(canvasAttachments)
      .where(eq(canvasAttachments.id, copyId!));
    expect(copy).toMatchObject({ teamId, ownerId: "alice", imageKey: "canvas-images/alice/a.png" });

    const other = await call(getCanvas, { canvasId: staying }, asUser("alice"));
    expect(Object.keys(other.attachments)).toEqual(["img"]);
  });

  it("a canvas without images moves without touching attachments", async () => {
    const id = await personalCanvas("alice", "Plain.canvas");
    await call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice"));
    expect(await db.select().from(canvasAttachments)).toEqual([]);
  });
});

describe("E9 events from delete and restore", () => {
  it("delete and restore emit exactly one event each, with the canvas's scope", async () => {
    const id = await personalCanvas();
    const team = await teamCanvas();
    await call(deleteCanvas, { canvasId: id }, asUser("alice"));
    await call(restoreCanvas, { canvasId: id }, asUser("alice"));
    await call(deleteCanvas, { canvasId: team }, asUser("bob"));
    expect(events).toEqual([
      { type: "deleted", canvasId: id, scope: { kind: "personal", ownerId: "alice" } },
      { type: "restored", canvasId: id, scope: { kind: "personal", ownerId: "alice" } },
      { type: "deleted", canvasId: team, scope: { kind: "team", teamId } },
    ]);
    expect(revokesFor(events[0]!)).toEqual([{ canvasId: id }]);
    expect(revokesFor(events[1]!)).toEqual([]);
  });

  it("a restore onto a reused path emits once, after the repair", async () => {
    const id = await personalCanvas("alice", "Plan.canvas");
    await call(deleteCanvas, { canvasId: id }, asUser("alice"));
    await personalCanvas("alice", "Plan.canvas");
    events = [];
    const restored = await call(restoreCanvas, { canvasId: id }, asUser("alice"));
    expect(restored.path).not.toBe("Plan.canvas");
    expect(eventTypes()).toEqual(["restored"]);
  });

  it("refused mutations emit nothing", async () => {
    const id = await personalCanvas();
    await Promise.allSettled([
      setVisibility("bob", id, "public"),
      share(id, "bob", "viewer", "carol"),
      call(deleteCanvas, { canvasId: id }, asUser("bob")),
      call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("bob")),
    ]);
    expect(events).toEqual([]);
  });

  it("each event is emitted after its write is visible", async () => {
    const id = await personalCanvas();
    const seen: Promise<string | undefined>[] = [];
    const off = onCanvasEvent((event) => {
      if (event.type === "visibility_changed") {
        seen.push(
          db
            .select({ v: canvases.visibility })
            .from(canvases)
            .where(eq(canvases.id, event.canvasId))
            .then((rows) => rows[0]?.v),
        );
      }
    });
    await setVisibility("alice", id, "public");
    off();
    expect(await Promise.all(seen)).toEqual(["public"]);
  });
});
