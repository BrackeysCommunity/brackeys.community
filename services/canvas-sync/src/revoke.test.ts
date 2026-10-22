import { describe, expect, it } from "bun:test";

import {
  REVOKE_CLOCK_SKEW_MS,
  SYNC_CLOSE,
  syncCloseCode,
} from "../../../src/lib/canvas/sync-channels.ts";
import { connectionsToRevoke, RevocationList, revoke } from "./revoke.ts";

function fakeConnection(userId: string) {
  const closes: { code: number; reason: string }[] = [];
  return {
    userId,
    closes,
    context: { userId },
    close(event?: { code: number; reason: string }) {
      if (event) closes.push(event);
    },
  };
}

function documents() {
  const a1 = fakeConnection("alice");
  const b1 = fakeConnection("bob");
  const b2 = fakeConnection("bob");
  const c2 = fakeConnection("carol");
  const map = new Map([
    ["canvas:one", { getConnections: () => [a1, b1] }],
    ["canvas:two", { getConnections: () => [b2, c2] }],
  ]);
  return { map, a1, b1, b2, c2 };
}

describe("revoke", () => {
  it("closes one user's connections on one canvas", () => {
    const { map, b1 } = documents();
    expect(connectionsToRevoke(map, { canvasId: "one", userId: "bob" })).toEqual([b1]);
  });

  it("closes everyone on a canvas", () => {
    const { map, b2, c2 } = documents();
    expect(connectionsToRevoke(map, { canvasId: "two" })).toEqual([b2, c2]);
  });

  it("closes one user everywhere", () => {
    const { map, b1, b2 } = documents();
    expect(connectionsToRevoke(map, { userId: "bob" })).toEqual([b1, b2]);
  });

  it("finds nothing for a canvas that isn't loaded", () => {
    const { map } = documents();
    expect(connectionsToRevoke(map, { canvasId: "three" })).toEqual([]);
  });

  it("closes with 4403", () => {
    const { map, a1, b1 } = documents();
    expect(revoke(map, { canvasId: "one", userId: "bob" })).toBe(1);
    expect(b1.closes.map((event) => syncCloseCode(event))).toEqual([SYNC_CLOSE.revoked]);
    expect(a1.closes).toEqual([]);
  });
});

describe("RevocationList", () => {
  const T = 1_000_000;

  it("covers tokens minted before (or just after) a matching revoke", () => {
    const list = new RevocationList(60_000, 2_000);
    list.record({ canvasId: "c1", userId: "bob" }, T);
    expect(list.covers("c1", "bob", T - 30_000, T)).toBe(true);
    expect(list.covers("c1", "bob", T + 1_999, T)).toBe(true);
    expect(list.covers("c1", "bob", T + 2_001, T + 2_001)).toBe(false);
    expect(list.covers("c1", "alice", T - 30_000, T)).toBe(false);
    expect(list.covers("c2", "bob", T - 30_000, T)).toBe(false);
  });

  it("matches canvas-wide and user-wide revokes", () => {
    const list = new RevocationList(60_000, 0);
    list.record({ canvasId: "c1" }, T);
    list.record({ userId: "carol" }, T);
    expect(list.covers("c1", "anyone", T - 1, T)).toBe(true);
    expect(list.covers("c9", "carol", T - 1, T)).toBe(true);
    expect(list.covers("c9", "dave", T - 1, T)).toBe(false);
  });

  it("forgets a revoke once no token from before it can still be valid", () => {
    const list = new RevocationList(60_000, 0);
    list.record({ canvasId: "c1", userId: "bob" }, T);
    expect(list.size).toBe(1);
    expect(list.covers("c1", "bob", T - 1, T + 60_001)).toBe(false);
    expect(list.size).toBe(0);
  });

  it("defaults to the token lifetime plus the clock allowance", () => {
    const list = new RevocationList();
    list.record({ userId: "bob" }, T);
    expect(list.covers("c1", "bob", T + REVOKE_CLOCK_SKEW_MS, T + 60_000)).toBe(true);
  });
});
