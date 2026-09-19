import { describe, expect, it } from "vite-plus/test";

import { toDiscordAppAuthorizeUrl } from "@/lib/discord-app-login";

describe("toDiscordAppAuthorizeUrl", () => {
  const query =
    "?client_id=1&scope=identify+guilds&response_type=code&redirect_uri=https%3A%2F%2Fx%2Fcb&state=abc";

  it("rewrites the web authorize URL to the desktop client's route, query intact", () => {
    expect(toDiscordAppAuthorizeUrl(`https://discord.com/oauth2/authorize${query}`)).toBe(
      `discord://-/oauth2/authorize${query}`,
    );
  });

  it("accepts the /api and versioned forms better-auth may emit", () => {
    expect(toDiscordAppAuthorizeUrl(`https://discord.com/api/oauth2/authorize${query}`)).toBe(
      `discord://-/oauth2/authorize${query}`,
    );
    expect(toDiscordAppAuthorizeUrl(`https://discord.com/api/v10/oauth2/authorize${query}`)).toBe(
      `discord://-/oauth2/authorize${query}`,
    );
  });

  it("refuses anything that is not a Discord authorize URL", () => {
    expect(toDiscordAppAuthorizeUrl(`https://github.com/login/oauth/authorize${query}`)).toBeNull();
    expect(toDiscordAppAuthorizeUrl(`https://discord.com/oauth2/token`)).toBeNull();
    expect(toDiscordAppAuthorizeUrl(`http://discord.com/oauth2/authorize${query}`)).toBeNull();
    expect(toDiscordAppAuthorizeUrl("not a url")).toBeNull();
  });
});
