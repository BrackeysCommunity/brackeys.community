import { describe, expect, it } from "vite-plus/test";

import { discordMessageLink, discordUserLink } from "@/lib/discord-links";

describe("discord app links", () => {
  it("routes a profile through the app, not the web client", () => {
    expect(discordUserLink("243005537342586880")).toBe("discord://-/users/243005537342586880");
  });

  it("jumps to one message in its channel", () => {
    expect(discordMessageLink("7", "9001", "42")).toBe("discord://-/channels/7/9001/42");
  });

  it("never emits an https discord.com URL — that is the whole point", () => {
    for (const link of [discordUserLink("1"), discordMessageLink("1", "2", "3")]) {
      expect(link.startsWith("discord://")).toBe(true);
      expect(link).not.toContain("discord.com");
    }
  });
});
