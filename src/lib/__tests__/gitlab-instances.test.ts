import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fetchGitLabCalendar } from "@/lib/gitlab";
import {
  GITLAB_INSTANCES,
  gitlabCallbackPath,
  gitlabInstance,
  gitlabOrigin,
  isGitLabProvider,
  isSelfHostedGitLab,
} from "@/lib/gitlab-instances";
import {
  configuredGitLabInstances,
  gitlabOAuthConfigs,
  isGitLabInstanceConfigured,
} from "@/lib/gitlab-oauth";

/**
 * The registry is what decides that `git.booth.dev` exists at all, and the
 * env pair is what decides whether it exists *here*. An instance with no
 * credentials must be absent — a menu entry whose OAuth dance has no client
 * id is the "broken in it" case §12 is written against.
 */

const PREFIXES = GITLAB_INSTANCES.map((i) => i.envPrefix);

function clearCredentials() {
  for (const prefix of PREFIXES) {
    delete process.env[`${prefix}_CLIENT_ID`];
    delete process.env[`${prefix}_CLIENT_SECRET`];
  }
}

function setCredentials(prefix: string) {
  process.env[`${prefix}_CLIENT_ID`] = `${prefix}-id`;
  process.env[`${prefix}_CLIENT_SECRET`] = `${prefix}-secret`;
}

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const prefix of PREFIXES) {
    for (const suffix of ["_CLIENT_ID", "_CLIENT_SECRET"]) {
      saved.set(`${prefix}${suffix}`, process.env[`${prefix}${suffix}`]);
    }
  }
  clearCredentials();
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.unstubAllGlobals();
});

function mockGitLabUser(user: Record<string, unknown>) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => user,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("the registry", () => {
  it("gives every instance a distinct provider id, host and env prefix", () => {
    const ids = GITLAB_INSTANCES.map((i) => i.providerId);
    const hosts = GITLAB_INSTANCES.map((i) => i.host);
    const prefixes = GITLAB_INSTANCES.map((i) => i.envPrefix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("knows the three instances the guild named, and nothing else", () => {
    expect(GITLAB_INSTANCES.map((i) => i.host)).toEqual([
      "gitlab.com",
      "git.booth.dev",
      "git.brackeys.dev",
    ]);
    expect(isGitLabProvider("gitlab-booth")).toBe(true);
    expect(isGitLabProvider("github")).toBe(false);
    expect(gitlabInstance("gitlab-nope")).toBeUndefined();
  });

  it("separates the hosted instance from the self-hosted ones", () => {
    expect(isSelfHostedGitLab(gitlabInstance("gitlab")!)).toBe(false);
    expect(isSelfHostedGitLab(gitlabInstance("gitlab-booth")!)).toBe(true);
    expect(gitlabOrigin(gitlabInstance("gitlab-brackeys")!)).toBe("https://git.brackeys.dev");
    expect(gitlabCallbackPath("gitlab-booth")).toBe("/oauth/gitlab/gitlab-booth/callback");
  });
});

describe("env-gated configuration", () => {
  it("offers nothing when no instance has credentials", () => {
    expect(configuredGitLabInstances()).toEqual([]);
    expect(gitlabOAuthConfigs()).toEqual([]);
    expect(isGitLabInstanceConfigured("gitlab")).toBe(false);
  });

  it("offers an instance with a client id and no secret — the public client", () => {
    process.env.GITLAB_BOOTH_CLIENT_ID = "id-only";

    expect(configuredGitLabInstances().map((i) => i.providerId)).toEqual(["gitlab-booth"]);
    const [config] = gitlabOAuthConfigs();
    expect(config.clientId).toBe("id-only");
    // Absent, not empty: better-auth omits `client_secret` from the token
    // exchange entirely, which is what a non-confidential app requires.
    expect("clientSecret" in config).toBe(false);
    expect(config.pkce).toBe(true);
  });

  it("drops an instance that has a secret but no client id", () => {
    process.env.GITLAB_BOOTH_CLIENT_SECRET = "secret-only";
    expect(configuredGitLabInstances()).toEqual([]);
  });

  it("offers only the instances that are configured", () => {
    setCredentials("GITLAB");
    setCredentials("GITLAB_BRACKEYS");

    expect(configuredGitLabInstances().map((i) => i.providerId)).toEqual([
      "gitlab",
      "gitlab-brackeys",
    ]);
    expect(isGitLabInstanceConfigured("gitlab-booth")).toBe(false);
    expect(isGitLabInstanceConfigured("gitlab-brackeys")).toBe(true);
  });

  it("builds one discovery-driven provider per configured instance", () => {
    setCredentials("GITLAB_BOOTH");

    const [config, ...rest] = gitlabOAuthConfigs();
    expect(rest).toEqual([]);
    expect(config.providerId).toBe("gitlab-booth");
    expect(config.clientId).toBe("GITLAB_BOOTH-id");
    expect(config.clientSecret).toBe("GITLAB_BOOTH-secret");
    expect(config.discoveryUrl).toBe("https://git.booth.dev/.well-known/openid-configuration");
    expect(config.scopes).toEqual(["read_user"]);
    // A GitLab login must never mint a user: only Discord does that.
    expect(config.disableSignUp).toBe(true);
  });
});

/**
 * better-auth's callback refuses a user-info object with no email or no
 * name, and answers the member with a bare `error=email_is_missing` in the
 * URL — so the shape this returns is the whole link flow.
 */
describe("the provider's user-info", () => {
  it("reads the instance's own API and fills name from the username", async () => {
    setCredentials("GITLAB_BOOTH");
    const fetchMock = mockGitLabUser({
      id: 77,
      username: "yasahiro",
      name: null,
      avatar_url: null,
      web_url: "https://git.booth.dev/yasahiro",
      email: "yasahiro@booth.dev",
    });

    const info = await gitlabOAuthConfigs()[0].getUserInfo!({ accessToken: "tok" } as never);

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://git.booth.dev/api/v4/user",
    );
    expect(info).toMatchObject({
      id: "77",
      name: "yasahiro",
      email: "yasahiro@booth.dev",
      emailVerified: false,
    });
  });

  it("stands in a non-routable address when the instance withholds one", async () => {
    setCredentials("GITLAB_BOOTH");
    mockGitLabUser({
      id: 77,
      username: "yasahiro",
      name: "Yasahiro",
      avatar_url: null,
      web_url: "https://git.booth.dev/yasahiro",
    });

    const info = await gitlabOAuthConfigs()[0].getUserInfo!({ accessToken: "tok" } as never);

    expect(info).toMatchObject({ email: "yasahiro@git.booth.dev.invalid", name: "Yasahiro" });
  });

  it("reports nothing rather than half a profile when the API fails", async () => {
    setCredentials("GITLAB");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" })),
    );

    expect(await gitlabOAuthConfigs()[0].getUserInfo!({ accessToken: "tok" } as never)).toBeNull();
  });
});

/**
 * `calendar.json` is a Rails route, not `/api/v4`: a public profile answers
 * anonymously, and a private or unknown one bounces to `/users/sign_in`
 * with a 302 rather than a 404. Following that redirect would hand back an
 * HTML sign-in page to parse as a calendar.
 */
describe("the contribution calendar", () => {
  const instance = gitlabInstance("gitlab-brackeys")!;

  function mockCalendar(status: number, body: unknown) {
    const fn = vi.fn(async () => ({
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("reads the instance's own route and never follows a redirect", async () => {
    const fetchMock = mockCalendar(200, { "2026-09-11": 4, "2026-09-12": 1 });

    const days = await fetchGitLabCalendar(instance, "yasa hiro");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://git.brackeys.dev/users/yasa%20hiro/calendar.json");
    expect(init.redirect).toBe("manual");
    expect(days).toEqual({ "2026-09-11": 4, "2026-09-12": 1 });
  });

  it("reads a sign-in bounce as no graph", async () => {
    mockCalendar(302, null);

    expect(await fetchGitLabCalendar(instance, "private")).toBeNull();
  });

  it("drops entries that are not a date and a positive count", async () => {
    mockCalendar(200, {
      "2026-09-11": 4,
      "2026-09-12": 0,
      "2026-09-13": -2,
      "not-a-date": 9,
      "2026-09-14": "3",
    });

    expect(await fetchGitLabCalendar(instance, "yasa")).toEqual({ "2026-09-11": 4 });
  });

  it("returns nothing when the body is not an object", async () => {
    mockCalendar(200, [1, 2, 3]);

    expect(await fetchGitLabCalendar(instance, "yasa")).toBeNull();
  });
});
