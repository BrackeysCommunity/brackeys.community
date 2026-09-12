import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  moderationActions,
  notifications,
  profileProjects,
  projectContributors,
  projectTeams,
  projects,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { findFreeProjectSlug } from "@/lib/projects";
import {
  deleteProject,
  getProject,
  getProjectViewerState,
  setProjectPublished,
} from "@/orpc/router/project";
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
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));

/**
 * Plan 33 §11.1: a project's two unshared writes. Deleting is the creator's
 * (or an admin's, with a reason) and is refused while anyone else's page
 * still points at the row or the row is scrape-synced; unpublishing is any
 * editor's, staff can do it directly with a reason, and every staff act
 * leaves an audit row plus a notice to the creator.
 */

let db: TestDb;

async function seedProject(overrides: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db
    .insert(projects)
    .values({
      slug: "real-project",
      title: "Real Project",
      createdBy: "creator",
      source: "manual",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedTeam(ownerId: string, name = "Studio Chonk") {
  const [team] = await db
    .insert(teams)
    .values({ slug: `team-${crypto.randomUUID().slice(0, 8)}`, name, createdBy: ownerId })
    .returning({ id: teams.id });
  await db.insert(teamMembers).values({ teamId: team!.id, userId: ownerId, role: "owner" });
  return team!.id;
}

async function auditRows() {
  return db.select().from(moderationActions);
}

async function noticesFor(userId: string) {
  return db
    .select({ type: notifications.type, data: notifications.data })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(projects);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "creator");
  await seedUser(db, "other", { guildNickname: "Yasahiro" });
  await seedUser(db, "stranger");
  await seedUser(db, "mod", { guildRoles: ["Moderator"] });
  await seedUser(db, "admin", { guildRoles: ["Admin"] });
});

describe("deleteProject — the creator", () => {
  it("deletes a row nothing else anchors, frees the slug, and audits nothing", async () => {
    const project = await seedProject();
    await db.insert(projectContributors).values({
      projectId: project.id,
      profileId: "creator",
      displayName: "Creator",
    });

    await call(deleteProject, { projectId: project.id }, asUser("creator"));

    expect(await db.select().from(projects)).toHaveLength(0);
    expect(await db.select().from(projectContributors)).toHaveLength(0);
    expect(await findFreeProjectSlug("Real Project")).toBe("real-project");
    expect(await auditRows()).toHaveLength(0);
  });

  it("is refused while another member is credited, naming them", async () => {
    const project = await seedProject();
    await db.insert(projectContributors).values({
      projectId: project.id,
      profileId: "other",
      displayName: "Yasahiro",
    });

    await expect(
      call(deleteProject, { projectId: project.id }, asUser("creator")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Yasahiro") });
    expect(await db.select().from(projects)).toHaveLength(1);
  });

  it("is refused while a team claims it, and while another member showcases it", async () => {
    const project = await seedProject();
    const teamId = await seedTeam("other");
    await db.insert(projectTeams).values({ projectId: project.id, teamId });
    await db.insert(profileProjects).values({
      profileId: "other",
      projectId: project.id,
      title: "Real Project",
    });

    await expect(
      call(deleteProject, { projectId: project.id }, asUser("creator")),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /Studio Chonk.*Yasahiro's showcase|Yasahiro's showcase.*Studio Chonk/,
      ),
    });
  });

  it("is refused for a synced row, pointing at unpublish", async () => {
    const project = await seedProject({ source: "itchio", sourceGameId: 4242 });

    await expect(
      call(deleteProject, { projectId: project.id }, asUser("creator")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("npublish") });

    await call(setProjectPublished, { projectId: project.id, published: false }, asUser("creator"));
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row!.published).toBe(false);
  });

  it("refuses a credited editor who is not the creator, and a stranger", async () => {
    const project = await seedProject();
    await db.insert(projectContributors).values({
      projectId: project.id,
      profileId: "other",
      displayName: "Yasahiro",
    });

    await expect(
      call(deleteProject, { projectId: project.id }, asUser("other")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(deleteProject, { projectId: project.id }, asUser("stranger")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("deleteProject — staff", () => {
  it("is admin-only: a moderator is refused, an admin without a reason is refused", async () => {
    const project = await seedProject();

    await expect(
      call(deleteProject, { projectId: project.id, reason: "spam" }, asUser("mod")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call(deleteProject, { projectId: project.id }, asUser("admin"))).rejects.toThrow(
      /reason is required/,
    );
    expect(await db.select().from(projects)).toHaveLength(1);
  });

  it("an admin deletes past other holders, keeps the row in the log, and notifies the creator", async () => {
    const project = await seedProject();
    const teamId = await seedTeam("other");
    await db.insert(projectTeams).values({ projectId: project.id, teamId });

    await call(deleteProject, { projectId: project.id, reason: "stolen work" }, asUser("admin"));

    expect(await db.select().from(projects)).toHaveLength(0);
    const [logged] = await auditRows();
    expect(logged).toMatchObject({
      action: "project_deleted",
      actorId: "admin",
      subjectUserId: "creator",
      targetType: "project",
      targetId: project.id,
      reason: "stolen work",
    });
    expect(logged!.metadata).toMatchObject({
      projectSlug: "real-project",
      project: { id: project.id, title: "Real Project" },
    });

    const notices = await noticesFor("creator");
    expect(notices.map((n) => n.type)).toEqual(["project_deleted_by_staff"]);
    expect(notices[0]!.data).toMatchObject({ projectTitle: "Real Project", reason: "stolen work" });
  });
});

describe("setProjectPublished", () => {
  it("any editor flips it silently, and the public read stops serving the page", async () => {
    const project = await seedProject();
    await db.insert(projectContributors).values({
      projectId: project.id,
      profileId: "other",
      displayName: "Yasahiro",
    });

    await call(setProjectPublished, { projectId: project.id, published: false }, asUser("other"));

    expect(await call(getProject, { idOrSlug: "real-project" }, asUser(null))).toBeNull();
    const viewer = await call(getProjectViewerState, { idOrSlug: "real-project" }, asUser("other"));
    expect(viewer.detail?.project.id).toBe(project.id);
    expect(await auditRows()).toHaveLength(0);
    expect(await noticesFor("creator")).toHaveLength(0);

    await call(setProjectPublished, { projectId: project.id, published: true }, asUser("other"));
    expect((await call(getProject, { idOrSlug: "real-project" }, asUser(null)))?.project.id).toBe(
      project.id,
    );
  });

  it("refuses a stranger, and a moderator unpublishing without a reason", async () => {
    const project = await seedProject();

    await expect(
      call(setProjectPublished, { projectId: project.id, published: false }, asUser("stranger")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(setProjectPublished, { projectId: project.id, published: false }, asUser("mod")),
    ).rejects.toThrow(/reason is required/);
  });

  it("a moderator unpublishes with a reason, audits it, and notifies the creator", async () => {
    const project = await seedProject();

    const result = await call(
      setProjectPublished,
      { projectId: project.id, published: false, reason: "not theirs" },
      asUser("mod"),
    );
    expect(result).toEqual({ success: true, changed: true });

    const [logged] = await auditRows();
    expect(logged).toMatchObject({
      action: "project_unpublished",
      actorId: "mod",
      subjectUserId: "creator",
      reason: "not theirs",
    });
    const notices = await noticesFor("creator");
    expect(notices.map((n) => n.type)).toEqual(["project_unpublished_by_staff"]);
    expect(notices[0]!.data).toMatchObject({ projectSlug: "real-project", reason: "not theirs" });

    // Already there: nothing to write, nothing to log twice.
    expect(
      await call(
        setProjectPublished,
        { projectId: project.id, published: false, reason: "again" },
        asUser("mod"),
      ),
    ).toEqual({ success: true, changed: false });
    expect(await auditRows()).toHaveLength(1);
  });
});

describe("getProjectViewerState", () => {
  it("tells the creator whether they may delete, and who still holds the row", async () => {
    const project = await seedProject();
    await db.insert(projectContributors).values({
      projectId: project.id,
      profileId: "other",
      displayName: "Yasahiro",
    });

    const creator = await call(
      getProjectViewerState,
      { idOrSlug: "real-project" },
      asUser("creator"),
    );
    expect(creator.viewerCanDelete).toBe(true);
    expect(creator.deleteBlockers).toEqual(["Yasahiro (credited)"]);

    const other = await call(getProjectViewerState, { idOrSlug: "real-project" }, asUser("other"));
    expect(other.viewerCanEdit).toBe(true);
    expect(other.viewerCanDelete).toBe(false);
    expect(other.deleteBlockers).toEqual([]);
  });

  it("never offers delete on a synced row", async () => {
    await seedProject({ source: "itchio", sourceGameId: 4242 });
    const creator = await call(
      getProjectViewerState,
      { idOrSlug: "real-project" },
      asUser("creator"),
    );
    expect(creator.viewerCanDelete).toBe(false);
  });
});
