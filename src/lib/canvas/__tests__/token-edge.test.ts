import { describe, expect, it, vi } from "vite-plus/test";

import { signCanvasToken, verifyCanvasToken } from "../token";

const SECRET = "edge-test-secret-long-enough";
const NOW = 1_700_000_000_000;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Correctly signed, so only the payload checks stand between it and a session. */
async function signed(payload: Uint8Array | string): Promise<string> {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const body = b64url(bytes);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

const good = { c: "canvas:c1", u: "alice", a: "write", e: NOW + 60_000, v: 1 };

describe("verifyCanvasToken with a valid signature over a bad payload", () => {
  it.each([
    ["not JSON", "not json"],
    ["JSON null", "null"],
    ["a JSON string", '"canvas:c1"'],
    ["an array", JSON.stringify([good])],
    ["no document", JSON.stringify({ ...good, c: undefined })],
    ["an empty document", JSON.stringify({ ...good, c: "" })],
    ["an empty user", JSON.stringify({ ...good, u: "" })],
    ["a numeric user", JSON.stringify({ ...good, u: 42 })],
    ["access owner", JSON.stringify({ ...good, a: "owner" })],
    ["expiry as a string", JSON.stringify({ ...good, e: String(NOW + 60_000) })],
    ["no expiry", JSON.stringify({ ...good, e: undefined })],
    ["version as a string", JSON.stringify({ ...good, v: "1" })],
    ["no version", JSON.stringify({ ...good, v: undefined })],
  ])("refuses %s", async (_label, payload) => {
    expect(await verifyCanvasToken(await signed(payload), SECRET, NOW)).toBeNull();
  });

  it("refuses invalid UTF-8 without throwing", async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    expect(await verifyCanvasToken(await signed(bytes), SECRET, NOW)).toBeNull();
  });

  it("accepts the well-formed payload it was built from", async () => {
    expect(await verifyCanvasToken(await signed(JSON.stringify(good)), SECRET, NOW)).toEqual(good);
  });

  it("treats the expiry instant itself as expired", async () => {
    const token = await signCanvasToken(
      { c: "canvas:c1", u: "alice", a: "read" },
      SECRET,
      NOW,
      1000,
    );
    expect(await verifyCanvasToken(token, SECRET, NOW + 999)).not.toBeNull();
    expect(await verifyCanvasToken(token, SECRET, NOW + 1000)).toBeNull();
  });

  it("refuses a signature from another token, and a padded or truncated signature", async () => {
    const a = await signCanvasToken({ c: "canvas:a", u: "alice", a: "write" }, SECRET, NOW);
    const b = await signCanvasToken({ c: "canvas:b", u: "alice", a: "write" }, SECRET, NOW);
    const [payloadA, sigA] = a.split(".") as [string, string];
    const [, sigB] = b.split(".") as [string, string];
    expect(await verifyCanvasToken(`${payloadA}.${sigB}`, SECRET, NOW)).toBeNull();
    expect(await verifyCanvasToken(`${payloadA}.${sigA}=`, SECRET, NOW)).toBeNull();
    expect(await verifyCanvasToken(`${payloadA}.${sigA.slice(0, -2)}`, SECRET, NOW)).toBeNull();
    expect(await verifyCanvasToken(`${payloadA}.${sigA}AA`, SECRET, NOW)).toBeNull();
  });

  it("keeps two secrets apart in its key cache", async () => {
    const token = await signCanvasToken({ c: "canvas:a", u: "alice", a: "write" }, SECRET, NOW);
    for (let i = 0; i < 12; i++) {
      await signCanvasToken({ c: "canvas:a", u: "alice", a: "write" }, `other-secret-${i}`, NOW);
    }
    expect(await verifyCanvasToken(token, SECRET, NOW)).not.toBeNull();
    expect(await verifyCanvasToken(token, "other-secret-3", NOW)).toBeNull();
  });

  it("doesn't cache a key import that failed", async () => {
    const secret = "secret-whose-first-import-fails";
    const spy = vi
      .spyOn(crypto.subtle, "importKey")
      .mockImplementationOnce(() => Promise.reject(new Error("transient")));
    try {
      await expect(
        signCanvasToken({ c: "canvas:a", u: "alice", a: "write" }, secret, NOW),
      ).rejects.toThrow("transient");
      await Promise.resolve();
      const token = await signCanvasToken({ c: "canvas:a", u: "alice", a: "write" }, secret, NOW);
      expect(await verifyCanvasToken(token, secret, NOW)).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
