import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  activeUserStore,
  clearActiveUserProfile,
  fetchActiveUserProfile,
  updateActiveUserProfile,
} from "../active-user-store";

// ── Mock the oRPC client ────────────────────────────────────────────────────

const mockGetMyProfile = vi.fn();

vi.mock("@/orpc/client", () => ({
  client: {
    getMyProfile: (...args: unknown[]) => mockGetMyProfile(...args),
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetStore() {
  activeUserStore.setState(() => ({ profile: null, isPending: false }));
}

const mockProfile = {
  discordUsername: "joshcomplex",
  discordId: "123456789",
  avatarUrl: "https://cdn.discordapp.com/avatars/123/abc.png",
  guildNickname: "Josh",
  urlStub: null as string | null,
};

const fullProfileResponse = {
  profile: {
    id: "user-1",
    ...mockProfile,
    bio: "Hello",
    tagline: "Dev",
    guildRoles: ["Admin"],
    guildJoinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    availableForWork: false,
    availability: null,
    rateType: null,
    rateMin: null,
    rateMax: null,
    githubUrl: null,
    twitterUrl: null,
    websiteUrl: null,
  },
  skills: [],
  projects: [],
  pendingSkillRequests: [],
  urlStub: null,
  isOwner: true,
  linkedAccounts: [],
};

afterEach(() => {
  resetStore();
  vi.clearAllMocks();
});

// ── Initial state ───────────────────────────────────────────────────────────

describe("activeUserStore initial state", () => {
  it("starts with null profile and not pending", () => {
    expect(activeUserStore.state.profile).toBeNull();
    expect(activeUserStore.state.isPending).toBe(false);
  });
});

// ── fetchActiveUserProfile ──────────────────────────────────────────────────

describe("fetchActiveUserProfile", () => {
  it("sets isPending to true while fetching", async () => {
    let pendingDuringFetch = false;
    mockGetMyProfile.mockImplementation(() => {
      pendingDuringFetch = activeUserStore.state.isPending;
      return Promise.resolve(fullProfileResponse);
    });

    await fetchActiveUserProfile();

    expect(pendingDuringFetch).toBe(true);
  });

  it("populates the store with profile data on success", async () => {
    mockGetMyProfile.mockResolvedValue(fullProfileResponse);

    await fetchActiveUserProfile();

    expect(activeUserStore.state.profile).toEqual(mockProfile);
    expect(activeUserStore.state.isPending).toBe(false);
  });

  it("only extracts the relevant profile fields", async () => {
    mockGetMyProfile.mockResolvedValue(fullProfileResponse);

    await fetchActiveUserProfile();

    const profile = activeUserStore.state.profile!;
    expect(Object.keys(profile).sort()).toEqual(
      ["avatarUrl", "discordId", "discordUsername", "guildNickname", "urlStub"].sort(),
    );
  });

  it("sets profile to null when API returns null", async () => {
    mockGetMyProfile.mockResolvedValue(null);

    await fetchActiveUserProfile();

    expect(activeUserStore.state.profile).toBeNull();
    expect(activeUserStore.state.isPending).toBe(false);
  });

  it("sets profile to null when API returns no profile", async () => {
    mockGetMyProfile.mockResolvedValue({ profile: null });

    await fetchActiveUserProfile();

    expect(activeUserStore.state.profile).toBeNull();
    expect(activeUserStore.state.isPending).toBe(false);
  });

  it("sets profile to null on API error", async () => {
    mockGetMyProfile.mockRejectedValue(new Error("Unauthorized"));

    await fetchActiveUserProfile();

    expect(activeUserStore.state.profile).toBeNull();
    expect(activeUserStore.state.isPending).toBe(false);
  });

  it("clears isPending on error", async () => {
    mockGetMyProfile.mockRejectedValue(new Error("Network error"));

    await fetchActiveUserProfile();

    expect(activeUserStore.state.isPending).toBe(false);
  });

  it("passes empty object as input to getMyProfile", async () => {
    mockGetMyProfile.mockResolvedValue(fullProfileResponse);

    await fetchActiveUserProfile();

    expect(mockGetMyProfile).toHaveBeenCalledWith({});
  });

  it("handles profile with null fields", async () => {
    mockGetMyProfile.mockResolvedValue({
      ...fullProfileResponse,
      profile: {
        ...fullProfileResponse.profile,
        discordUsername: null,
        discordId: null,
        avatarUrl: null,
        guildNickname: null,
      },
    });

    await fetchActiveUserProfile();

    expect(activeUserStore.state.profile).toEqual({
      discordUsername: null,
      discordId: null,
      avatarUrl: null,
      guildNickname: null,
      urlStub: null,
    });
  });
});

// ── clearActiveUserProfile ──────────────────────────────────────────────────

describe("clearActiveUserProfile", () => {
  it("clears the profile", () => {
    activeUserStore.setState(() => ({ profile: mockProfile, isPending: false }));

    clearActiveUserProfile();

    expect(activeUserStore.state.profile).toBeNull();
  });

  it("sets isPending to false", () => {
    activeUserStore.setState(() => ({ profile: mockProfile, isPending: true }));

    clearActiveUserProfile();

    expect(activeUserStore.state.isPending).toBe(false);
  });

  it("is idempotent when already cleared", () => {
    clearActiveUserProfile();
    clearActiveUserProfile();

    expect(activeUserStore.state.profile).toBeNull();
    expect(activeUserStore.state.isPending).toBe(false);
  });
});

// ── updateActiveUserProfile ─────────────────────────────────────────────────

describe("updateActiveUserProfile", () => {
  it("updates a single field", () => {
    activeUserStore.setState(() => ({ profile: { ...mockProfile }, isPending: false }));

    updateActiveUserProfile({ discordUsername: "newname" });

    expect(activeUserStore.state.profile!.discordUsername).toBe("newname");
  });

  it("preserves other fields when updating one", () => {
    activeUserStore.setState(() => ({ profile: { ...mockProfile }, isPending: false }));

    updateActiveUserProfile({ guildNickname: "New Nick" });

    expect(activeUserStore.state.profile).toEqual({
      ...mockProfile,
      guildNickname: "New Nick",
    });
  });

  it("updates multiple fields at once", () => {
    activeUserStore.setState(() => ({ profile: { ...mockProfile }, isPending: false }));

    updateActiveUserProfile({ discordUsername: "updated", avatarUrl: "https://new.png" });

    expect(activeUserStore.state.profile!.discordUsername).toBe("updated");
    expect(activeUserStore.state.profile!.avatarUrl).toBe("https://new.png");
  });

  it("does nothing when profile is null", () => {
    updateActiveUserProfile({ discordUsername: "ghost" });

    expect(activeUserStore.state.profile).toBeNull();
  });

  it("allows setting a field to null", () => {
    activeUserStore.setState(() => ({ profile: { ...mockProfile }, isPending: false }));

    updateActiveUserProfile({ guildNickname: null });

    expect(activeUserStore.state.profile!.guildNickname).toBeNull();
  });

  it("does not affect isPending", () => {
    activeUserStore.setState(() => ({ profile: { ...mockProfile }, isPending: true }));

    updateActiveUserProfile({ discordUsername: "test" });

    expect(activeUserStore.state.isPending).toBe(true);
  });
});
