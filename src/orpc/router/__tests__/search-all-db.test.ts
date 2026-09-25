import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPosts,
  developerProfiles,
  forumPosts,
  itchJamEntries,
  itchJams,
  profileUrlStubs,
  teams,
  threads,
  user,
} from "@/db/schema";
import { createForumPost } from "@/orpc/router/forum";
import { searchAll } from "@/orpc/router/search";
import { seedCollabPost, seedUser, type TestDb } from "@/test/db";
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
  refreshGuildRolesThrottled: async () => {},
}));
let forumEnabled = true;
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => forumEnabled,
}));

let db: TestDb;
const DAY = 86_400_000;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  forumEnabled = true;
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(collabPosts);
  await db.delete(teams);
  await db.delete(itchJamEntries);
  await db.delete(itchJams);
  await db.delete(profileUrlStubs);
  await db.delete(developerProfiles);
  await db.delete(user);
});

const search = (q: string, viewer: string | null = null) =>
  call(searchAll, { q }, asUser(viewer)).then((r) => r.hits);

async function seedJam(jamId: number, title: string, endsAt: Date) {
  await db.insert(itchJams).values({
    jamId,
    slug: `jam-${jamId}`,
    title,
    status: "running",
    startsAt: new Date(endsAt.getTime() - 7 * DAY),
    endsAt,
  });
}

async function seedEntry(entryId: number, jamId: number, gameTitle: string) {
  await db.insert(itchJamEntries).values({
    entryId,
    jamId,
    gameId: entryId * 10,
    rateUrl: `/jam/x/rate/${entryId}`,
    gameTitle,
    gameUrl: `https://x.itch.io/${entryId}`,
  });
}

async function seedTeam(
  slug: string,
  name: string,
  extra: Partial<typeof teams.$inferInsert> = {},
) {
  await seedUser(db, `owner-${slug}`);
  await db.insert(teams).values({ slug, name, createdBy: `owner-${slug}`, ...extra });
}

describe("searchAll", () => {
  it("finds a jam with or without the apostrophe", async () => {
    await seedJam(1, "Zeno's Escape Jam", new Date(Date.now() + DAY));
    for (const q of ["zenos escape", "zeno escape"]) {
      const hits = await search(q);
      expect(hits[0]).toMatchObject({ kind: "jam", title: "Zeno's Escape Jam", phase: "running" });
      expect(hits[0]!.href).toBe("/jams/jam-1");
    }
  });

  it("folds accents on jam titles and member names", async () => {
    await seedJam(2, "LÖVE Jam", new Date(Date.now() + DAY));
    await seedUser(db, "u1", { discordUsername: "Zoë" });
    expect((await search("love jam"))[0]).toMatchObject({ kind: "jam", title: "LÖVE Jam" });
    expect((await search("zoe"))[0]).toMatchObject({ kind: "member", name: "Zoë" });
  });

  it("finds a member by their @handle stub, typo and all", async () => {
    await seedUser(db, "u2", { discordUsername: "Display Name" });
    await db.insert(profileUrlStubs).values({ profileId: "u2", stub: "pixelwizard" });
    const hits = await search("@pixelwizrd");
    expect(hits[0]).toMatchObject({
      kind: "member",
      stub: "pixelwizard",
      href: "/profile/pixelwizard",
    });
  });

  it("puts an exact name match first across kinds", async () => {
    await seedUser(db, "u3", { discordUsername: "godot" });
    await seedTeam("godot-crew", "Godot Crew");
    await seedJam(3, "Godot Wild Jam", new Date(Date.now() + DAY));
    const hits = await search("godot");
    expect(hits[0]).toMatchObject({ kind: "member", name: "godot" });
    expect(hits.map((h) => h.kind)).toEqual(expect.arrayContaining(["team", "jam"]));
  });

  it("never returns a hidden team", async () => {
    await seedTeam("shadow", "Shadow Team", { hiddenAt: new Date() });
    await seedTeam("sunny", "Sunny Team");
    const names = (await search("team")).filter((h) => h.kind === "team").map((h) => h.name);
    expect(names).toEqual(["Sunny Team"]);
  });

  it("hides expired collab posts", async () => {
    await seedUser(db, "author");
    await seedCollabPost(db, "author", { title: "Need a pixel artist" });
    await seedCollabPost(db, "author", { title: "Need a pixel animator", status: "expired" });
    const titles = (await search("pixel")).filter((h) => h.kind === "collab").map((h) => h.title);
    expect(titles).toEqual(["Need a pixel artist"]);
  });

  it("searches entries of recent jams only", async () => {
    await seedJam(10, "Fresh Jam", new Date(Date.now() - 10 * DAY));
    await seedJam(11, "Old Jam", new Date(Date.now() - 400 * DAY));
    await seedEntry(100, 10, "Moonlight Garden");
    await seedEntry(101, 11, "Moonlight Harbor");
    const entries = (await search("moonlight")).filter((h) => h.kind === "entry");
    expect(entries).toEqual([
      expect.objectContaining({ title: "Moonlight Garden", href: "/projects/game/1000?jam=10" }),
    ]);
  });

  it("returns forum posts only while the flag is on", async () => {
    await seedUser(db, "alice");
    await db.update(user).set({ createdAt: new Date(Date.now() - 7 * DAY) });
    await call(
      createForumPost,
      { kind: "question", title: "Shader compile errors on Android", body: "help" },
      asUser("alice"),
    );
    expect((await search("shader compile"))[0]).toMatchObject({ kind: "forum" });
    forumEnabled = false;
    expect((await search("Shader compile errors on Android")).some((h) => h.kind === "forum")).toBe(
      false,
    );
  });

  it("limits the search to the requested kinds", async () => {
    await seedJam(4, "Brackeys Jam", new Date(Date.now() + DAY));
    await seedTeam("brackeys", "Brackeys Crew");
    const { hits } = await call(searchAll, { q: "brackeys", kinds: ["team"] }, asUser(null));
    expect(hits.map((h) => h.kind)).toEqual(["team"]);
  });
});
