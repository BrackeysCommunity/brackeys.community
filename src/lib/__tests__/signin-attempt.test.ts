import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const getOAuthState = vi.fn();
vi.mock("better-auth/api", () => ({ getOAuthState: () => getOAuthState() }));

const { readSigninAttempt } = await import("@/lib/signin-attempt");

/** The shape better-auth hands back: our `additionalData` spread over its own
 *  state fields. */
function state(extra: Record<string, unknown>) {
  return {
    callbackURL: "/collab",
    codeVerifier: "v".repeat(128),
    expiresAt: Date.now() + 600_000,
    ...extra,
  };
}

beforeEach(() => {
  getOAuthState.mockReset();
});

describe("readSigninAttempt", () => {
  it("recovers the attempt id and the CTA the flow started from", async () => {
    getOAuthState.mockResolvedValue(
      state({ signinAttemptId: "5f3a-…", signinSource: "collab_create" }),
    );
    expect(await readSigninAttempt()).toEqual({
      signin_attempt_id: "5f3a-…",
      source: "collab_create",
    });
  });

  it("reports nothing when the session was not made by an OAuth callback", async () => {
    getOAuthState.mockResolvedValue(null);
    expect(await readSigninAttempt()).toEqual({});
  });

  it("reports nothing for a flow that started before the id existed", async () => {
    getOAuthState.mockResolvedValue(state({}));
    expect(await readSigninAttempt()).toEqual({});
  });

  it("keeps the half it can read when only one value came back", async () => {
    getOAuthState.mockResolvedValue(state({ signinAttemptId: "abc" }));
    expect(await readSigninAttempt()).toEqual({ signin_attempt_id: "abc" });
  });

  it("refuses a non-string, so a tampered state cannot put an object on an event", async () => {
    getOAuthState.mockResolvedValue(
      state({ signinAttemptId: { toString: () => "x" }, signinSource: ["header"] }),
    );
    expect(await readSigninAttempt()).toEqual({});
  });

  it("refuses an oversized value rather than shipping it as a property", async () => {
    getOAuthState.mockResolvedValue(state({ signinAttemptId: "x".repeat(65) }));
    expect(await readSigninAttempt()).toEqual({});
  });

  it("swallows a throw — a broken read must not break signing in", async () => {
    getOAuthState.mockRejectedValue(new Error("no request state"));
    expect(await readSigninAttempt()).toEqual({});
  });
});
