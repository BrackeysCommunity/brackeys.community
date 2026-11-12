import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { verifyCanvasToken } from "@/lib/canvas/token";

import { mintPlayerToken, PLAYER_TOKEN_TTL_MS } from "../player-token";

const SECRET = "player-token-test-secret";
const NOW = 1_800_000_000_000;
const ANON = "6f1d2c3b-4a59-4e8f-9a0b-1c2d3e4f5a6b";

describe("mintPlayerToken", () => {
  beforeEach(() => vi.stubEnv("CANVAS_SYNC_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("mints a 60-second session token for this browser's anonymous id", async () => {
    const token = await mintPlayerToken({
      sessionId: "s-1",
      userId: null,
      anonId: ANON,
      now: NOW,
    });
    expect(PLAYER_TOKEN_TTL_MS).toBe(60_000);
    expect(await verifyCanvasToken(token, SECRET, NOW)).toEqual({
      c: "session:s-1",
      u: `anon:${ANON}`,
      a: "write",
      k: "session",
      r: "player",
      e: NOW + 60_000,
      v: 1,
    });
    expect(await verifyCanvasToken(token, SECRET, NOW + 60_000)).toBeNull();
  });

  it("names a signed-in player by their user id, with the face peers see", async () => {
    const token = await mintPlayerToken({
      sessionId: "s-2",
      userId: "user-1",
      anonId: ANON,
      name: "Alice",
      now: NOW,
    });
    expect(await verifyCanvasToken(token, SECRET, NOW)).toMatchObject({
      c: "session:s-2",
      u: "user-1",
      n: "Alice",
      r: "player",
    });
  });

  it("refuses a signed-out player without a well-formed anonymous id", async () => {
    await expect(mintPlayerToken({ sessionId: "s", userId: null })).rejects.toThrow("anonymous id");
    await expect(
      mintPlayerToken({ sessionId: "s", userId: null, anonId: "anon:not-a-uuid" }),
    ).rejects.toThrow("anonymous id");
  });

  it("refuses without a session id or a configured secret", async () => {
    await expect(mintPlayerToken({ sessionId: "", userId: "user-1" })).rejects.toThrow(
      "session id",
    );
    vi.stubEnv("CANVAS_SYNC_SECRET", "");
    await expect(mintPlayerToken({ sessionId: "s", userId: "user-1" })).rejects.toThrow(
      "aren't set up",
    );
  });
});
