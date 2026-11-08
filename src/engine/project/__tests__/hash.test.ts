import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { isSha256, sha256 } from "../hash";

const nodeSha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let at = 0; at < length; at += 65536) {
    globalThis.crypto.getRandomValues(out.subarray(at, Math.min(length, at + 65536)));
  }
  return out;
}

function randomText(length: number): string {
  const pool = ["a", "Z", "0", " ", "\n", "é", "ß", "漢", "🎮", "\u0000", '"', "\\"];
  let out = "";
  for (const b of randomBytes(length)) out += pool[b % pool.length];
  return out;
}

describe("sha256", () => {
  it("matches node:crypto on random bytes", async () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 1000, 70_000]) {
      const bytes = randomBytes(length);
      expect(await sha256(bytes), `${length} bytes`).toBe(nodeSha(bytes));
    }
  });

  it("hashes strings as UTF-8", async () => {
    for (const length of [0, 1, 17, 300, 5000]) {
      const text = randomText(length);
      const hash = await sha256(text);
      expect(hash).toBe(nodeSha(Buffer.from(text, "utf8")));
      expect(hash).toBe(await sha256(new TextEncoder().encode(text)));
    }
  });

  it("hashes a view's bytes, not its whole buffer", async () => {
    const bytes = randomBytes(256);
    const view = bytes.subarray(10, 100);
    expect(await sha256(view)).toBe(nodeSha(Buffer.from(view)));
  });

  it("gives the known digest of the empty input", async () => {
    expect(await sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("isSha256", () => {
  it("accepts exactly 64 lowercase hex characters", async () => {
    expect(isSha256(await sha256("x"))).toBe(true);
    expect(isSha256("a".repeat(64))).toBe(true);
    for (const bad of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), `${"a".repeat(63)}g`]) {
      expect(isSha256(bad), bad).toBe(false);
    }
  });
});
