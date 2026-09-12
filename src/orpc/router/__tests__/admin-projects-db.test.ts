import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  profileProjects,
  projectContributors,
  projectTeams,
  projects,
  teamMembers,
  teamProjects,
  teams,
  user,
} from "@/db/schema";
import { projectHasAnchors } from "@/lib/projects";
import { listProjectsAdmin, PROJECT_ADMIN_SORTS } from "@/orpc/router/admin";
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
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));

/**
 * Plan 33 §11.2: the admin project directory. Its ORPHANS filter is
 * `projectHasAnchors` run as one query, so the two must agree row for row —
 * a disagreement here is a project staff can't find or a sweep that takes
 * something staff were told was safe.
 */

let db: TestDb;

async function seedProject(title: string, overrides: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db
    .insert(projects)
    .values({
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      title,
      createdBy: "maker",
      ...overrides,
    })
    .returning({ id: projects.id });
  return row!.id;
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(projects);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "maker", { guildNickname: "Maker" });
  await seedUser(db, "mod", { guildRoles: ["Moderator"] });
});

describe("listProjectsAdmin", () => {
  it("is staff-only", async () => {
    await expect(call(listProjectsAdmin, {}, asUser("maker"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("ORPHANS matches projectHasAnchors row for row, and search finds by title or handle", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "crew", name: "Crew", createdBy: "maker" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values({ teamId: team!.id, userId: "maker", role: "owner" });

    const orphan = await seedProject("Real Project");
    const unpublishedOrphan = await seedProject("Hidden Thing", { published: false });
    const synced = await seedProject("Scraped Game", { source: "itchio", sourceGameId: 5 });
    // A manual row that carries a game id is not self-anchoring: only a
    // scrape-minted one is.
    const manualWithId = await seedProject("Manual With Id", { sourceGameId: 6 });
    const showcased = await seedProject("Team Showcase");
    await db.insert(teamProjects).values({ teamId: team!.id, projectId: showcased, title: "x" });
    // A claim alone is a credit-level fact, not a placement, so it does not
    // anchor — same as the predicate.
    const claimedOnly = await seedProject("Claimed Only");
    await db.insert(projectTeams).values({ projectId: claimedOnly, teamId: team!.id });
    const placed = await seedProject("On A Profile");
    await db.insert(profileProjects).values({ profileId: "maker", projectId: placed, title: "x" });

    const all = await call(listProjectsAdmin, { pageSize: 50 }, asUser("mod"));
    expect(all.total).toBe(7);
    for (const item of all.items) {
      expect(item.anchored, item.title).toBe(await projectHasAnchors(item.id));
    }

    const orphans = await call(
      listProjectsAdmin,
      { orphansOnly: true, pageSize: 50 },
      asUser("mod"),
    );
    expect(orphans.items.map((i) => i.id).sort()).toEqual(
      [orphan, unpublishedOrphan, manualWithId, claimedOnly].sort(),
    );
    expect(orphans.items.map((i) => i.id)).not.toContain(synced);
    expect(orphans.items.every((i) => i.creator?.displayName === "Maker")).toBe(true);

    const byTitle = await call(listProjectsAdmin, { search: "real" }, asUser("mod"));
    expect(byTitle.items.map((i) => i.id)).toEqual([orphan]);
    const byHandle = await call(listProjectsAdmin, { search: "hidden-th" }, asUser("mod"));
    expect(byHandle.items.map((i) => i.id)).toEqual([unpublishedOrphan]);
  });

  it("search is fuzzy — punctuation and a dropped letter still find the row — and literal matches rank first", async () => {
    const exact = await seedProject("Zeno's Escape");
    const near = await seedProject("Zenos Escapade");
    const other = await seedProject("Trustworthy Endings");

    const punctuation = await call(listProjectsAdmin, { search: "zenos escape" }, asUser("mod"));
    expect(punctuation.items.map((i) => i.id)).toContain(exact);
    expect(punctuation.items.map((i) => i.id)).not.toContain(other);

    const dropped = await call(listProjectsAdmin, { search: "trustwothy" }, asUser("mod"));
    expect(dropped.items.map((i) => i.id)).toEqual([other]);

    const literal = await call(listProjectsAdmin, { search: "escape" }, asUser("mod"));
    expect(literal.items[0]!.id).toBe(exact);
    expect(literal.items.map((i) => i.id)).toContain(near);
  });

  it("filters by source, visibility, kind and creator, and sorts", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "crew", name: "Crew", createdBy: "maker" })
      .returning({ id: teams.id });
    const scraped = await seedProject("Scraped", {
      source: "itchio",
      sourceGameId: 9,
      createdBy: null,
      type: "tool",
    });
    const hidden = await seedProject("Hidden", { published: false });
    const credited = await seedProject("Credited");
    await db.insert(projectContributors).values([
      { projectId: credited, displayName: "A" },
      { projectId: credited, displayName: "B" },
    ]);
    await db.insert(projectTeams).values({ projectId: credited, teamId: team!.id });

    const ids = async (input: {
      source?: "itchio" | "manual";
      visibility?: "unpublished";
      type?: "tool";
      creator?: "member" | "none";
      sort?: (typeof PROJECT_ADMIN_SORTS)[number];
    }) => (await call(listProjectsAdmin, input, asUser("mod"))).items.map((i) => i.id);

    expect(await ids({ source: "itchio" })).toEqual([scraped]);
    expect((await ids({ source: "manual" })).sort()).toEqual([hidden, credited].sort());
    expect(await ids({ visibility: "unpublished" })).toEqual([hidden]);
    expect(await ids({ type: "tool" })).toEqual([scraped]);
    expect(await ids({ creator: "none" })).toEqual([scraped]);
    expect((await ids({ creator: "member" })).sort()).toEqual([hidden, credited].sort());
    expect((await ids({ sort: "credits" }))[0]).toBe(credited);
    expect(await ids({ sort: "title" })).toEqual([credited, hidden, scraped]);
    expect(await ids({ sort: "oldest" })).toEqual([scraped, hidden, credited]);
  });
});
