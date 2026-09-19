import { describe, expect, it } from "vite-plus/test";

import { adaptProfile, type RpcProfile } from "../profile-adapter";

/**
 * Three GitLab instances share one label. Without the registry the adapter
 * would print `GITLAB-BOOTH` from a raw `provider.toUpperCase()`, and the
 * unlink action — which now keys on `provider` — would have nothing to
 * key on.
 */

function rpcProfile(overrides: Partial<RpcProfile> = {}): RpcProfile {
  return {
    profile: {
      id: "u1",
      discordId: "d1",
      discordUsername: "yasahiro",
      guildNickname: null,
      avatarUrl: null,
      guildAvatarUrl: null,
      bio: null,
      tagline: null,
      githubUrl: null,
      twitterUrl: null,
      websiteUrl: null,
      availableForWork: null,
      availability: null,
      lookingFor: null,
      collabPreference: null,
      rateType: null,
      rateMin: null,
      rateMax: null,
      timezone: null,
      location: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      guildJoinedAt: null,
      profileNotesEnabled: true,
    },
    skills: [],
    roles: [],
    projects: [],
    credits: [],
    isOwner: false,
    urlStub: null,
    pendingSkillRequests: [],
    linkedAccounts: [],
    wallNotesCount: 0,
    collabsCount: 0,
    ...overrides,
  };
}

function linkedAccount(
  provider: string,
  profileUrl: string,
  username: string,
): RpcProfile["linkedAccounts"][number] {
  return {
    id: 1,
    provider,
    providerUsername: username,
    providerProfileUrl: profileUrl,
    tokenInvalidAt: null,
    linkedAt: new Date("2026-09-12T00:00:00Z"),
  };
}

describe("adaptProfile — GitLab rows", () => {
  it("labels a self-hosted instance GITLAB with the host as the sub-line", () => {
    const { links } = adaptProfile(
      rpcProfile({
        linkedAccounts: [
          linkedAccount("gitlab-booth", "https://git.booth.dev/yasahiro", "yasahiro"),
        ],
      }),
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      provider: "gitlab-booth",
      label: "GITLAB",
      monogram: "GL",
      display: "git.booth.dev/yasahiro",
      url: "https://git.booth.dev/yasahiro",
    });
  });

  it("shows the bare username on gitlab.com, where the host says nothing", () => {
    const { links } = adaptProfile(
      rpcProfile({
        linkedAccounts: [linkedAccount("gitlab", "https://gitlab.com/yasa", "yasa")],
      }),
    );

    expect(links[0]).toMatchObject({ label: "GITLAB", monogram: "GL", display: "yasa" });
  });

  it("carries the provider on OAuth rows and leaves it off the virtual ones", () => {
    const { links } = adaptProfile(
      rpcProfile({
        profile: { ...rpcProfile().profile, githubUrl: "https://github.com/yasa" },
        linkedAccounts: [linkedAccount("gitlab-brackeys", "https://git.brackeys.dev/yasa", "yasa")],
      }),
    );

    const gitlab = links.find((l) => l.label === "GITLAB");
    const githubUrlRow = links.find((l) => l.id === "github-url");
    expect(gitlab?.provider).toBe("gitlab-brackeys");
    expect(githubUrlRow?.provider).toBeUndefined();
  });
});

/**
 * The row synthesized from `websiteUrl` shipped hardcoded as PORTFOLIO,
 * which is simply wrong for the members whose link is a blog.
 */
describe("adaptProfile — the member's own site", () => {
  function websiteRow(websiteLabel: string | null) {
    const base = rpcProfile().profile;
    const { links } = adaptProfile(
      rpcProfile({
        profile: { ...base, websiteUrl: "https://blog.duxez.dev", websiteLabel },
      }),
    );
    return links.find((l) => l.id === "website-url");
  }

  it("labels the row with the type the member picked", () => {
    expect(websiteRow("blog")).toMatchObject({ label: "BLOG", monogram: "BL" });
    expect(websiteRow("website")).toMatchObject({ label: "WEBSITE", monogram: "WE" });
  });

  it("falls back to PORTFOLIO for rows that predate the column", () => {
    expect(websiteRow(null)).toMatchObject({ label: "PORTFOLIO", display: "blog.duxez.dev" });
  });
});

/**
 * The scraper stores `submission_url` root-relative, and the jam log used
 * to hand that straight to an anchor — so the game name resolved against
 * brackeys.community instead of itch.io (BC-203).
 */
describe("adaptProfile — jam log entry links", () => {
  function jamProject(
    overrides: Partial<RpcProfile["projects"][number]> = {},
  ): RpcProfile["projects"][number] {
    return {
      id: "p1",
      type: "jam",
      subTypes: null,
      title: "Meltdown",
      description: null,
      url: "https://someone.itch.io/meltdown",
      imageUrl: null,
      tags: null,
      pinned: null,
      sortOrder: null,
      status: "published",
      source: "itchio-jam",
      jamId: 402922,
      jamName: "GMTK Jam 2026",
      jamUrl: null,
      jamSlug: "gmtk-jam-2026",
      projectSlug: null,
      canonicalType: null,
      canonicalLinks: null,
      canonicalPlatforms: null,
      canonicalMinPrice: null,
      missingSince: null,
      jamStartsAt: new Date("2026-08-01T00:00:00Z"),
      jamEntriesCount: 7000,
      jamOverallRank: null,
      submissionTitle: null,
      submissionUrl: "/jam/gmtk-jam-2026/rate/4815752",
      result: null,
      participatedAt: null,
      publishedAt: null,
      createdAt: new Date("2026-08-02T00:00:00Z"),
      ...overrides,
    };
  }

  it("links the entry to its itch.io rate page", () => {
    const { jamLog } = adaptProfile(rpcProfile({ projects: [jamProject()] }));
    expect(jamLog[0]?.url).toBe("https://itch.io/jam/gmtk-jam-2026/rate/4815752");
  });

  it("falls back to the game page when there is no entry page", () => {
    const { jamLog } = adaptProfile(
      rpcProfile({ projects: [jamProject({ submissionUrl: null })] }),
    );
    expect(jamLog[0]?.url).toBe("https://someone.itch.io/meltdown");
  });
});

describe("rank badge", () => {
  it("reads the badge off the cached guild roles", () => {
    const withRoles = (guildRoles: string[] | null) =>
      adaptProfile(rpcProfile({ profile: { ...rpcProfile().profile, guildRoles } })).guildRank;
    expect(withRoles(null)).toBeNull();
    expect(withRoles(["BIP"])).toBe("bip");
    expect(withRoles(["Moderator", "Guru"])).toBe("moderator");
    expect(withRoles(["Staff", "Admin"])).toBe("admin");
  });
});
