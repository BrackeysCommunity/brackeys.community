import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

describe("return marker", () => {
  it("adds the marker to a callback URL with or without a query", async () => {
    const { withDiscordAppReturn } = await import("@/lib/discord-app-login");
    expect(withDiscordAppReturn("/jams")).toBe("/jams?signin=discord_app");
    expect(withDiscordAppReturn("/jams?tab=live")).toBe("/jams?tab=live&signin=discord_app");
  });

  it("reads and strips the marker, leaving the rest of the URL alone", async () => {
    const { readDiscordAppReturn } = await import("@/lib/discord-app-login");
    expect(readDiscordAppReturn("https://x.test/jams?tab=live&signin=discord_app#top")).toEqual({
      returned: true,
      href: "/jams?tab=live#top",
    });
    expect(readDiscordAppReturn("https://x.test/jams?tab=live")).toEqual({
      returned: false,
      href: "https://x.test/jams?tab=live",
    });
  });
});

describe("remembered route", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts unknown and round-trips either answer", async () => {
    const { rememberSigninRoute, rememberedSigninRoute } = await import("@/lib/discord-app-login");
    expect(rememberedSigninRoute()).toBeNull();
    rememberSigninRoute("web");
    expect(rememberedSigninRoute()).toBe("web");
    rememberSigninRoute("app");
    expect(rememberedSigninRoute()).toBe("app");
  });

  it("ignores a value it did not write", async () => {
    const { rememberedSigninRoute } = await import("@/lib/discord-app-login");
    store.set("discord-signin-route", "carrier-pigeon");
    expect(rememberedSigninRoute()).toBeNull();
  });

  it("records the app route when a landing tab announces", async () => {
    const { announceDiscordAppSignin, rememberedSigninRoute } =
      await import("@/lib/discord-app-login");
    announceDiscordAppSignin();
    expect(rememberedSigninRoute()).toBe("app");
  });

  it("reads null rather than throwing when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { rememberSigninRoute, rememberedSigninRoute } = await import("@/lib/discord-app-login");
    expect(() => rememberSigninRoute("app")).not.toThrow();
    expect(rememberedSigninRoute()).toBeNull();
  });
});
