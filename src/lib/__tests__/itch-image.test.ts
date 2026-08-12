import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const ITCH_URL = "https://img.itch.zone/aW1nLzEyMzQ1LnBuZw==/original/AbCdEf.png";

// @/env captures process.env / import.meta.env when it's first imported, so
// each test loads a fresh module graph after stubbing the gate.
async function loadItchImage() {
  vi.resetModules();
  return await import("@/lib/itch-image");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("itch-image (gate on)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CF_IMAGES", "1");
  });

  it("rewrites an itch URL with the expected option string", async () => {
    const { itchImageUrl } = await loadItchImage();
    expect(itchImageUrl(ITCH_URL, { width: 96 })).toBe(
      `/cdn-cgi/image/width=96,quality=60,format=auto,fit=scale-down,onerror=redirect/${ITCH_URL}`,
    );
  });

  it("honors quality, height, and fit overrides", async () => {
    const { itchImageUrl } = await loadItchImage();
    expect(itchImageUrl(ITCH_URL, { width: 640, height: 400, quality: 70, fit: "crop" })).toBe(
      `/cdn-cgi/image/width=640,height=400,quality=70,format=auto,fit=crop,onerror=redirect/${ITCH_URL}`,
    );
  });

  it("always includes onerror=redirect, and omits fit without dimensions", async () => {
    const { itchImageUrl } = await loadItchImage();
    expect(itchImageUrl(ITCH_URL)).toBe(
      `/cdn-cgi/image/quality=60,format=auto,onerror=redirect/${ITCH_URL}`,
    );
  });

  it("passes through everything that must never be transformed", async () => {
    const { itchImageUrl } = await loadItchImage();
    const untouchables = [
      // MinIO presigned GET — rotating query signature, uncacheable
      "https://minio.example.com/profile-projects/abc.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef",
      "blob:https://brackeys.community/1c9e2f0a",
      "data:image/png;base64,iVBORw0KGgo=",
      "/brackeys-logo.svg",
      "https://cdn.discordapp.com/avatars/123/abc.png",
      `/cdn-cgi/image/width=96,quality=60,format=auto,onerror=redirect/${ITCH_URL}`,
      // http (not https) itch — never emitted by the sync, don't rewrite
      "http://img.itch.zone/foo.png",
    ];
    for (const url of untouchables) {
      expect(itchImageUrl(url, { width: 96 })).toBe(url);
    }
  });

  it("passes through null and undefined", async () => {
    const { itchImageUrl } = await loadItchImage();
    expect(itchImageUrl(null, { width: 96 })).toBeNull();
    expect(itchImageUrl(undefined, { width: 96 })).toBeUndefined();
  });

  it("builds a width-descriptor srcSet over the default ladder", async () => {
    const { itchImageSrcSet } = await loadItchImage();
    const srcSet = itchImageSrcSet(ITCH_URL, undefined, { quality: 70 });
    expect(srcSet).toBe(
      [480, 960, 1280]
        .map(
          (w) =>
            `/cdn-cgi/image/width=${w},quality=70,format=auto,fit=scale-down,onerror=redirect/${ITCH_URL} ${w}w`,
        )
        .join(", "),
    );
  });

  it("returns undefined srcSet for non-transformable input", async () => {
    const { itchImageSrcSet } = await loadItchImage();
    expect(itchImageSrcSet("blob:foo")).toBeUndefined();
    expect(itchImageSrcSet(null)).toBeUndefined();
  });
});

describe("itch-image (gate off)", () => {
  it("passes URLs through and builds no srcSet", async () => {
    const { itchImageUrl, itchImageSrcSet } = await loadItchImage();
    expect(itchImageUrl(ITCH_URL, { width: 96 })).toBe(ITCH_URL);
    expect(itchImageSrcSet(ITCH_URL)).toBeUndefined();
  });
});
