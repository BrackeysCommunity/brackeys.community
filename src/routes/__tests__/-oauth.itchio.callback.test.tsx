// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  buildOAuthState,
  buildPreviewBounceUrl,
  consumeStoredNonce,
  isAllowedPreviewOrigin,
  parseOAuthState,
} from "@/lib/itchio-oauth";

// ── Tests for the itch.io OAuth callback logic ──────────────────────────────
// The callback page reads the URL hash and either:
// 1. Bounces to an allowlisted preview env (state carries `nonce|origin`),
//    forwarding the full state so the preview runs its own nonce check
// 2. Verifies the single-use CSRF nonce, then calls linkItchIo
// 3. Shows an error (bad origin, missing token, or nonce mismatch)
//
// The parsing/validation lives in `@/lib/itchio-oauth` so these tests hit
// the real functions; the route component itself is thin glue around them.

const PROD_ORIGIN = "https://brackeys.community";

describe("parseOAuthState", () => {
  it("parses a bare nonce with no origin (production flow)", () => {
    expect(parseOAuthState("6f278f6a-8a35-4a0b-bd21-8a5b21a56dcd")).toEqual({
      nonce: "6f278f6a-8a35-4a0b-bd21-8a5b21a56dcd",
      origin: null,
    });
  });

  it("splits nonce|origin (preview flow)", () => {
    expect(parseOAuthState("abc-123|https://x.up.railway.app")).toEqual({
      nonce: "abc-123",
      origin: "https://x.up.railway.app",
    });
  });

  it("returns nulls for null or empty state", () => {
    expect(parseOAuthState(null)).toEqual({ nonce: null, origin: null });
    expect(parseOAuthState("")).toEqual({ nonce: null, origin: null });
  });

  it("treats empty segments as null", () => {
    expect(parseOAuthState("|https://x.up.railway.app")).toEqual({
      nonce: null,
      origin: "https://x.up.railway.app",
    });
    expect(parseOAuthState("abc-123|")).toEqual({ nonce: "abc-123", origin: null });
  });
});

describe("isAllowedPreviewOrigin", () => {
  it("accepts Railway preview origins over https", () => {
    expect(isAllowedPreviewOrigin("https://x.up.railway.app")).toBe(true);
    expect(isAllowedPreviewOrigin("https://58-preview-17ca.up.railway.app")).toBe(true);
  });

  it("accepts local dev origins over http", () => {
    expect(isAllowedPreviewOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedPreviewOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects arbitrary origins", () => {
    expect(isAllowedPreviewOrigin("https://evil.com")).toBe(false);
  });

  it("rejects lookalike hosts that only embed the allowed suffix", () => {
    expect(isAllowedPreviewOrigin("https://x.up.railway.app.evil.com")).toBe(false);
    expect(isAllowedPreviewOrigin("https://up.railway.app")).toBe(false);
  });

  it("rejects wrong protocols", () => {
    expect(isAllowedPreviewOrigin("http://x.up.railway.app")).toBe(false);
    expect(isAllowedPreviewOrigin("https://localhost:5173")).toBe(false);
  });

  it("rejects anything that is not a bare origin", () => {
    expect(isAllowedPreviewOrigin("https://x.up.railway.app/path")).toBe(false);
    expect(isAllowedPreviewOrigin("https://x.up.railway.app/")).toBe(false);
    expect(isAllowedPreviewOrigin("https://x.up.railway.app?q=1")).toBe(false);
  });

  it("rejects empty and unparseable strings", () => {
    expect(isAllowedPreviewOrigin("")).toBe(false);
    expect(isAllowedPreviewOrigin("not a url")).toBe(false);
  });
});

describe("nonce lifecycle", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("production flow: bare nonce round-trips against storage", () => {
    const state = buildOAuthState(PROD_ORIGIN, PROD_ORIGIN);
    const { nonce, origin } = parseOAuthState(state);

    expect(origin).toBeNull();
    expect(nonce).toBe(state);
    expect(consumeStoredNonce()).toBe(nonce);
  });

  it("preview flow: state carries the initiating origin alongside the nonce", () => {
    const state = buildOAuthState("http://localhost:5173", PROD_ORIGIN);
    const { nonce, origin } = parseOAuthState(state);

    expect(origin).toBe("http://localhost:5173");
    expect(nonce).not.toBeNull();
    expect(consumeStoredNonce()).toBe(nonce);
  });

  it("no proxy origin configured: falls back to a bare nonce", () => {
    const state = buildOAuthState("http://localhost:5173", undefined);
    expect(parseOAuthState(state).origin).toBeNull();
  });

  it("the stored nonce is single-use", () => {
    const state = buildOAuthState(PROD_ORIGIN, PROD_ORIGIN);
    expect(consumeStoredNonce()).toBe(state);
    expect(consumeStoredNonce()).toBeNull();
  });

  it("a forged state does not match the stored nonce", () => {
    buildOAuthState(PROD_ORIGIN, PROD_ORIGIN);
    const forged = parseOAuthState("attacker-supplied-value");
    expect(consumeStoredNonce()).not.toBe(forged.nonce);
  });

  it("a callback with no prior flow has no stored nonce", () => {
    expect(consumeStoredNonce()).toBeNull();
  });
});

describe("buildPreviewBounceUrl", () => {
  it("forwards the full original state, URL-encoded, and it survives re-parsing", () => {
    const state = "abc-123|https://x.up.railway.app";
    const url = buildPreviewBounceUrl("https://x.up.railway.app", "my-token", state);

    expect(url.startsWith("https://x.up.railway.app/oauth/itchio/callback#")).toBe(true);

    // The receiving callback parses the hash the same way itch's would be.
    const hash = new URLSearchParams(url.split("#")[1]);
    expect(hash.get("access_token")).toBe("my-token");
    expect(hash.get("state")).toBe(state);
  });
});
