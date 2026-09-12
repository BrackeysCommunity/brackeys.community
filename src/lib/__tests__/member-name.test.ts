import { describe, expect, it } from "vite-plus/test";

import { ANON_VIEWER, memberAvatarUrl, memberDisplayName, memberName } from "@/lib/member-name";

describe("memberName", () => {
  it("shows the guild nickname ahead of the handle", () => {
    expect(memberName({ guildNickname: "Nova", discordUsername: "nova_dev" }, "Member")).toBe(
      "Nova",
    );
    expect(memberName({ guildNickname: null, discordUsername: "nova_dev" }, "Member")).toBe(
      "nova_dev",
    );
  });

  it("treats a blank nickname as no nickname", () => {
    expect(memberName({ guildNickname: "   ", discordUsername: "nova_dev" }, "Member")).toBe(
      "nova_dev",
    );
  });

  it("falls back to the caller's word, or null when they give none", () => {
    expect(memberName({}, "a member")).toBe("a member");
    expect(memberName({ guildNickname: null, discordUsername: null })).toBeNull();
  });
});

describe("memberDisplayName / memberAvatarUrl — two faces, one person", () => {
  const nova = {
    guildNickname: "Nova",
    discordUsername: "nova_dev",
    avatarUrl: "https://cdn.discordapp.com/avatars/1/global.png",
    guildAvatarUrl: "https://cdn.discordapp.com/guilds/g/users/1/avatars/server.png",
  };

  it("shows the guild face to a viewer who is in the guild", () => {
    const viewer = { inGuild: true };
    expect(memberDisplayName(nova, viewer, "Member")).toBe("Nova");
    expect(memberAvatarUrl(nova, viewer)).toBe(nova.guildAvatarUrl);
  });

  it("shows the global face to everyone else — anonymous, or a member outside the guild", () => {
    // What a DM would show: the handle and the global avatar, never the
    // server-specific pair.
    expect(memberDisplayName(nova, ANON_VIEWER, "Member")).toBe("nova_dev");
    expect(memberAvatarUrl(nova, ANON_VIEWER)).toBe(nova.avatarUrl);
    expect(memberDisplayName(nova, { inGuild: false }, "Member")).toBe("nova_dev");
  });

  it("falls back to the global avatar for a guild viewer when no server avatar is set", () => {
    expect(memberAvatarUrl({ ...nova, guildAvatarUrl: null }, { inGuild: true })).toBe(
      nova.avatarUrl,
    );
  });

  it("keeps the caller's fallback on either face", () => {
    expect(memberDisplayName({}, ANON_VIEWER, "a member")).toBe("a member");
    expect(memberDisplayName({ guildNickname: "Nova" }, ANON_VIEWER, "a member")).toBe("a member");
    expect(memberDisplayName({ guildNickname: "Nova" }, { inGuild: true })).toBe("Nova");
  });
});
