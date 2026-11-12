import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  itchJams,
  projectContributors,
  projectTeams,
  projects,
  teamMembers,
  teams,
} from "@/db/schema";
import { playableGames } from "@/lib/engine/playable-game";
import {
  addProjectContributor,
  getProject,
  getProjectViewerState,
  listProjectsForGames,
  removeProjectContributor,
  setProjectSlug,
  updateProjectDetails,
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

const games = vi.hoisted(() => ({
  env: "staging" as "production" | "staging" | "development",
  flag: vi.fn(async (_flag: string, _id: string) => true),
}));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => games.env,
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: games.flag,
}));

/**
 * The project router mints and edits canonical rows, and its writes are all
 * guarded by the §1.3 editor union (createdBy ∪ credited profiles ∪ members
 * of a claiming team) rather than a single owner. These tests pin that gate
 * and the row-level contracts — the published/unpublished split, provider
 * ownership of release status, sub-type/kind coherence, slug policy, and
 * credit dedupe — against a migrated pglite database.
 */

let db: TestDb;

async function seedProject(overrides: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `proj-${crypto.randomUUID().slice(0, 8)}`,
      title: "Test Project",
      published: true,
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedTeam(ownerId: string) {
  const [team] = await db
    .insert(teams)
    .values({
      slug: `team-${crypto.randomUUID().slice(0, 8)}`,
      name: "Test Team",
      createdBy: ownerId,
    })
    .returning({ id: teams.id });
  await db.insert(teamMembers).values({ teamId: team!.id, userId: ownerId, role: "owner" });
  return team!.id;
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles, user } = await import("@/db/schema");
  games.env = "staging";
  games.flag.mockReset();
  games.flag.mockResolvedValue(true);
  await db.delete(engineProjects);
  await db.delete(itchJams);
  await db.delete(projects);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
});

describe("editor gate (§1.3 union)", () => {
  it("lets the creator edit", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator" });

    const updated = await call(
      updateProjectDetails,
      { projectId: project.id, title: "Renamed" },
      asUser("creator"),
    );
    expect(updated?.id).toBe(project.id);
  });

  it("lets a credited profile edit", async () => {
    await seedUser(db, "credited");
    const project = await seedProject();
    await db.insert(projectContributors).values({
      projectId: project.id,
      profileId: "credited",
      displayName: "Credited",
    });

    const updated = await call(
      updateProjectDetails,
      { projectId: project.id, title: "Renamed" },
      asUser("credited"),
    );
    expect(updated?.id).toBe(project.id);
  });

  it("lets a member of a claiming team edit", async () => {
    await seedUser(db, "member");
    const teamId = await seedTeam("member");
    const project = await seedProject();
    await db.insert(projectTeams).values({ projectId: project.id, teamId });

    const updated = await call(
      updateProjectDetails,
      { projectId: project.id, title: "Renamed" },
      asUser("member"),
    );
    expect(updated?.id).toBe(project.id);
  });

  it("refuses a stranger with FORBIDDEN", async () => {
    await seedUser(db, "creator");
    await seedUser(db, "stranger");
    const project = await seedProject({ createdBy: "creator" });

    await expect(
      call(updateProjectDetails, { projectId: project.id, title: "Nope" }, asUser("stranger")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tells gone from not-yours with NOT_FOUND", async () => {
    await seedUser(db, "anyone");
    await expect(
      call(updateProjectDetails, { projectId: crypto.randomUUID(), title: "X" }, asUser("anyone")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("locks a scrape-minted project (no creator, no credits, no claim) to everyone", async () => {
    await seedUser(db, "visitor");
    const project = await seedProject({ createdBy: null, source: "itchio", sourceGameId: 777 });

    await expect(
      call(updateProjectDetails, { projectId: project.id, title: "Claimed!" }, asUser("visitor")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getProject", () => {
  it("serves a published row by slug or id", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator", slug: "shipped-thing" });

    const bySlug = await call(getProject, { idOrSlug: "shipped-thing" }, asUser(null));
    const byId = await call(getProject, { idOrSlug: project.id }, asUser(null));
    expect(bySlug?.project.id).toBe(project.id);
    expect(byId?.project.id).toBe(project.id);
  });

  it("returns null for an unpublished row rather than a partial page", async () => {
    const project = await seedProject({ published: false });
    expect(await call(getProject, { idOrSlug: project.id }, asUser(null))).toBeNull();
  });

  it("never ships provider bookkeeping fields", async () => {
    const project = await seedProject();
    const detail = await call(getProject, { idOrSlug: project.id }, asUser(null));
    expect(detail).not.toBeNull();
    expect(detail!.project).not.toHaveProperty("providerRaw");
    expect(detail!.project).not.toHaveProperty("sourceSnapshot");
  });
});

describe("getProjectViewerState", () => {
  it("hands an editor the unpublished page the public read refuses", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator", published: false });

    const state = await call(getProjectViewerState, { idOrSlug: project.id }, asUser("creator"));
    expect(state.viewerCanEdit).toBe(true);
    expect(state.detail?.project.id).toBe(project.id);
  });

  it("gives a non-editor neither edit rights nor the unpublished page", async () => {
    await seedUser(db, "creator");
    await seedUser(db, "stranger");
    const project = await seedProject({ createdBy: "creator", published: false });

    const state = await call(getProjectViewerState, { idOrSlug: project.id }, asUser("stranger"));
    expect(state.viewerCanEdit).toBe(false);
    expect(state.detail).toBeNull();
  });
});

describe("updateProjectDetails row contracts", () => {
  it("keeps release status provider-owned on an imported project", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator", source: "itchio", sourceGameId: 1 });

    await expect(
      call(
        updateProjectDetails,
        { projectId: project.id, releaseStatus: "released" },
        asUser("creator"),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets a manual project own its release status", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator", source: "manual" });

    await call(
      updateProjectDetails,
      { projectId: project.id, releaseStatus: "in_development" },
      asUser("creator"),
    );
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row!.releaseStatus).toBe("in_development");
  });

  it("rejects sub-types that do not fit the kind being saved", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator", type: "web" });

    await expect(
      call(updateProjectDetails, { projectId: project.id, subTypes: ["music"] }, asUser("creator")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sheds sub-types a kind change makes meaningless", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({
      createdBy: "creator",
      type: "audio",
      subTypes: ["music", "sfx"],
    });

    await call(updateProjectDetails, { projectId: project.id, type: "web" }, asUser("creator"));
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row!.type).toBe("web");
    expect(row!.subTypes).toEqual([]);
  });
});

describe("setProjectSlug", () => {
  it("renames and normalizes to lowercase", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator" });

    const updated = await call(
      setProjectSlug,
      { projectId: project.id, slug: "My-New-Handle" },
      asUser("creator"),
    );
    expect(updated?.slug).toBe("my-new-handle");
  });

  it("rejects malformed and reserved handles", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator" });

    await expect(
      call(setProjectSlug, { projectId: project.id, slug: "-bad-" }, asUser("creator")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(setProjectSlug, { projectId: project.id, slug: "game" }, asUser("creator")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a handle another project holds", async () => {
    await seedUser(db, "creator");
    await seedProject({ slug: "taken" });
    const project = await seedProject({ createdBy: "creator" });

    await expect(
      call(setProjectSlug, { projectId: project.id, slug: "taken" }, asUser("creator")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets a project keep its own handle through the conflict check", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator", slug: "keeper" });

    const updated = await call(
      setProjectSlug,
      { projectId: project.id, slug: "keeper" },
      asUser("creator"),
    );
    expect(updated?.slug).toBe("keeper");
  });
});

describe("credits", () => {
  it("dedupes by linked profile", async () => {
    await seedUser(db, "creator");
    await seedUser(db, "friend");
    const project = await seedProject({ createdBy: "creator" });

    await call(
      addProjectContributor,
      { projectId: project.id, displayName: "Friend", profileId: "friend" },
      asUser("creator"),
    );
    await expect(
      call(
        addProjectContributor,
        { projectId: project.id, displayName: "Same Person", profileId: "friend" },
        asUser("creator"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("dedupes free-text names case-insensitively", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator" });

    await call(
      addProjectContributor,
      { projectId: project.id, displayName: "Alex Composer" },
      asUser("creator"),
    );
    await expect(
      call(
        addProjectContributor,
        { projectId: project.id, displayName: "alex composer" },
        asUser("creator"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to link a credit to a profile that does not exist", async () => {
    await seedUser(db, "creator");
    const project = await seedProject({ createdBy: "creator" });

    await expect(
      call(
        addProjectContributor,
        { projectId: project.id, displayName: "Ghost", profileId: "nobody" },
        asUser("creator"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a miscredited person remove themselves, giving up edit rights", async () => {
    await seedUser(db, "credited");
    const project = await seedProject();
    const [credit] = await db
      .insert(projectContributors)
      .values({ projectId: project.id, profileId: "credited", displayName: "Credited" })
      .returning({ id: projectContributors.id });

    await call(removeProjectContributor, { contributorId: credit!.id }, asUser("credited"));

    // The credit was their only claim, so the gate now refuses them.
    await expect(
      call(updateProjectDetails, { projectId: project.id, title: "X" }, asUser("credited")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("listProjectsForGames", () => {
  it("resolves only published projects for the requested games", async () => {
    await seedProject({ source: "itchio", sourceGameId: 101, published: true });
    await seedProject({ source: "itchio", sourceGameId: 102, published: false });

    const { projects: found } = await call(
      listProjectsForGames,
      { gameIds: [101, 102, 103] },
      asUser(null),
    );
    expect(found.map((p) => p.sourceGameId)).toEqual([101]);
  });
});

const hex = (n: number) => n.toString(16).padStart(64, "0");
let releaseSeq = 100;

/** A hosted game linked to `showcaseProjectId`, with releases v1..`releases` and production on `production`. */
async function seedGame(opts: {
  projectId: string;
  showcaseProjectId: string;
  visibility?: "private" | "team" | "unlisted" | "public";
  releases?: number;
  production?: number | null;
}) {
  const { projectId, releases = 1, production = 1 } = opts;
  await db.insert(engineProjects).values({
    projectId,
    name: projectId,
    visibility: opts.visibility ?? "public",
    showcaseProjectId: opts.showcaseProjectId,
  });
  const ids: string[] = [];
  for (let version = 1; version <= releases; version++) {
    const id = hex(releaseSeq++);
    ids.push(id);
    await db.insert(engineReleases).values({
      id,
      projectId,
      version,
      manifest: "{}",
      manifestBytes: 2,
      totalBytes: 100,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: "fixture",
      snapshot: hex(1),
      buildHash: hex(2),
      target: "web",
      firstPromotedAt: production !== null && version <= production ? new Date() : null,
    });
  }
  if (production !== null) {
    await db
      .insert(engineReleaseChannels)
      .values({ projectId, channel: "production", releaseId: ids[production - 1]! });
  }
  return ids;
}

describe("game", () => {
  it("adds the linked game to the project payload when production is public", async () => {
    const project = await seedProject();
    await seedGame({ projectId: "linked-game", showcaseProjectId: project.id });

    const detail = await call(getProject, { idOrSlug: project.slug }, asUser(null));
    expect(detail?.game).toEqual({ projectId: "linked-game", playable: true });
    expect(games.flag).toHaveBeenCalledWith("engine-games-enabled", expect.any(String));
  });

  it("is null without a link, and not playable without production", async () => {
    const plain = await seedProject();
    expect((await call(getProject, { idOrSlug: plain.slug }, asUser(null)))?.game).toBeNull();

    const unreleased = await seedProject();
    await seedGame({ projectId: "no-live", showcaseProjectId: unreleased.id, production: null });
    expect((await call(getProject, { idOrSlug: unreleased.slug }, asUser(null)))?.game).toEqual({
      projectId: "no-live",
      playable: false,
    });
  });

  it("never shows a private, team or hidden game, nor a hidden or collected production", async () => {
    const rows = await Promise.all(Array.from({ length: 6 }, () => seedProject()));
    const [priv, team, hiddenGame, hiddenRelease, collected, unlisted] = rows.map((r) => r.id) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await seedGame({ projectId: "priv", showcaseProjectId: priv, visibility: "private" });
    await seedGame({ projectId: "team", showcaseProjectId: team, visibility: "team" });
    await seedGame({ projectId: "hidden-game", showcaseProjectId: hiddenGame });
    await db
      .update(engineProjects)
      .set({ hiddenAt: new Date() })
      .where(eq(engineProjects.projectId, "hidden-game"));
    const [hiddenId] = await seedGame({
      projectId: "hidden-rel",
      showcaseProjectId: hiddenRelease,
    });
    await db
      .update(engineReleases)
      .set({ hiddenAt: new Date() })
      .where(eq(engineReleases.id, hiddenId!));
    const [collectedId] = await seedGame({ projectId: "collected", showcaseProjectId: collected });
    await db
      .update(engineReleases)
      .set({ collectedAt: new Date() })
      .where(eq(engineReleases.id, collectedId!));
    await seedGame({ projectId: "unlisted", showcaseProjectId: unlisted, visibility: "unlisted" });

    const found = await playableGames(
      db,
      [priv, team, hiddenGame, hiddenRelease, collected, unlisted],
      {
        userId: null,
      },
    );
    expect(Object.fromEntries(found)).toEqual({
      [hiddenRelease]: { projectId: "hidden-rel", playable: false },
      [collected]: { projectId: "collected", playable: false },
      [unlisted]: { projectId: "unlisted", playable: true },
    });
  });

  it("carries the version pinned to the asked-for jam", async () => {
    const project = await seedProject();
    const [v1] = await seedGame({
      projectId: "jam-game",
      showcaseProjectId: project.id,
      releases: 2,
      production: 2,
    });
    await db.insert(itchJams).values([
      { jamId: 7101, slug: "pinned-jam", title: "Pinned Jam", status: "over" },
      { jamId: 7102, slug: "other-jam", title: "Other Jam", status: "over" },
    ]);
    await db.insert(engineReleaseJamLinks).values({
      projectId: "jam-game",
      jamId: 7101,
      releaseId: v1!,
    });

    const pinned = await playableGames(db, [project.id], { userId: null }, { jamId: 7101 });
    expect(pinned.get(project.id)).toEqual({
      projectId: "jam-game",
      playable: true,
      jamVersion: 1,
    });
    const other = await playableGames(db, [project.id], { userId: null }, { jamId: 7102 });
    expect(other.get(project.id)).toEqual({ projectId: "jam-game", playable: true });
  });

  it("shows nothing on production or with the flag off", async () => {
    const project = await seedProject();
    await seedGame({ projectId: "closed-game", showcaseProjectId: project.id });

    games.env = "production";
    expect((await call(getProject, { idOrSlug: project.slug }, asUser(null)))?.game).toBeNull();
    expect(games.flag).not.toHaveBeenCalled();

    games.env = "staging";
    games.flag.mockResolvedValue(false);
    expect((await call(getProject, { idOrSlug: project.slug }, asUser(null)))?.game).toBeNull();
  });
});
