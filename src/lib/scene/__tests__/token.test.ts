import { describe, expect, it } from "vite-plus/test";

import { SYNC_LIMITS } from "../../canvas/limits";
import { documentName } from "../../canvas/sync-channels";
import { signCanvasToken, tokenKind, verifyCanvasToken } from "../../canvas/token";

const SECRET = "scene-token-secret";
const NOW = 1_800_000_000_000;
const scene = {
  c: documentName("scene", "platformer.level-1"),
  u: "alice",
  a: "write",
  k: "scene",
  f: 1,
} as const;

const b64url = (text: string) =>
  btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signed(payload: unknown): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${b64url(String.fromCharCode(...sig))}`;
}

describe("scene sync tokens", () => {
  it("carry the kind and the client's format version", async () => {
    const claims = await verifyCanvasToken(await signCanvasToken(scene, SECRET, NOW), SECRET, NOW);
    expect(claims).toEqual({ ...scene, e: NOW + SYNC_LIMITS.tokenTtlMs, v: 1 });
    expect(tokenKind(claims!)).toBe("scene");
  });

  it("leave canvas tokens as they were", async () => {
    const token = await signCanvasToken(
      { c: "canvas:abc", u: "alice", a: "write", k: "canvas" },
      SECRET,
      NOW,
    );
    const claims = await verifyCanvasToken(token, SECRET, NOW);
    expect(claims).not.toHaveProperty("k");
    expect(claims).not.toHaveProperty("f");
    expect(tokenKind(claims!)).toBe("canvas");
  });

  it("expire after the TTL", async () => {
    const token = await signCanvasToken(scene, SECRET, NOW);
    expect(await verifyCanvasToken(token, SECRET, NOW + SYNC_LIMITS.tokenTtlMs - 1)).not.toBeNull();
    expect(await verifyCanvasToken(token, SECRET, NOW + SYNC_LIMITS.tokenTtlMs)).toBeNull();
  });

  it("refuse tampering: another scene, a write upgrade, a newer engine", async () => {
    const token = await signCanvasToken({ ...scene, a: "read" }, SECRET, NOW);
    const [payload, signature] = token.split(".") as [string, string];
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    for (const change of [
      { c: "scene:platformer.other" },
      { a: "write" },
      { f: 2 },
      { k: undefined },
    ]) {
      const forged = `${b64url(JSON.stringify({ ...claims, ...change }))}.${signature}`;
      expect(await verifyCanvasToken(forged, SECRET, NOW)).toBeNull();
    }
    expect(await verifyCanvasToken(token, "another-secret", NOW)).toBeNull();
  });

  it("refuse a kind or a format version they don't know, even when signed", async () => {
    const base = { ...scene, e: NOW + 1_000, v: 1 };
    for (const bad of [{ k: "note" }, { f: -1 }, { f: 1.5 }, { f: "1" }]) {
      expect(await verifyCanvasToken(await signed({ ...base, ...bad }), SECRET, NOW)).toBeNull();
    }
    expect(await verifyCanvasToken(await signed(base), SECRET, NOW)).toEqual(base);
  });
});
