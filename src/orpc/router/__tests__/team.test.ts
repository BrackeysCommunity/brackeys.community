import { describe, expect, it } from "vite-plus/test";

import { draftFromPost, collabFilterInput } from "@/lib/collab-store";
import router from "@/orpc/router";
import { postContentSchema } from "@/orpc/router/collab";
import { slugifyTeamName } from "@/orpc/router/team";

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
      teamSize: "2-3",
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
      teamSize: "2-3" as const,
      projectLength: "1-3 months",
      platforms: ["PC"],
      experience: null,
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
    const base = {
      type: undefined,
      roleIds: [],
      skillIds: [],
      jamId: undefined,
      teamId: undefined,
      projectId: undefined,
      status: undefined,
      search: "",
      sortBy: "createdAt" as const,
      sortOrder: "desc" as const,
      experienceLevel: undefined,
      compensationType: undefined,
      isIndividual: undefined,
    };
    expect(collabFilterInput({ ...base, teamId: "team-uuid" }).teamId).toBe("team-uuid");
    expect(collabFilterInput(base).teamId).toBeUndefined();
  });
});
