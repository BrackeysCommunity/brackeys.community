import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Every way into an account link goes through one of these starts, and
 * each start owns two things a call site used to get wrong on its own:
 *
 * - the GitHub flow used `signIn.social`, which has no session, so
 *   better-auth resolved the account by GitHub email alone and a member
 *   whose GitHub address differs from their Discord one was refused as a
 *   new signup before the callback was ever reached. `linkSocial` carries
 *   the session, so no email has to match.
 * - the `account_link_started` event, which the funnel's start column is
 *   built on. Launch day read 2 starts against 11 completions because two
 *   entry points fired nothing.
 */

const linkSocial = vi.fn(async () => ({ data: null, error: null }) as const);
const signInSocial = vi.fn(async () => ({ data: null, error: null }) as const);
const oauth2Link = vi.fn(async () => ({ data: null, error: null }) as const);
const captureEvent = vi.fn();

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    linkSocial,
    signIn: { social: signInSocial },
    oauth2: { link: oauth2Link },
  }),
}));
vi.mock("better-auth/client/plugins", () => ({
  genericOAuthClient: () => ({}),
  inferAdditionalFields: () => ({}),
}));
vi.mock("@/lib/product-insights", () => ({ captureEvent }));

beforeEach(() => {
  for (const fn of [linkSocial, signInSocial, oauth2Link, captureEvent]) fn.mockClear();
  linkSocial.mockResolvedValue({ data: null, error: null });
  oauth2Link.mockResolvedValue({ data: null, error: null });
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

  it("counts the start on the profile surface", async () => {
    const { startGitHubLink } = await import("@/lib/auth-client");

    await startGitHubLink();

    expect(captureEvent).toHaveBeenCalledWith("account_link_started", {
      provider: "github",
      surface: "profile",
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

describe("startGitLabLink", () => {
  it("links the instance with both handoffs on its own callback route", async () => {
    const { startGitLabLink } = await import("@/lib/auth-client");

    await startGitLabLink("gitlab-com");

    expect(oauth2Link).toHaveBeenCalledWith({
      providerId: "gitlab-com",
      callbackURL: "/oauth/gitlab/gitlab-com/callback",
      errorCallbackURL: "/oauth/gitlab/gitlab-com/callback",
    });
    expect(signInSocial).not.toHaveBeenCalled();
  });

  it("counts the start under the instance's provider id", async () => {
    const { startGitLabLink } = await import("@/lib/auth-client");

    await startGitLabLink("gitlab-com");

    expect(captureEvent).toHaveBeenCalledWith("account_link_started", {
      provider: "gitlab-com",
      surface: "profile",
    });
  });

  it("surfaces a refused start as a throw", async () => {
    const { startGitLabLink } = await import("@/lib/auth-client");
    oauth2Link.mockResolvedValue({ data: null, error: { message: "nope" } } as never);

    await expect(startGitLabLink("gitlab-com")).rejects.toThrow(/nope/);
  });
});

describe("linkSigninProvider", () => {
  it("returns to the settings page rather than a sync route, on both handoffs", async () => {
    const { linkSigninProvider } = await import("@/lib/auth-client");

    await linkSigninProvider("github");

    expect(linkSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/settings/account",
      errorCallbackURL: "/settings/account",
    });
  });

  it("counts the start on the settings surface, so the funnel can set it aside", async () => {
    const { linkSigninProvider } = await import("@/lib/auth-client");

    await linkSigninProvider("github");

    // No completion ever fires for this surface — better-auth finishes the
    // link itself — so a start filed as `profile` would read as drop-off.
    expect(captureEvent).toHaveBeenCalledWith("account_link_started", {
      provider: "github",
      surface: "settings",
    });
  });

  it("surfaces a refused start as a throw", async () => {
    const { linkSigninProvider } = await import("@/lib/auth-client");
    linkSocial.mockResolvedValue({ data: null, error: {} } as never);

    await expect(linkSigninProvider("discord")).rejects.toThrow(/could not start linking/i);
  });
});
