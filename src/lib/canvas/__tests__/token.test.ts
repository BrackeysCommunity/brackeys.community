import { describe, expect, it } from "vite-plus/test";

import { SYNC_LIMITS } from "../limits";
import { signCanvasToken, tokenAdmits, tokenKind, verifyCanvasToken } from "../token";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;
const claims = { c: "canvas:abc", u: "alice", a: "write" } as const;

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("canvas sync tokens", () => {
  it("round-trips the claims with a TTL", async () => {
    const token = await signCanvasToken(claims, SECRET, NOW);
    expect(await verifyCanvasToken(token, SECRET, NOW)).toEqual({
      ...claims,
      e: NOW + SYNC_LIMITS.tokenTtlMs,
      v: 1,
    });
  });

  it("carries the face peers see, leaving out a missing avatar", async () => {
    const withFace = await signCanvasToken(
      { ...claims, n: "Alice", p: "https://cdn.test/a.png" },
      SECRET,
      NOW,
    );
    expect(await verifyCanvasToken(withFace, SECRET, NOW)).toMatchObject({
      n: "Alice",
      p: "https://cdn.test/a.png",
    });
    const noAvatar = await verifyCanvasToken(
      await signCanvasToken({ ...claims, n: "Alice", p: null }, SECRET, NOW),
      SECRET,
      NOW,
    );
    expect(noAvatar).toMatchObject({ n: "Alice" });
    expect(noAvatar).not.toHaveProperty("p");
  });

  it("expires", async () => {
    const token = await signCanvasToken(claims, SECRET, NOW);
    expect(await verifyCanvasToken(token, SECRET, NOW + SYNC_LIMITS.tokenTtlMs - 1)).not.toBeNull();
    expect(await verifyCanvasToken(token, SECRET, NOW + SYNC_LIMITS.tokenTtlMs)).toBeNull();
  });

  it("refuses a tampered payload", async () => {
    const token = await signCanvasToken({ ...claims, a: "read" }, SECRET, NOW);
    const [, signature] = token.split(".");
    const forged = b64url(JSON.stringify({ ...claims, a: "write", e: NOW + 60_000, v: 1 }));
    expect(await verifyCanvasToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("refuses a tampered signature and a wrong secret", async () => {
    const token = await signCanvasToken(claims, SECRET, NOW);
    const [payload, signature] = token.split(".") as [string, string];
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(await verifyCanvasToken(`${payload}.${flipped}`, SECRET, NOW)).toBeNull();
    expect(await verifyCanvasToken(token, "other-secret", NOW)).toBeNull();
  });

  it("refuses another token version", async () => {
    const payload = b64url(JSON.stringify({ ...claims, e: NOW + 60_000, v: 2 }));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );
    const sig = b64url(String.fromCharCode(...signature));
    expect(await verifyCanvasToken(`${payload}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it.each([
    "",
    "a",
    "a.b.c",
    ".",
    "a.",
    ".b",
    "!!!.???",
    `${b64url("not json")}.AAAA`,
    "x".repeat(10_000),
  ])("returns null for garbage %#", async (garbage) => {
    await expect(verifyCanvasToken(garbage, SECRET, NOW)).resolves.toBeNull();
  });

  it("returns null for non-strings", async () => {
    for (const value of [undefined, null, 42, {}, ["a.b"]]) {
      await expect(verifyCanvasToken(value, SECRET, NOW)).resolves.toBeNull();
    }
  });
});

describe("project-scoped tokens", () => {
  const project = {
    c: "project:jam",
    u: "alice",
    a: "write",
    k: "project",
    s: "project",
    f: 2,
    l: 1,
  } as const;

  it("round-trip the scope, the layout version and an agent's claims", async () => {
    const agent = { ...project, g: "agent-1", o: "alice" };
    const claims = await verifyCanvasToken(await signCanvasToken(agent, SECRET, NOW), SECRET, NOW);
    expect(claims).toEqual({ ...agent, e: NOW + SYNC_LIMITS.tokenTtlMs, v: 1 });
    expect(tokenKind(claims!)).toBe("project");
  });

  it("carry an asset token's kind and layout", async () => {
    const asset = { c: "asset:jam.k1", u: "alice", a: "read", k: "asset", l: 1 } as const;
    const claims = await verifyCanvasToken(await signCanvasToken(asset, SECRET, NOW), SECRET, NOW);
    expect(claims).toMatchObject(asset);
  });

  it("admit every document of their project and nothing else", () => {
    for (const name of ["project:jam", "scene:jam.level-1", "asset:jam.k1"]) {
      expect(tokenAdmits(project, name)).toBe(true);
    }
    for (const name of ["project:other", "scene:other.level-1", "asset:other.k1", "canvas:jam"]) {
      expect(tokenAdmits(project, name)).toBe(false);
    }
  });

  it("leave single-document tokens to their own document", () => {
    const asset = { c: "asset:jam.k1" };
    expect(tokenAdmits(asset, "asset:jam.k1")).toBe(true);
    expect(tokenAdmits(asset, "asset:jam.k2")).toBe(false);
    expect(tokenAdmits(asset, "project:jam")).toBe(false);
    expect(tokenAdmits({ c: "project:jam" }, "scene:jam.level-1")).toBe(false);
    expect(tokenAdmits({ c: "canvas:c1" }, "canvas:c1")).toBe(true);
  });
});
