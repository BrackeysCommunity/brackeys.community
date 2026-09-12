import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collabPosts, developerProfiles, teamMembers, teams, user } from "@/db/schema";
import { isRecruiting } from "@/lib/team-recruiting";
import { getTeamStats, listTeams } from "@/orpc/router/team";
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

/**
 * Plan 33 §3.2. RECRUITING has to mean the same thing in the badge, the
 * directory's filter and the home page's count, or a visitor filters for
 * teams they can apply to and lands on pages with nothing to apply to —
 * which is what Cookie found on staging. `isRecruiting` is the client half
 * of the rule and `recruitingWithOpenPost` the SQL half; these assert the
 * two agree.
 */

let db: TestDb;

async function seedTeam(slug: string, recruiting: boolean) {
  const [team] = await db
    .insert(teams)
    .values({ slug, name: slug, recruiting, createdBy: "owner" })
    .returning();
  await db.insert(teamMembers).values({ teamId: team!.id, userId: "owner", role: "owner" });
  return team!.id;
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(collabPosts);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "owner");
});

describe("the RECRUITING facet", () => {
  it("keeps a flagged team that has an open post", async () => {
    const open = await seedTeam("open-crew", true);
    await seedCollabPost(db, "owner", { teamId: open });

    const listed = await call(listTeams, { recruiting: true }, asUser(null));

    expect(listed.teams.map((t) => t.slug)).toEqual(["open-crew"]);
    expect(listed.total).toBe(1);
  });

  it("drops a flagged team with nothing to apply to", async () => {
    await seedTeam("dead-end", true);

    const listed = await call(listTeams, { recruiting: true }, asUser(null));

    expect(listed.teams).toHaveLength(0);
    expect(listed.total).toBe(0);
  });

  it("drops a flagged team whose only post has closed", async () => {
    const closed = await seedTeam("closed-crew", true);
    await seedCollabPost(db, "owner", { teamId: closed, status: "closed" });

    const listed = await call(listTeams, { recruiting: true }, asUser(null));

    expect(listed.teams).toHaveLength(0);
  });

  it("drops an unflagged team even when its posts are open", async () => {
    const quiet = await seedTeam("quiet-crew", false);
    await seedCollabPost(db, "owner", { teamId: quiet });

    const listed = await call(listTeams, { recruiting: true }, asUser(null));

    expect(listed.teams).toHaveLength(0);
  });
});

describe("the SQL rule and the badge rule", () => {
  it("agree on every team the directory returns", async () => {
    const open = await seedTeam("open-crew", true);
    await seedCollabPost(db, "owner", { teamId: open });
    await seedTeam("dead-end", true);
    const quiet = await seedTeam("quiet-crew", false);
    await seedCollabPost(db, "owner", { teamId: quiet });

    const all = await call(listTeams, {}, asUser(null));
    const badged = all.teams.filter(isRecruiting).map((t) => t.slug);
    const filtered = await call(listTeams, { recruiting: true }, asUser(null));

    expect(badged.sort()).toEqual(filtered.teams.map((t) => t.slug).sort());
  });

  it("leads the default sort with the teams that are actually open", async () => {
    await seedTeam("dead-end", true);
    const open = await seedTeam("open-crew", true);
    await seedCollabPost(db, "owner", { teamId: open });

    const all = await call(listTeams, {}, asUser(null));

    expect(all.teams[0]!.slug).toBe("open-crew");
  });
});

describe("getTeamStats", () => {
  it("counts only the teams a visitor could actually apply to", async () => {
    const open = await seedTeam("open-crew", true);
    await seedCollabPost(db, "owner", { teamId: open });
    await seedTeam("dead-end", true);
    await seedTeam("quiet-crew", false);

    expect(await call(getTeamStats, {}, asUser(null))).toEqual({ active: 3, recruiting: 1 });
  });
});
