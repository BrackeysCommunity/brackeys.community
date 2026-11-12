import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseChannels,
  engineReleases,
  forumCategories,
  forumPosts,
  itchJamEntries,
  itchJams,
  profileProjects,
  profileUrlStubs,
  projects,
  teams,
} from "@/db/schema";
import { seedCollabPost, seedUser, type TestDb } from "@/test/db";

// `indexableProjectFilter` is hand-written SQL across four schemas: a wrong
// table name in it throws at crawl time and nowhere else. The module reads
// the app's db singleton at import time, hence the dynamic import.
const db: TestDb = await (async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
})();

vi.mock("@/db", () => ({ db }));

let forumEnabled = false;
let gamesEnabled = true;
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) =>
    flag === "engine-games-enabled" ? gamesEnabled : forumEnabled,
}));

const guard = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => guard.allowed }));

let sitemap: typeof import("@/lib/sitemap");
let games: typeof import("@/lib/og/game");

beforeAll(async () => {
  sitemap = await import("@/lib/sitemap");
  games = await import("@/lib/og/game");
});

async function seedJam(jamId: number, overrides: Partial<typeof itchJams.$inferInsert> = {}) {
  await db.insert(itchJams).values({
    jamId,
    slug: `jam-${jamId}`,
    title: `Jam ${jamId}`,
    status: "over",
    ...overrides,
  });
}

async function seedProject(slug: string, overrides: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db
    .insert(projects)
    .values({ slug, title: slug, ...overrides })
    .returning({ id: projects.id });
  return row!.id;
}

describe("sitemap sections", () => {
  it("lists live jams and omits the ones itch dropped", async () => {
    await seedJam(1);
    await seedJam(2, { missingSince: new Date() });

    const xml = await sitemap.renderSitemapSection("jams", 0);

    expect(xml).toContain("/jams/jam-1<");
    expect(xml).not.toContain("/jams/jam-2<");
  });

  it("advertises a profile under its claimed handle, not its id", async () => {
    await seedUser(db, "with-stub");
    await seedUser(db, "no-stub");
    await db.insert(profileUrlStubs).values({ profileId: "with-stub", stub: "vanity" });

    const xml = await sitemap.renderSitemapSection("profiles", 0);

    expect(xml).toContain("/profile/vanity<");
    expect(xml).not.toContain("/profile/with-stub<");
    expect(xml).toContain("/profile/no-stub<");
  });

  it("keeps expired collab posts out", async () => {
    const author = await seedUser(db, "poster");
    await seedCollabPost(db, author, { title: "open one" });
    const expired = await seedCollabPost(db, author, { status: "expired" });

    const xml = await sitemap.renderSitemapSection("collab", 0);

    expect(xml).not.toContain(`/collab/${expired}<`);
  });

  it("lists teams and the static pages", async () => {
    await db.insert(teams).values({ slug: "team-one", name: "Team One", createdBy: "poster" });

    expect(await sitemap.renderSitemapSection("teams", 0)).toContain("/teams/team-one<");
    const statics = await sitemap.renderSitemapSection("static", 0);
    expect(statics).toContain("/jams/archive<");
    expect(statics).not.toContain("/command-center");
  });

  it("indexes only anchored projects, matching getProject's own rule", async () => {
    // Unpublished: never, whatever anchors it.
    await seedProject("hidden", { published: false, createdBy: "poster" });
    // A stranger's game minted from one jam appearance.
    await seedProject("drive-by", { sourceGameId: 900 });
    await seedJam(10);
    await db.insert(itchJamEntries).values({
      entryId: 1,
      jamId: 10,
      gameId: 900,
      rateUrl: "https://itch.io/jam/jam-10/rate/1",
      gameTitle: "Drive By",
      gameUrl: "https://example.itch.io/drive-by",
    });
    await seedProject("authored", { createdBy: "poster" });
    const placed = await seedProject("placed");
    await db
      .insert(profileProjects)
      .values({ profileId: "poster", projectId: placed, title: "Placed" });

    const xml = await sitemap.renderSitemapSection("projects", 0);

    expect(xml).toContain("/projects/authored<");
    expect(xml).toContain("/projects/placed<");
    expect(xml).not.toContain("/projects/hidden<");
    expect(xml).not.toContain("/projects/drive-by<");
  });

  it("promotes a drive-by mint once a second jam appearance lands", async () => {
    await seedJam(11);
    await db.insert(itchJamEntries).values({
      entryId: 2,
      jamId: 11,
      gameId: 900,
      rateUrl: "https://itch.io/jam/jam-11/rate/2",
      gameTitle: "Drive By",
      gameUrl: "https://example.itch.io/drive-by",
    });

    expect(await sitemap.renderSitemapSection("projects", 0)).toContain("/projects/drive-by<");
  });
});

describe("forum section", () => {
  it("lists live posts under their slugged URL, only while the flag is on", async () => {
    await seedUser(db, "forum-author");
    const [category] = await db
      .select({ id: forumCategories.id })
      .from(forumCategories)
      .where(eq(forumCategories.slug, "help"));
    const insert = (values: Partial<typeof forumPosts.$inferInsert>) =>
      db
        .insert(forumPosts)
        .values({
          kind: "question",
          categoryId: category!.id,
          authorId: "forum-author",
          title: "t",
          body: "b",
          status: "published",
          publishedAt: new Date(),
          ...values,
        })
        .returning({ id: forumPosts.id });
    const [live] = await insert({ slug: "how-do-i" });
    const [hidden] = await insert({ slug: "hidden-one", hiddenAt: new Date() });
    const [draft] = await insert({ slug: "draft-one", status: "draft", publishedAt: null });

    expect(await sitemap.renderSitemapSection("forum", 0)).not.toContain("/forum/");

    forumEnabled = true;
    const xml = await sitemap.renderSitemapSection("forum", 0);
    forumEnabled = false;

    expect(xml).toContain(`/forum/${live!.id}-how-do-i<`);
    expect(xml).not.toContain(`/forum/${hidden!.id}-`);
    expect(xml).not.toContain(`/forum/${draft!.id}-`);
  });
});

describe("games section", () => {
  async function seedGame(
    projectId: string,
    digit: string,
    overrides: Partial<typeof engineProjects.$inferInsert> = {},
  ) {
    await db.insert(engineProjects).values({
      projectId,
      name: projectId,
      visibility: "public",
      publicApprovedAt: new Date(),
      ...overrides,
    });
    await db.insert(engineReleases).values({
      id: digit.repeat(64),
      projectId,
      version: 1,
      manifest: "{}",
      manifestBytes: 2,
      totalBytes: 10,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: "tactics",
      snapshot: "a".repeat(64),
      buildHash: "b".repeat(64),
      target: "web",
    });
    await db
      .insert(engineReleaseChannels)
      .values({ projectId, channel: "production", releaseId: digit.repeat(64) });
  }

  it("lists public, approved, playable games and nothing unlisted or private", async () => {
    await seedGame("lantern", "1");
    await seedGame("quiet", "2", { visibility: "unlisted" });
    await seedGame("secret", "3", { visibility: "private" });
    await seedGame("awaiting", "4", { publicApprovedAt: null });
    await seedGame("hidden", "5", { hiddenAt: new Date() });

    const urls = await games.gameSitemapUrls(0, sitemap.SITEMAP_PAGE_SIZE);

    expect(urls.map((url) => url.path)).toEqual(["/games/lantern"]);
    expect(await games.gameSitemapCount()).toBe(1);
    expect(await sitemap.renderSitemapSection("games", 0)).toContain("/games/lantern<");
  });

  it("lists none on production, or while games are closed to signed-out visitors", async () => {
    guard.allowed = false;
    try {
      expect(await games.gameSitemapUrls(0, sitemap.SITEMAP_PAGE_SIZE)).toEqual([]);
      expect(await games.gameSitemapCount()).toBe(0);
    } finally {
      guard.allowed = true;
    }
    gamesEnabled = false;
    try {
      expect(await games.gameSitemapUrls(0, sitemap.SITEMAP_PAGE_SIZE)).toEqual([]);
    } finally {
      gamesEnabled = true;
    }
  });
});

describe("sitemap index", () => {
  it("names a page for every section, even an empty one", async () => {
    const xml = await sitemap.renderSitemapIndex();

    for (const section of sitemap.SITEMAP_SECTIONS) {
      expect(xml).toContain(`section=${section}&amp;page=0`);
    }
    expect(xml).toContain("<sitemapindex");
  });
});
