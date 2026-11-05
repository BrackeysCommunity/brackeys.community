import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { githubRefreshAccessToken } from "@/lib/github-refresh";

const refresh = githubRefreshAccessToken("client-id", "client-secret");
const fetchMock = vi.fn<typeof fetch>();

function answer(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("githubRefreshAccessToken", () => {
  it("spends the refresh token with this app's credentials", async () => {
    answer({ access_token: "gho_new", refresh_token: "ghr_new", expires_in: 28800 });

    await refresh("ghr_old");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    const body = new URLSearchParams(init!.body as URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "ghr_old",
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });

  it("returns the rotated pair with both expiries", async () => {
    answer({
      access_token: "gho_new",
      refresh_token: "ghr_new",
      token_type: "bearer",
      scope: "read:user,user:email",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    });
    const before = Date.now();

    const tokens = await refresh("ghr_old");

    expect(tokens).toMatchObject({
      accessToken: "gho_new",
      refreshToken: "ghr_new",
      scopes: ["read:user", "user:email"],
    });
    expect(tokens.accessTokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 28800_000);
    expect(tokens.refreshTokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 15897600_000);
  });

  /**
   * GitHub's rejection is a 200 with an error body; read as success it
   * leaves the expired token in place with nothing in the logs.
   */
  it("throws with GitHub's reason when the 200 carries an error", async () => {
    answer({ error: "bad_refresh_token", error_description: "The refresh token is invalid." });

    await expect(refresh("ghr_spent")).rejects.toThrow(
      "bad_refresh_token: The refresh token is invalid.",
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("bad_refresh_token"));
  });

  it("throws on a non-2xx answer", async () => {
    answer({}, 500);

    await expect(refresh("ghr_old")).rejects.toThrow("HTTP 500");
  });
});
