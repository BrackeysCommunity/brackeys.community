import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { isSealedToken, openToken, sealToken } from "../token-crypto";

// 32 zero bytes — a valid key shape, not a secret.
const TEST_KEY = Buffer.alloc(32).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sealToken() / openToken()", () => {
  it("round-trips a token", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", TEST_KEY);
    const sealed = sealToken("itch-api-key-123");
    expect(isSealedToken(sealed)).toBe(true);
    expect(sealed).not.toContain("itch-api-key-123");
    expect(openToken(sealed)).toBe("itch-api-key-123");
  });

  it("uses the enc:v1 format with a fresh IV per seal", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", TEST_KEY);
    const a = sealToken("same-token");
    const b = sealToken("same-token");
    expect(a).toMatch(/^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
  });

  it("passes legacy plaintext through openToken untouched", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", TEST_KEY);
    expect(openToken("plain-legacy-token")).toBe("plain-legacy-token");
  });

  it("rejects tampered ciphertext", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", TEST_KEY);
    const sealed = sealToken("itch-api-key-123");
    const parts = sealed.split(":");
    const ct = Buffer.from(parts[4], "base64");
    ct[0] ^= 0xff;
    parts[4] = ct.toString("base64");
    expect(() => openToken(parts.join(":"))).toThrow();
  });

  it("rejects a sealed value when the key is missing or wrong", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", TEST_KEY);
    const sealed = sealToken("itch-api-key-123");

    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", "");
    expect(() => openToken(sealed)).toThrow(/LINKED_ACCOUNTS_ENC_KEY/);

    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", Buffer.alloc(32, 7).toString("base64"));
    expect(() => openToken(sealed)).toThrow();
  });

  it("stores plaintext (with a warning, not a crash) when no key is configured", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", "");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sealToken("tok")).toBe("tok");
    spy.mockRestore();
  });

  it("rejects a key of the wrong length outright", () => {
    vi.stubEnv("LINKED_ACCOUNTS_ENC_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => sealToken("tok")).toThrow(/32 bytes/);
  });
});
