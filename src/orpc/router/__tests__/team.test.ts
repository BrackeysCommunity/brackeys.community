import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { collabFacetInput } from "@/components/collab/collab-filters";
import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseChannels,
  engineReleases,
  projects,
  teamProjects,
  teams,
} from "@/db/schema";
import { draftFromPost } from "@/lib/collab-store";
import { slugifyTeamName } from "@/lib/team-links";
import router from "@/orpc/router";
import { postContentSchema } from "@/orpc/router/collab";
import { getTeam } from "@/orpc/router/team";
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

const flag = vi.hoisted(() => vi.fn(async (_flag: string, _id: string) => true));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => "staging",
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: flag,
}));

const db = mockedDb as unknown as TestDb;

describe("team router surface", () => {
  it("registers the team procedures", () => {
    expect(router.createTeam).toBeDefined();
    expect(router.getTeam).toBeDefined();
    expect(router.listMyTeams).toBeDefined();
    expect(router.inviteToTeam).toBeDefined();
    expect(router.respondToInvite).toBeDefined();
    expect(router.transferOwnership).toBeDefined();
    expect(router.importMemberProject).toBeDefined();
  });

  it("registers the invitee's own inbox", () => {
    expect(router.listMyInvites).toBeDefined();
  });
});

describe("slugifyTeamName", () => {
  it("kebab-cases a plain name", () => {
    expect(slugifyTeamName("Cathedral of Wires")).toBe("cathedral-of-wires");
  });

  it("strips punctuation and collapses runs", () => {
    expect(slugifyTeamName("The  Night—Shift! Crew")).toBe("the-night-shift-crew");
  });

  it("clamps to the 32-char handle limit without a trailing hyphen", () => {
    const slug = slugifyTeamName("A Very Long Team Name That Goes On And On Forever");
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("-")).toBe(false);
  });

  it("falls back to a generic stem for degenerate names", () => {
    // Two chars survive: too short for a handle on their own.
    expect(slugifyTeamName("!!")).toBe("team");
    expect(slugifyTeamName("ab")).toBe("team-ab");
  });
});

describe("team link on posts", () => {
  /** The same valid payload the collab suite uses, trimmed to essentials. */
  function validPost(overrides: Record<string, unknown> = {}) {
    return {
      type: "hobby",
      title: "Pixel artist for a PSX horror RPG",
      description: "A short atmospheric horror RPG in the PSX style. Looking for a pixel artist.",
      projectName: "Cathedral of Wires",
      projectLength: "1-3 months",
      platforms: ["PC"],
      experienceLevel: "any",
      contactType: "discord_dm",
      contactMethod: "someone",
      roleIds: [1],
      ...overrides,
    };
  }

  it("accepts a team link and accepts null to unlink one", () => {
    expect(postContentSchema.safeParse(validPost({ teamId: "some-uuid" })).success).toBe(true);
    expect(postContentSchema.safeParse(validPost({ teamId: null })).success).toBe(true);
  });

  it("rejects a solo post that also claims a team", () => {
    const result = postContentSchema.safeParse(
      validPost({ isIndividual: true, teamId: "some-uuid", contactType: undefined }),
    );
    expect(result.success).toBe(false);
  });

  it("round-trips the team link through an edit draft", () => {
    const post = {
      type: "hobby",
      jamId: null,
      teamId: "team-uuid",
      projectId: null,
      title: "Composer for a roguelike",
      description: "Looking for a composer for a fast, punchy roguelike soundtrack.",
      projectName: "Nine Lives",
      compensationType: null,
      compensationMin: null,
      compensationMax: null,
      projectLength: "1-3 months",
      platforms: ["PC"],
      experienceLevel: "any",
      portfolioUrl: null,
      contactMethod: "team@example.com",
      contactType: "email",
      isIndividual: false,
      roles: [{ id: 3 }],
      skills: [],
    };
    expect(draftFromPost(post).teamId).toBe("team-uuid");
    expect(draftFromPost({ ...post, teamId: null }).teamId).toBeUndefined();
  });

  it("passes the team constraint through the board filter input", () => {
    expect(collabFacetInput({ team: "team-uuid" }).teamId).toBe("team-uuid");
    expect(collabFacetInput({}).teamId).toBeUndefined();
  });
});

describe("team placements' game", () => {
  it("marks a placement whose project links a playable game, and only that one", async () => {
    await seedUser(db, "team-owner");
    const [team] = await db
      .insert(teams)
      .values({ slug: "game-team", name: "Game Team", createdBy: "team-owner" })
      .returning({ id: teams.id });
    const [linked, plain] = await db
      .insert(projects)
      .values([
        { slug: "linked-placement", title: "Linked", published: true },
        { slug: "plain-placement", title: "Plain", published: true },
      ])
      .returning({ id: projects.id });
    await db.insert(teamProjects).values([
      { teamId: team!.id, projectId: linked!.id, title: "Linked", sortOrder: 0 },
      { teamId: team!.id, projectId: plain!.id, title: "Plain", sortOrder: 1 },
      { teamId: team!.id, title: "Free text", sortOrder: 2 },
    ]);
    const releaseId = "a".repeat(64);
    await db.insert(engineProjects).values({
      projectId: "team-game",
      name: "Team game",
      visibility: "public",
      showcaseProjectId: linked!.id,
    });
    await db.insert(engineReleases).values({
      id: releaseId,
      projectId: "team-game",
      version: 1,
      manifest: "{}",
      manifestBytes: 2,
      totalBytes: 100,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: "fixture",
      snapshot: "b".repeat(64),
      buildHash: "c".repeat(64),
      target: "web",
      firstPromotedAt: new Date(),
    });
    await db
      .insert(engineReleaseChannels)
      .values({ projectId: "team-game", channel: "production", releaseId });

    const page = await call(getTeam, { teamId: "game-team" }, asUser(null));
    expect(page?.projects.map((p) => [p.title, p.game])).toEqual([
      ["Linked", { projectId: "team-game", playable: true }],
      ["Plain", null],
      ["Free text", null],
    ]);

    flag.mockResolvedValue(false);
    const closed = await call(getTeam, { teamId: "game-team" }, asUser(null));
    expect(closed?.projects.every((p) => p.game === null)).toBe(true);
  });
});
