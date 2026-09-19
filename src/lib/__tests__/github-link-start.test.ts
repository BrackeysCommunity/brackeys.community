import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * The GitHub link flow used `signIn.social`, and that is the whole bug this
 * guards: the sign-in route has no session, so better-auth resolves the
 * account by GitHub email alone and a member whose GitHub address differs
 * from their Discord one reads as a brand new signup — refused by
 * `disableSignUp` with `signup_disabled`, before the callback is ever
 * reached. `linkSocial` carries the session, so no email has to match.
 */

const linkSocial = vi.fn(async () => ({ data: null, error: null }) as const);
const signInSocial = vi.fn(async () => ({ data: null, error: null }) as const);

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    linkSocial,
    signIn: { social: signInSocial },
  }),
}));
vi.mock("better-auth/client/plugins", () => ({
  genericOAuthClient: () => ({}),
  inferAdditionalFields: () => ({}),
}));
vi.mock("@/lib/product-insights", () => ({ captureEvent: vi.fn() }));

beforeEach(() => {
  linkSocial.mockClear();
  signInSocial.mockClear();
  linkSocial.mockResolvedValue({ data: null, error: null });
});

describe("startGitHubLink", () => {
  it("links rather than signing in", async () => {
    const { startGitHubLink } = await import("@/lib/auth-client");

    await startGitHubLink();

    expect(linkSocial).toHaveBeenCalledTimes(1);
    // The regression itself: a sign-in here is what produced
    // `signup_disabled` for every member whose emails differ.
    expect(signInSocial).not.toHaveBeenCalled();
  });

  it("sends both the success and the error handoff to the callback route", async () => {
    const { startGitHubLink } = await import("@/lib/auth-client");

    await startGitHubLink();

    expect(linkSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/oauth/github/callback",
      // Without this a cancelled consent screen lands on better-auth's own
      // error page, outside the app with no way back.
      errorCallbackURL: "/oauth/github/callback",
    });
  });

  it("surfaces a refused start as a throw", async () => {
    const { startGitHubLink } = await import("@/lib/auth-client");
    linkSocial.mockResolvedValue({
      data: null,
      error: { message: "provider not configured" },
    } as never);

    await expect(startGitHubLink()).rejects.toThrow(/provider not configured/i);
  });

  it("still throws when the error carries no message", async () => {
    const { startGitHubLink } = await import("@/lib/auth-client");
    linkSocial.mockResolvedValue({ data: null, error: {} } as never);

    await expect(startGitHubLink()).rejects.toThrow(/failed to start github oauth/i);
  });
});
