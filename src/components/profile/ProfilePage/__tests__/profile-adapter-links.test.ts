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
