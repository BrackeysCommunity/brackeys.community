import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  profileProjects,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  teamMembers,
  teamProjects,
  teams,
} from "@/db/schema";
import { ORPHAN_PROJECT_GRACE_DAYS, sweepOrphanProjects } from "@/lib/project-orphan-sweep";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

const DAY_MS = 86_400_000;

let db: TestDb;
let teamId: string;

const now = new Date();
const stale = new Date(now.getTime() - (ORPHAN_PROJECT_GRACE_DAYS + 1) * DAY_MS);
const fresh = new Date(now.getTime() - (ORPHAN_PROJECT_GRACE_DAYS - 1) * DAY_MS);

async function seedProject(overrides: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `proj-${crypto.randomUUID().slice(0, 8)}`,
      title: "Leftover",
      source: "manual",
      createdBy: "maker",
      updatedAt: stale,
      ...overrides,
    })
    .returning({ id: projects.id });
  return row!.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedUser(db, "maker");
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "maker" })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db.insert(teamMembers).values({ teamId, userId: "maker", role: "owner" });
});

describe("sweepOrphanProjects", () => {
  it("collects a stale manual row nothing points at, and only that", async () => {
    const orphan = await seedProject();
    const recent = await seedProject({ updatedAt: fresh });
    const synced = await seedProject({ source: "itchio", sourceGameId: 77 });
    const credited = await seedProject();
    await db
      .insert(projectContributors)
      .values({ projectId: credited, displayName: "Someone", source: "manual" });
    const jammed = await seedProject();
    await db.insert(projectJamLinks).values({ projectId: jammed, jamName: "Off-itch jam" });
    const claimed = await seedProject();
    await db.insert(projectTeams).values({ projectId: claimed, teamId });
    const showcased = await seedProject();
    await db.insert(teamProjects).values({ teamId, projectId: showcased, title: "Leftover" });
    const placed = await seedProject();
    await db
      .insert(profileProjects)
      .values({ profileId: "maker", projectId: placed, title: "Leftover" });

    expect(await sweepOrphanProjects(db, now)).toBe(1);

    const left = (await db.select({ id: projects.id }).from(projects)).map((r) => r.id).sort();
    expect(left).toEqual([recent, synced, credited, jammed, claimed, showcased, placed].sort());
    expect(left).not.toContain(orphan);

    // Idempotent: the second pass finds nothing.
    expect(await sweepOrphanProjects(db, now)).toBe(0);
  });
});
