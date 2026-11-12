import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fromBase64Url, toBase64Url } from "@/lib/canvas/token";

import { mintFrameToken, verifyFrameToken } from "../frame-token";
import { FRAME_TOKEN_HOURS } from "../limits";

const RELEASE = "a".repeat(64);
const OTHER = "b".repeat(64);
const SECRET = "frame-secret-for-tests-0123456789";
const NOW = new Date("2026-11-12T10:00:00Z");
const HOUR = 60 * 60 * 1000;

beforeEach(() => vi.stubEnv("ENGINE_FRAME_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

async function mint(userId = "user-1"): Promise<string> {
  const token = await mintFrameToken({ releaseId: RELEASE, userId, now: NOW });
  if (!token) throw new Error("no token");
  return token;
}

describe("frame tokens", () => {
  it("round trips the release, the viewer and the expiry", async () => {
    const token = await mint();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyFrameToken(token, RELEASE, NOW)).toEqual({
      r: RELEASE,
      u: "user-1",
      e: NOW.getTime() + FRAME_TOKEN_HOURS * HOUR,
    });
  });

  it("expires after FRAME_TOKEN_HOURS", async () => {
    const token = await mint();
    const almost = new Date(NOW.getTime() + FRAME_TOKEN_HOURS * HOUR - 1);
    const expired = new Date(NOW.getTime() + FRAME_TOKEN_HOURS * HOUR);
    expect(await verifyFrameToken(token, RELEASE, almost)).not.toBeNull();
    expect(await verifyFrameToken(token, RELEASE, expired)).toBeNull();
  });

  it("refuses another release", async () => {
    expect(await verifyFrameToken(await mint(), OTHER, NOW)).toBeNull();
  });

  it("refuses a tampered body", async () => {
    const [payload, signature] = (await mint()).split(".") as [string, string];
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)!));
    const forged = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ ...claims, r: OTHER, u: "someone-else" })),
    );
    expect(await verifyFrameToken(`${forged}.${signature}`, OTHER, NOW)).toBeNull();
    const longer = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ ...claims, e: claims.e + 1000 * HOUR })),
    );
    expect(await verifyFrameToken(`${longer}.${signature}`, RELEASE, NOW)).toBeNull();
  });

  it("refuses a token signed with another secret", async () => {
    const token = await mint();
    vi.stubEnv("ENGINE_FRAME_SECRET", "another-secret-entirely-0123456789");
    expect(await verifyFrameToken(token, RELEASE, NOW)).toBeNull();
  });

  it("never throws on garbage", async () => {
    for (const junk of [undefined, null, 42, {}, "", ".", "a.b.c", "!!.??", "x".repeat(5000)]) {
      await expect(verifyFrameToken(junk, RELEASE, NOW)).resolves.toBeNull();
    }
    const notJson = `${toBase64Url(new TextEncoder().encode("not json"))}.AAAA`;
    await expect(verifyFrameToken(notJson, RELEASE, NOW)).resolves.toBeNull();
  });

  it("refuses everything without a secret", async () => {
    const token = await mint();
    vi.stubEnv("ENGINE_FRAME_SECRET", "");
    expect(await mintFrameToken({ releaseId: RELEASE, userId: "user-1", now: NOW })).toBeNull();
    expect(await verifyFrameToken(token, RELEASE, NOW)).toBeNull();
  });

  it("is always for a signed-in viewer", async () => {
    await expect(mintFrameToken({ releaseId: RELEASE, userId: "" })).rejects.toThrow();
    await expect(mintFrameToken({ releaseId: RELEASE, userId: "anon" })).rejects.toThrow();
    await expect(mintFrameToken({ releaseId: "not-a-release", userId: "u" })).rejects.toThrow();
  });

  it("isn't a sync token: a canvas token signed with the same secret is refused", async () => {
    const { signCanvasToken } = await import("@/lib/canvas/token");
    const canvas = await signCanvasToken(
      { c: "canvas:x", u: "user-1", a: "read" },
      SECRET,
      NOW.getTime(),
    );
    expect(await verifyFrameToken(canvas, RELEASE, NOW)).toBeNull();
  });
});
