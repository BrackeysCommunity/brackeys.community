import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
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

let sitemap: typeof import("@/lib/sitemap");

beforeAll(async () => {
  sitemap = await import("@/lib/sitemap");
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

describe("sitemap index", () => {
  it("names a page for every section, even an empty one", async () => {
    const xml = await sitemap.renderSitemapIndex();

    for (const section of sitemap.SITEMAP_SECTIONS) {
      expect(xml).toContain(`section=${section}&amp;page=0`);
    }
    expect(xml).toContain("<sitemapindex");
  });
});
