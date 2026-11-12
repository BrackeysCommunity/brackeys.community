import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseAudit,
  projectContributors,
  projectTeams,
  projects,
  teamMembers,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import {
  createShowcase,
  linkShowcase,
  unlinkShowcase,
  type ShowcaseDeps,
} from "../engine-showcase";
import type { Actor, ReleaseTxDb } from "../release-upload";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "showcase-fixture";
const OTHER = "showcase-other";
const NOW = new Date("2026-11-12T15:00:00Z");

const creator: Actor = { kind: "user", userId: "creator" };
const outsider: Actor = { kind: "user", userId: "outsider" };
const agent: Actor = { kind: "agent", userId: "creator" };

const deps: ShowcaseDeps = { db: db as unknown as ReleaseTxDb, now: () => NOW };

const linkedId = async (projectId = PROJECT) => {
  const [row] = await db
    .select({ showcaseProjectId: engineProjects.showcaseProjectId })
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId));
  return row!.showcaseProjectId;
};

const auditRows = () =>
  db
    .select({
      action: engineReleaseAudit.action,
      actorId: engineReleaseAudit.actorId,
      detail: engineReleaseAudit.detail,
    })
    .from(engineReleaseAudit)
    .where(eq(engineReleaseAudit.projectId, PROJECT))
    .orderBy(asc(engineReleaseAudit.id));

const page = async (title: string, createdBy: string | null) => {
  const [row] = await db
    .insert(projects)
    .values({ slug: title.toLowerCase().replace(/\s+/g, "-"), title, createdBy })
    .returning({ id: projects.id });
  return row!.id;
};

beforeAll(async () => {
  await seedUser(db, "creator", { guildNickname: "Creator Nick" });
  await seedUser(db, "outsider");
  await seedUser(db, "teammate");
});

beforeEach(async () => {
  await db.delete(engineReleaseAudit);
  await db.delete(engineProjects);
  await db.delete(projects);
  await db.delete(teams);
  await db.insert(engineProjects).values([
    { projectId: PROJECT, name: "Showcase Fixture", game: "fixture-game", createdById: "creator" },
    { projectId: OTHER, name: "Other Game", game: "fixture-game", createdById: "creator" },
  ]);
});

describe("linkShowcase", () => {
  it("needs canEditProject on the page, even for the game's publisher", async () => {
    const stranger = await page("Stranger Page", "outsider");
    await expect(
      linkShowcase({ projectId: PROJECT, showcaseProjectId: stranger, actor: creator }, deps),
    ).rejects.toMatchObject({
      status: 403,
      body: {
        code: "release-forbidden",
        message: "Only the people credited on Stranger Page can link a game to it.",
      },
    });
    expect(await linkedId()).toBeNull();

    await db
      .insert(projectContributors)
      .values({ projectId: stranger, profileId: "creator", displayName: "Creator" });
    await linkShowcase({ projectId: PROJECT, showcaseProjectId: stranger, actor: creator }, deps);
    expect(await linkedId()).toBe(stranger);
    expect(await auditRows()).toEqual([
      {
        action: "settings",
        actorId: "creator",
        detail: { before: { showcaseProjectId: null }, after: { showcaseProjectId: stranger } },
      },
    ]);
  });

  it("is for the game's publishers only, never an agent token", async () => {
    const own = await page("Outsider Own", "outsider");
    for (const actor of [outsider, agent]) {
      await expect(
        linkShowcase({ projectId: PROJECT, showcaseProjectId: own, actor }, deps),
      ).rejects.toMatchObject({ body: { code: "release-forbidden" } });
    }
    expect(await linkedId()).toBeNull();
  });

  it("refuses a page that doesn't exist and a game that doesn't", async () => {
    await expect(
      linkShowcase({ projectId: PROJECT, showcaseProjectId: "nope", actor: creator }, deps),
    ).rejects.toMatchObject({ status: 404, body: { code: "not-found" } });
    const own = await page("Mine", "creator");
    await expect(
      linkShowcase({ projectId: "missing-game", showcaseProjectId: own, actor: creator }, deps),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("links a page to one game only, and relinking the same page writes nothing", async () => {
    const own = await page("Shared Page", "creator");
    await linkShowcase({ projectId: OTHER, showcaseProjectId: own, actor: creator }, deps);
    await expect(
      linkShowcase({ projectId: PROJECT, showcaseProjectId: own, actor: creator }, deps),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "game-showcase-taken", message: "Shared Page already shows another game." },
    });
    expect(await linkedId()).toBeNull();

    await linkShowcase({ projectId: OTHER, showcaseProjectId: own, actor: creator }, deps);
    expect(
      await db.select().from(engineReleaseAudit).where(eq(engineReleaseAudit.projectId, OTHER)),
    ).toHaveLength(1);
  });

  it("replaces the game's current page with the new one", async () => {
    const first = await page("First Page", "creator");
    const second = await page("Second Page", "creator");
    await linkShowcase({ projectId: PROJECT, showcaseProjectId: first, actor: creator }, deps);
    await linkShowcase({ projectId: PROJECT, showcaseProjectId: second, actor: creator }, deps);
    expect(await linkedId()).toBe(second);
    expect((await auditRows())[1]!.detail).toEqual({
      before: { showcaseProjectId: first },
      after: { showcaseProjectId: second },
    });
  });
});

describe("createShowcase", () => {
  it("makes a web game page titled from the project, credits the caller and adds the team", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "showcase-team", name: "Team", createdBy: "teammate" })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values({ teamId: team!.id, userId: "creator", role: "owner" });
    await db.update(engineProjects).set({ teamId: team!.id });

    const { showcaseProjectId } = await createShowcase(
      { projectId: PROJECT, actor: creator },
      deps,
    );
    expect(await linkedId()).toBe(showcaseProjectId);

    const [row] = await db.select().from(projects).where(eq(projects.id, showcaseProjectId));
    expect(row).toMatchObject({
      title: "Showcase Fixture",
      slug: "showcase-fixture",
      type: "game",
      subTypes: ["web"],
      source: "manual",
      createdBy: "creator",
    });
    expect(
      await db
        .select({
          profileId: projectContributors.profileId,
          displayName: projectContributors.displayName,
        })
        .from(projectContributors)
        .where(eq(projectContributors.projectId, showcaseProjectId)),
    ).toEqual([{ profileId: "creator", displayName: "Creator Nick" }]);
    expect(
      await db
        .select({ teamId: projectTeams.teamId })
        .from(projectTeams)
        .where(eq(projectTeams.projectId, showcaseProjectId)),
    ).toEqual([{ teamId: team!.id }]);
    expect(await auditRows()).toEqual([
      {
        action: "settings",
        actorId: "creator",
        detail: {
          before: { showcaseProjectId: null },
          after: { showcaseProjectId },
          created: true,
        },
      },
    ]);
  });

  it("adds no team for a personal project", async () => {
    const { showcaseProjectId } = await createShowcase(
      { projectId: PROJECT, actor: creator },
      deps,
    );
    expect(
      await db.select().from(projectTeams).where(eq(projectTeams.projectId, showcaseProjectId)),
    ).toEqual([]);
  });

  it("refuses a second page while one is linked, and outsiders altogether", async () => {
    await createShowcase({ projectId: PROJECT, actor: creator }, deps);
    await expect(
      createShowcase({ projectId: PROJECT, actor: creator }, deps),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "game-showcase-linked",
        message: "This game already has a project page: Showcase Fixture.",
      },
    });
    await expect(createShowcase({ projectId: OTHER, actor: outsider }, deps)).rejects.toMatchObject(
      { body: { code: "release-forbidden" } },
    );
    expect(await db.select().from(projects)).toHaveLength(1);
  });
});

describe("unlinkShowcase", () => {
  it("clears the column, keeps the page and audits it once", async () => {
    const { showcaseProjectId } = await createShowcase(
      { projectId: PROJECT, actor: creator },
      deps,
    );
    await unlinkShowcase({ projectId: PROJECT, actor: creator }, deps);
    expect(await linkedId()).toBeNull();
    expect(await db.select().from(projects).where(eq(projects.id, showcaseProjectId))).toHaveLength(
      1,
    );

    await unlinkShowcase({ projectId: PROJECT, actor: creator }, deps);
    expect((await auditRows()).map((r) => r.detail)).toEqual([
      { before: { showcaseProjectId: null }, after: { showcaseProjectId }, created: true },
      { before: { showcaseProjectId }, after: { showcaseProjectId: null } },
    ]);
  });

  it("is for publishers only", async () => {
    await createShowcase({ projectId: PROJECT, actor: creator }, deps);
    await expect(
      unlinkShowcase({ projectId: PROJECT, actor: outsider }, deps),
    ).rejects.toMatchObject({ body: { code: "release-forbidden" } });
    expect(await linkedId()).not.toBeNull();
  });
});
