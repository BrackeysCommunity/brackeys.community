import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { account, developerProfiles, linkedAccounts, user } from "@/db/schema";
import { syncGitHubLink, unlinkGitHub } from "@/orpc/router/github";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});

/**
 * GitHub reaches a member through two different doors, and the pair is what
 * these cover: the profile integration writes `linked_accounts` via the
 * OAuth callback, while `/settings/account` links GitHub as a sign-in
 * identity and only ever creates better-auth's `account` row. Unlinking has
 * to clear whichever exist — a member who linked from Settings used to keep
 * a sealed token they had just withdrawn consent for.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(linkedAccounts);
  await db.delete(account);
  await db.delete(developerProfiles);
  await db.delete(user);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedOAuthAccount(userId: string, providerId: string, token = "gh-token") {
  const now = new Date();
  await db.insert(account).values({
    id: `${userId}-${providerId}`,
    accountId: `${providerId}-acct`,
    providerId,
    userId,
    accessToken: token,
    createdAt: now,
    updatedAt: now,
  });
}

/** A `linked_accounts` row as the OAuth callback would have written it. */
async function seedProfileLink(userId: string) {
  const now = new Date();
  await db.insert(linkedAccounts).values({
    profileId: userId,
    provider: "github",
    providerUserId: "42",
    providerUsername: "octocat",
    providerAvatarUrl: null,
    providerProfileUrl: "https://github.com/octocat",
    accessToken: "sealed-token",
    scopes: "read:user",
    linkedAt: now,
    updatedAt: now,
  });
}

/** Answers `GET https://api.github.com/user`. */
function mockGitHubApi(profile: Record<string, unknown>) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => profile,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function storedLinks(profileId: string) {
  return db.select().from(linkedAccounts).where(eq(linkedAccounts.profileId, profileId));
}

async function storedAccounts(userId: string, providerId: string) {
  return db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)));
}

describe("syncGitHubLink", () => {
  it("refuses when better-auth has no GitHub account row", async () => {
    await seedUser(db, "u1");

    await expect(call(syncGitHubLink, {}, asUser("u1"))).rejects.toThrow(/no github account/i);
  });

  it("stores one row from the fetched GitHub profile", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "github", "token-abc");
    const fetchMock = mockGitHubApi({
      id: 583231,
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/583231",
      html_url: "https://github.com/octocat",
      bio: null,
    });

    const result = await call(syncGitHubLink, {}, asUser("u1"));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");

    expect(result.providerUsername).toBe("octocat");
    const rows = await storedLinks("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "github",
      providerUserId: "583231",
      providerUsername: "octocat",
      providerProfileUrl: "https://github.com/octocat",
      scopes: "read:user",
    });
  });

  it("updates the existing row on a re-sync rather than adding a second", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "github");

    mockGitHubApi({
      id: 1,
      login: "old",
      name: null,
      avatar_url: null,
      html_url: "https://github.com/old",
      bio: null,
    });
    await call(syncGitHubLink, {}, asUser("u1"));
    mockGitHubApi({
      id: 1,
      login: "renamed",
      name: null,
      avatar_url: null,
      html_url: "https://github.com/renamed",
      bio: null,
    });
    await call(syncGitHubLink, {}, asUser("u1"));

    const rows = await storedLinks("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].providerUsername).toBe("renamed");
  });

  it("reports a failed profile fetch rather than storing a half-link", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "github");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" })),
    );

    await expect(call(syncGitHubLink, {}, asUser("u1"))).rejects.toThrow(/failed to fetch/i);
    expect(await storedLinks("u1")).toHaveLength(0);
  });
});

describe("unlinkGitHub", () => {
  it("removes both the profile link and the better-auth account", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "discord");
    await seedOAuthAccount("u1", "github");
    await seedProfileLink("u1");

    await call(unlinkGitHub, {}, asUser("u1"));

    expect(await storedLinks("u1")).toHaveLength(0);
    expect(await storedAccounts("u1", "github")).toHaveLength(0);
    expect(await storedAccounts("u1", "discord")).toHaveLength(1);
  });

  it("unlinks a Settings-only link, which has no profile row", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "discord");
    await seedOAuthAccount("u1", "github");

    await expect(call(unlinkGitHub, {}, asUser("u1"))).resolves.toEqual({ success: true });

    expect(await storedAccounts("u1", "github")).toHaveLength(0);
  });

  it("clears a profile link that outlived its better-auth account", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "discord");
    await seedProfileLink("u1");

    await call(unlinkGitHub, {}, asUser("u1"));

    expect(await storedLinks("u1")).toHaveLength(0);
  });

  it("refuses to remove the only way in", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "github");
    await seedProfileLink("u1");

    await expect(call(unlinkGitHub, {}, asUser("u1"))).rejects.toThrow(/only way to sign in/i);

    // Nothing removed — the refusal has to leave the account intact.
    expect(await storedAccounts("u1", "github")).toHaveLength(1);
    expect(await storedLinks("u1")).toHaveLength(1);
  });

  it("says so when nothing is linked", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "discord");

    await expect(call(unlinkGitHub, {}, asUser("u1"))).rejects.toThrow(/no github account linked/i);
  });

  it("refuses an anonymous caller", async () => {
    await expect(call(unlinkGitHub, {}, asUser(null))).rejects.toThrow();
  });
});
