import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { freshGitHubToken } from "@/lib/github-token";

vi.mock("@/lib/auth", () => ({ auth: { api: { getAccessToken: vi.fn() } } }));

const { auth } = await import("@/lib/auth");
const getAccessToken = vi.mocked(
  (auth as unknown as { api: { getAccessToken: (...args: unknown[]) => unknown } }).api
    .getAccessToken,
);

const inAnHour = () => new Date(Date.now() + 3_600_000);
const anHourAgo = () => new Date(Date.now() - 3_600_000);

beforeEach(() => {
  getAccessToken.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("freshGitHubToken", () => {
  it("asks better-auth for the member's token by id, with no session", async () => {
    getAccessToken.mockResolvedValue({ accessToken: "gho_new", accessTokenExpiresAt: inAnHour() });

    expect(await freshGitHubToken("u1")).toBe("gho_new");
    expect(getAccessToken).toHaveBeenCalledWith({
      body: { providerId: "github", userId: "u1" },
    });
  });

  /**
   * GitHub answers a spent refresh token with a 200 and an error body, so
   * better-auth reads "no new tokens" and returns the stored pair as-is.
   * Passing that on would spend a GitHub request to learn it's a 401.
   */
  it("refuses a token handed back still past its expiry", async () => {
    getAccessToken.mockResolvedValue({
      accessToken: "gho_dead",
      accessTokenExpiresAt: anHourAgo(),
    });

    expect(await freshGitHubToken("u1")).toBeNull();
  });

  it("takes a token with no stated expiry at its word", async () => {
    getAccessToken.mockResolvedValue({ accessToken: "gho_old", accessTokenExpiresAt: undefined });

    expect(await freshGitHubToken("u1")).toBe("gho_old");
  });

  it("answers null when there is no GitHub account to refresh from", async () => {
    getAccessToken.mockRejectedValue(new Error("Account not found"));

    expect(await freshGitHubToken("u1")).toBeNull();
  });
});
