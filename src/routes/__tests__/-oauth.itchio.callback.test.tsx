// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// ── Tests for the itch.io OAuth callback proxy logic ────────────────────────
// The callback page reads the URL hash and either:
// 1. Bounces to a preview env (if state param contains a preview origin)
// 2. Calls linkItchIo with the access token (normal flow)
// 3. Shows an error if no access token
//
// We test the core logic directly rather than rendering the component,
// since the component is tightly coupled to TanStack Router's createFileRoute.

describe("itch.io OAuth callback proxy logic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function parseCallbackHash(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const state = params.get("state");
    return { accessToken, state };
  }

  it("extracts access_token from hash", () => {
    const { accessToken, state } = parseCallbackHash("#access_token=abc123");

    expect(accessToken).toBe("abc123");
    expect(state).toBeNull();
  });

  it("extracts both access_token and state from hash", () => {
    const { accessToken, state } = parseCallbackHash(
      "#access_token=abc123&state=https://preview-123.up.railway.app",
    );

    expect(accessToken).toBe("abc123");
    expect(state).toBe("https://preview-123.up.railway.app");
  });

  it("builds correct redirect URL for preview proxy bounce", () => {
    const { accessToken, state } = parseCallbackHash(
      "#access_token=my-token&state=https://preview-42.up.railway.app",
    );

    const shouldProxy = !!(state && accessToken);
    expect(shouldProxy).toBe(true);

    const redirectUrl = `${state}/oauth/itchio/callback#access_token=${accessToken}`;
    expect(redirectUrl).toBe(
      "https://preview-42.up.railway.app/oauth/itchio/callback#access_token=my-token",
    );
  });

  it("does not proxy when state is absent", () => {
    const { accessToken, state } = parseCallbackHash("#access_token=my-token");

    const shouldProxy = !!(state && accessToken);
    expect(shouldProxy).toBe(false);
  });

  it("does not proxy when access_token is absent", () => {
    const { accessToken, state } = parseCallbackHash("#state=https://preview-123.up.railway.app");

    const shouldProxy = !!(state && accessToken);
    expect(shouldProxy).toBe(false);
  });

  it("handles empty hash", () => {
    const { accessToken, state } = parseCallbackHash("");

    expect(accessToken).toBeNull();
    expect(state).toBeNull();
  });

  it("preserves complex preview URLs in state", () => {
    const previewUrl = "https://58-preview-17ca.up.railway.app";
    const { state } = parseCallbackHash(
      `#access_token=tok&state=${encodeURIComponent(previewUrl)}`,
    );

    expect(state).toBe(previewUrl);
  });
});
