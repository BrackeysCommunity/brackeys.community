import { describe, expect, it } from "vite-plus/test";

import { memberName } from "@/lib/member-name";

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
