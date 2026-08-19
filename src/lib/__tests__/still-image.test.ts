import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const DISCORD_GIF = "https://cdn.discordapp.com/avatars/123/a_abc.gif";
const UPLOAD_GIF = "/images/team-avatars/team1/V1StGXR8Z5-logo.gif";

// @/env captures the CF gate at first import, so each test stubs it and then
// loads a fresh module graph.
async function loadStillImage() {
  vi.resetModules();
  return await import("@/lib/still-image");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("stillImageUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CF_IMAGES", "1");
  });

  it("swaps a Discord animated avatar to its png still", async () => {
    const { stillImageUrl } = await loadStillImage();
    expect(stillImageUrl(DISCORD_GIF)).toBe("https://cdn.discordapp.com/avatars/123/a_abc.png");
    expect(stillImageUrl(`${DISCORD_GIF}?size=64`)).toBe(
      "https://cdn.discordapp.com/avatars/123/a_abc.png?size=64",
    );
  });

  it("freezes an uploaded gif through the transformer", async () => {
    const { stillImageUrl } = await loadStillImage();
    expect(stillImageUrl(UPLOAD_GIF)).toBe(
      `/cdn-cgi/image/quality=60,format=auto,anim=false,onerror=redirect${UPLOAD_GIF}`,
    );
  });

  it("leaves alone anything that isn't an animated source", async () => {
    const { stillImageUrl } = await loadStillImage();
    const untouched = [
      "https://cdn.discordapp.com/avatars/123/abc.png",
      "https://img.itch.zone/aW1nLzEyMy5wbmc=/original/AbCdEf.png",
      "/images/team-avatars/team1/V1StGXR8Z5-logo.png",
      // gif we have no still for — a foreign host the transformer won't touch
      "https://example.com/avatar.gif",
    ];
    for (const url of untouched) expect(stillImageUrl(url)).toBe(url);
    expect(stillImageUrl(null)).toBeNull();
    expect(stillImageUrl(undefined)).toBeUndefined();
  });

  it("passes an uploaded gif through untouched when CF images are off", async () => {
    vi.stubEnv("VITE_CF_IMAGES", "");
    const { stillImageUrl } = await loadStillImage();
    expect(stillImageUrl(UPLOAD_GIF)).toBe(UPLOAD_GIF);
  });
});

describe("isAnimatedImageUrl", () => {
  it("keys on the path extension, not the query", async () => {
    const { isAnimatedImageUrl } = await loadStillImage();
    expect(isAnimatedImageUrl(DISCORD_GIF)).toBe(true);
    expect(isAnimatedImageUrl(`${DISCORD_GIF}?size=64`)).toBe(true);
    expect(isAnimatedImageUrl("https://example.com/a.png?fallback=x.gif")).toBe(false);
    expect(isAnimatedImageUrl(null)).toBe(false);
  });
});
