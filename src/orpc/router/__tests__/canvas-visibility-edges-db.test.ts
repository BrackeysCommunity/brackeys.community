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
import { createCanvas, setCanvasVisibility } from "@/orpc/router/canvas";
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

describe("team canvas visibility: owners widen, editors narrow", () => {
  it("an editor can't widen from any step, nor skip-widen team → public", async () => {
    const team = await teamCanvas();
    await expect(setVisibility("bob", team, "public")).rejects.toThrow(/team's owners/);
    await setVisibility("alice", team, "unlisted");
    await expect(setVisibility("bob", team, "public")).rejects.toThrow(/team's owners/);
    expect(await stored(team)).toBe("unlisted");
    expect(changes()).toEqual([["team", "unlisted"]]);
  });

  it("an editor may skip-narrow public → team in one step", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    await setVisibility("bob", team, "team");
    expect(await stored(team)).toBe("team");
    expect(changes()).toEqual([
      ["team", "public"],
      ["public", "team"],
    ]);
  });

  it("setting the current value is a no-op for an editor, with no event", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    await expect(setVisibility("bob", team, "public")).resolves.toMatchObject({
      visibility: "public",
    });
    expect(changes()).toEqual([]);
  });

  it("an owner demoted to member loses widening at once", async () => {
    const team = await teamCanvas();
    await db.update(teamMembers).set({ role: "member" }).where(eq(teamMembers.userId, "alice"));
    await expect(setVisibility("alice", team, "public")).rejects.toThrow(/team's owners/);
    expect(await stored(team)).toBe("team");
  });

  it("a removed member, staff and strangers can't change it either way", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    await db.delete(teamMembers).where(eq(teamMembers.userId, "bob"));
    for (const who of ["bob", "staff", "stranger", "carol"]) {
      await expect(setVisibility(who, team, "team")).rejects.toThrow();
    }
    expect(await stored(team)).toBe("public");
  });

  it("an editor outside the guild can't narrow (write drops to read)", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    nonMembers.add("discord-bob");
    await expect(setVisibility("bob", team, "team")).rejects.toThrow(/only view/);
    expect(await stored(team)).toBe("public");
  });

  it("nobody changes an archived team's canvas", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    await db.update(teams).set({ status: "archived" }).where(eq(teams.id, teamId));
    await expect(setVisibility("bob", team, "team")).rejects.toThrow();
    await expect(setVisibility("alice", team, "unlisted")).rejects.toThrow();
    expect(await stored(team)).toBe("public");
  });

  it("a hidden canvas is frozen for editors and owners", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    await db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, team));
    await expect(setVisibility("bob", team, "team")).rejects.toThrow();
    await expect(setVisibility("alice", team, "unlisted")).rejects.toThrow();
    expect(await stored(team)).toBe("public");
  });

  it("refuses malformed values", async () => {
    const team = await teamCanvas();
    for (const bad of ["PUBLIC", "", "everyone", "private"]) {
      await expect(setVisibility("alice", team, bad)).rejects.toThrow();
    }
    await expect(
      call(setCanvasVisibility, { canvasId: team, visibility: 2 } as never, asUser("alice")),
    ).rejects.toThrow();
    await expect(setVisibility("alice", "not-a-uuid", "public")).rejects.toThrow();
    expect(await stored(team)).toBe("team");
    expect(changes()).toEqual([]);
  });
});

describe("concurrent visibility changes", () => {
  it("an owner and an editor narrowing from public at once: every landed step is announced in order", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    const results = await Promise.allSettled([
      setVisibility("alice", team, "unlisted"),
      setVisibility("bob", team, "team"),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const final = await stored(team);
    let at = "public";
    for (const [from, to] of changes()) {
      expect(from).toBe(at);
      at = to!;
    }
    expect(at).toBe(final);
    expect(changes().length).toBeGreaterThanOrEqual(1);
  });

  it("an editor's narrowing racing an owner's widening never leaves an unannounced state", async () => {
    const team = await teamCanvas();
    await setVisibility("alice", team, "unlisted");
    events = [];
    await Promise.allSettled([
      setVisibility("alice", team, "public"),
      setVisibility("bob", team, "team"),
    ]);
    const final = await stored(team);
    const seen = changes();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.at(-1)![1]).toBe(final);
    for (const [from, to] of seen) {
      if (from === "team") expect(to).not.toBe("public");
    }
  });

  it("many editors narrowing at once announce a chain that ends at the stored value", async () => {
    await db.insert(teamMembers).values({ teamId, userId: "carol", role: "member" });
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    await Promise.allSettled(
      ["bob", "carol", "bob", "carol"].map((who, i) =>
        setVisibility(who, team, i % 2 ? "team" : "unlisted"),
      ),
    );
    const final = await stored(team);
    const seen = changes();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    let at = "public";
    for (const [from, to] of seen) {
      expect(from).toBe(at);
      at = to!;
    }
    expect(at).toBe(final);
  });
});

describe("a change that lands between the read and the guarded write", () => {
  async function racedNarrowing() {
    const team = await teamCanvas();
    await setVisibility("alice", team, "public");
    events = [];
    const realUpdate = db.update.bind(db);
    const spy = vi.spyOn(db, "update").mockImplementationOnce(((table: typeof canvases) => {
      void realUpdate(canvases)
        .set({ visibility: "unlisted" })
        .where(eq(canvases.id, team))
        .then(() => {});
      return realUpdate(table);
    }) as never);
    const result = await setVisibility("bob", team, "team");
    spy.mockRestore();
    return { team, result };
  }

  it("doesn't apply the stale change or announce it", async () => {
    const { team } = await racedNarrowing();
    expect(await stored(team)).toBe("unlisted");
    expect(changes()).toEqual([]);
  });

  it("reports the stored visibility, not the one that didn't land", async () => {
    const { team, result } = await racedNarrowing();
    expect(result.visibility).toBe(await stored(team));
  });
});
