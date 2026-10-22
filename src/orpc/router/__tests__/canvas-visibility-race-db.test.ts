import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canvases,
  canvasReports,
  moderationActions,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { type CanvasEvent, onCanvasEvent } from "@/lib/canvas-events";
import { createCanvas, moveCanvasToTeam, setCanvasVisibility } from "@/orpc/router/canvas";
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

async function stored(canvasId: string) {
  const [row] = await db
    .select({ visibility: canvases.visibility })
    .from(canvases)
    .where(eq(canvases.id, canvasId));
  return row?.visibility;
}

const changes = () =>
  events.flatMap((e) => (e.type === "visibility_changed" ? [[e.from, e.to]] : []));

/**
 * Lets `write` finish after setCanvasVisibility's read and right before its
 * guarded update runs. Drizzle builders are lazy, so the write is awaited
 * rather than fired and forgotten.
 */
async function raced(
  userId: string,
  canvasId: string,
  visibility: string,
  write: () => PromiseLike<unknown>,
) {
  const realUpdate = db.update.bind(db);
  const spy = vi.spyOn(db, "update").mockImplementationOnce(((table: typeof canvases) => {
    const update = realUpdate(table);
    return {
      set: (values: Parameters<typeof update.set>[0]) => ({
        where: (condition: Parameters<ReturnType<typeof update.set>["where"]>[0]) => ({
          returning: (fields: Record<string, never>) =>
            Promise.resolve(write()).then(() =>
              update.set(values).where(condition).returning(fields),
            ),
        }),
      }),
    };
  }) as never);
  try {
    return await setVisibility(userId, canvasId, visibility);
  } finally {
    spy.mockRestore();
  }
}

describe("access changes that land between the read and the guarded write", () => {
  it("a staff hide landing first freezes the canvas: the owner's widening doesn't apply", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "unlisted");
    events = [];
    await raced("alice", team, "public", () =>
      db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, team)),
    ).catch(() => {});
    expect(await stored(team)).toBe("unlisted");
    expect(changes()).toEqual([]);
  });

  it("a delete landing first leaves the trashed canvas's visibility alone", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "unlisted");
    events = [];
    await raced("alice", team, "public", () =>
      db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, team)),
    ).catch(() => {});
    expect(await stored(team)).toBe("unlisted");
  });

  it("an owner demoted first can't widen", async () => {
    const team = await teamCanvas();
    events = [];
    const result = await raced("alice", team, "public", () =>
      db.update(teamMembers).set({ role: "member" }).where(eq(teamMembers.userId, "alice")),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN" });
    expect(await stored(team)).toBe("team");
    expect(changes()).toEqual([]);
  });

  it("a hard delete landing first doesn't report a visibility for a canvas that's gone", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    const result = await raced("bob", team, "team", () =>
      db.delete(canvases).where(eq(canvases.id, team)),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "NOT_FOUND" });
  });

  it("narrowing still lands when an unrelated column changed first", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    const result = await raced("bob", team, "team", () =>
      db.update(canvases).set({ updatedAt: new Date() }).where(eq(canvases.id, team)),
    );
    expect(result.visibility).toBe("team");
    expect(await stored(team)).toBe("team");
    expect(changes()).toEqual([["public", "team"]]);
  });
});

describe("standing lost between the read and the guarded write", () => {
  it("an editor removed from the team first can't narrow", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    const result = await raced("bob", team, "team", () =>
      db.delete(teamMembers).where(eq(teamMembers.userId, "bob")),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN" });
    expect(await stored(team)).toBe("public");
    expect(changes()).toEqual([]);
  });

  it("an owner removed first can't narrow either", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    const result = await raced("alice", team, "unlisted", () =>
      db.delete(teamMembers).where(eq(teamMembers.userId, "alice")),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN" });
    expect(await stored(team)).toBe("public");
  });

  it("an owner demoted first may still narrow, as an editor would", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    const result = await raced("alice", team, "unlisted", () =>
      db.update(teamMembers).set({ role: "member" }).where(eq(teamMembers.userId, "alice")),
    );
    expect(result.visibility).toBe("unlisted");
    expect(changes()).toEqual([["public", "unlisted"]]);
  });

  it("a personal canvas's owner who loses it first can't widen it", async () => {
    const { id } = await call(
      createCanvas,
      { scope: { kind: "personal" }, path: "Mine.canvas" },
      asUser("alice"),
    );
    events = [];
    const result = await raced("alice", id, "public", () =>
      db.update(canvases).set({ ownerId: "carol" }).where(eq(canvases.id, id)),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN" });
    expect(await stored(id)).toBe("private");
    expect(changes()).toEqual([]);
  });

  it("a staff hide of the whole team landing first freezes its canvases", async () => {
    const team = await teamCanvas();
    events = [];
    const result = await raced("alice", team, "public", () =>
      db.update(teams).set({ hiddenAt: new Date() }).where(eq(teams.id, teamId)),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "FORBIDDEN", message: "Staff have hidden this canvas." });
    expect(await stored(team)).toBe("team");
    expect(changes()).toEqual([]);
  });

  it("a team archived first is read-only: the widening doesn't apply", async () => {
    const team = await teamCanvas();
    events = [];
    const result = await raced("alice", team, "public", () =>
      db.update(teams).set({ status: "archived" }).where(eq(teams.id, teamId)),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({
      code: "FORBIDDEN",
      message: "This team is archived, so its canvases are read-only.",
    });
    expect(await stored(team)).toBe("team");
    expect(changes()).toEqual([]);
  });

  it("a personal canvas moved into a team first isn't narrowed to private there", async () => {
    const { id } = await call(
      createCanvas,
      { scope: { kind: "personal" }, path: "Mine.canvas" },
      asUser("alice"),
    );
    await setVisibility("alice", id, "unlisted");
    events = [];
    const result = await raced("alice", id, "private", () =>
      call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice")),
    ).then(
      (r) => r,
      (e: Error) => e,
    );
    expect(result).toMatchObject({ code: "CONFLICT" });
    const [row] = await db
      .select({ teamId: canvases.teamId, visibility: canvases.visibility })
      .from(canvases)
      .where(eq(canvases.id, id));
    expect(row).toEqual({ teamId, visibility: "unlisted" });
    expect(changes()).toEqual([]);
  });
});
