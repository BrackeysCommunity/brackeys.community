import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { account, developerProfiles, linkedAccounts, user } from "@/db/schema";
import { listGitLabInstances, syncGitLabLink, unlinkGitLab } from "@/orpc/router/gitlab";
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
 * One `linked_accounts` row per instance per member is the cardinality the
 * existing unique constraint already gives, so the thing worth testing is
 * that the instance actually reaches the row: a `gitlab-booth` link must
 * fetch `git.booth.dev` and store `gitlab-booth`, never collapse into a
 * single "gitlab" provider that the second instance would then overwrite.
 */

let db: TestDb;

const CREDENTIALS = [
  "GITLAB_CLIENT_ID",
  "GITLAB_CLIENT_SECRET",
  "GITLAB_BOOTH_CLIENT_ID",
  "GITLAB_BOOTH_CLIENT_SECRET",
  "GITLAB_BRACKEYS_CLIENT_ID",
  "GITLAB_BRACKEYS_CLIENT_SECRET",
];
const savedEnv = new Map<string, string | undefined>();

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(linkedAccounts);
  await db.delete(account);
  await db.delete(developerProfiles);
  await db.delete(user);

  for (const key of CREDENTIALS) savedEnv.set(key, process.env[key]);
  // gitlab.com and git.booth.dev configured; git.brackeys.dev is not.
  process.env.GITLAB_CLIENT_ID = "id";
  process.env.GITLAB_CLIENT_SECRET = "secret";
  process.env.GITLAB_BOOTH_CLIENT_ID = "id";
  process.env.GITLAB_BOOTH_CLIENT_SECRET = "secret";
  delete process.env.GITLAB_BRACKEYS_CLIENT_ID;
  delete process.env.GITLAB_BRACKEYS_CLIENT_SECRET;
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  vi.unstubAllGlobals();
});

async function seedOAuthAccount(userId: string, providerId: string, token = "gl-token") {
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

/** Answers `/api/v4/user` on any host, recording which one was asked. */
function mockGitLabApi(user: Record<string, unknown>) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => user,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function storedLinks(profileId: string) {
  return db.select().from(linkedAccounts).where(eq(linkedAccounts.profileId, profileId));
}

describe("listGitLabInstances", () => {
  it("lists only the instances this deployment has credentials for", async () => {
    await seedUser(db, "u1");

    const instances = await call(listGitLabInstances, {}, asUser("u1"));

    expect(instances.map((i) => i.providerId)).toEqual(["gitlab", "gitlab-booth"]);
    expect(instances.map((i) => i.host)).toEqual(["gitlab.com", "git.booth.dev"]);
  });

  it("refuses an anonymous caller", async () => {
    await expect(call(listGitLabInstances, {}, asUser(null))).rejects.toThrow();
  });
});

describe("syncGitLabLink", () => {
  it("refuses a provider id the registry does not know", async () => {
    await seedUser(db, "u1");

    await expect(call(syncGitLabLink, { providerId: "gitlab-evil" }, asUser("u1"))).rejects.toThrow(
      /unknown gitlab instance/i,
    );
  });

  it("refuses an instance the deployment has no credentials for", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab-brackeys");

    await expect(
      call(syncGitLabLink, { providerId: "gitlab-brackeys" }, asUser("u1")),
    ).rejects.toThrow(/unknown gitlab instance/i);
  });

  it("refuses when better-auth has no account row for the instance", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab");

    await expect(
      call(syncGitLabLink, { providerId: "gitlab-booth" }, asUser("u1")),
    ).rejects.toThrow(/git\.booth\.dev account found/i);
  });

  it("fetches the instance's own API and stores one row under its provider id", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab-booth", "booth-token");
    const fetchMock = mockGitLabApi({
      id: 77,
      username: "yasahiro",
      name: "Yasahiro",
      avatar_url: "https://git.booth.dev/uploads/avatar.png",
      web_url: "https://git.booth.dev/yasahiro",
    });

    const result = await call(syncGitLabLink, { providerId: "gitlab-booth" }, asUser("u1"));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://git.booth.dev/api/v4/user");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer booth-token");

    expect(result.host).toBe("git.booth.dev");
    const rows = await storedLinks("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "gitlab-booth",
      providerUserId: "77",
      providerUsername: "yasahiro",
      providerProfileUrl: "https://git.booth.dev/yasahiro",
      scopes: "read_user",
    });
  });

  it("keeps a row per instance rather than overwriting the first", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab");
    await seedOAuthAccount("u1", "gitlab-booth");

    mockGitLabApi({
      id: 1,
      username: "yasa",
      name: null,
      avatar_url: null,
      web_url: "https://gitlab.com/yasa",
    });
    await call(syncGitLabLink, { providerId: "gitlab" }, asUser("u1"));
    mockGitLabApi({
      id: 77,
      username: "yasahiro",
      name: null,
      avatar_url: null,
      web_url: "https://git.booth.dev/yasahiro",
    });
    await call(syncGitLabLink, { providerId: "gitlab-booth" }, asUser("u1"));

    const rows = await storedLinks("u1");
    expect(rows.map((r) => r.provider).sort()).toEqual(["gitlab", "gitlab-booth"]);
  });

  it("re-links onto the same row rather than a second one", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab");

    mockGitLabApi({
      id: 1,
      username: "old",
      name: null,
      avatar_url: null,
      web_url: "https://gitlab.com/old",
    });
    await call(syncGitLabLink, { providerId: "gitlab" }, asUser("u1"));
    mockGitLabApi({
      id: 1,
      username: "renamed",
      name: null,
      avatar_url: null,
      web_url: "https://gitlab.com/renamed",
    });
    await call(syncGitLabLink, { providerId: "gitlab" }, asUser("u1"));

    const rows = await storedLinks("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].providerUsername).toBe("renamed");
  });

  it("reports a failed profile fetch rather than storing a half-link", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" })),
    );

    await expect(call(syncGitLabLink, { providerId: "gitlab" }, asUser("u1"))).rejects.toThrow(
      /failed to fetch/i,
    );
    expect(await storedLinks("u1")).toHaveLength(0);
  });
});

describe("unlinkGitLab", () => {
  it("removes the linked row and the better-auth account for that instance only", async () => {
    await seedUser(db, "u1");
    await seedOAuthAccount("u1", "gitlab");
    await seedOAuthAccount("u1", "gitlab-booth");
    mockGitLabApi({
      id: 1,
      username: "a",
      name: null,
      avatar_url: null,
      web_url: "https://gitlab.com/a",
    });
    await call(syncGitLabLink, { providerId: "gitlab" }, asUser("u1"));
    mockGitLabApi({
      id: 2,
      username: "b",
      name: null,
      avatar_url: null,
      web_url: "https://git.booth.dev/b",
    });
    await call(syncGitLabLink, { providerId: "gitlab-booth" }, asUser("u1"));

    await call(unlinkGitLab, { providerId: "gitlab" }, asUser("u1"));

    const rows = await storedLinks("u1");
    expect(rows.map((r) => r.provider)).toEqual(["gitlab-booth"]);
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, "u1"), eq(account.providerId, "gitlab")));
    expect(accounts).toHaveLength(0);
  });

  it("says so when nothing is linked", async () => {
    await seedUser(db, "u1");

    await expect(call(unlinkGitLab, { providerId: "gitlab" }, asUser("u1"))).rejects.toThrow(
      /no gitlab\.com account linked/i,
    );
  });
});
