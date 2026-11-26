import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The redaction-before-delete ordering is the load-bearing behavior here:
// `cleanupUserData` runs in better-auth's `beforeDelete` hook, and the
// comments UPDATE must land while `author_id` still points at the user —
// after the user row dies, the set-null FK makes the rows unfindable.
const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    selectQueue: [] as unknown[][],
    updateSet: vi.fn(),
    deleteError: null as Error | null,
    env: {} as Record<string, string | undefined>,
  };
});

vi.mock("@/env", () => ({
  env: new Proxy(
    {},
    { get: (_, key: string) => (key in mocks.env ? mocks.env[key] : process.env[key]) },
  ),
}));

vi.mock("@/db", () => {
  const nextSelect = () => mocks.selectQueue.shift() ?? [];
  return {
    db: {
      select: () => ({
        from: () => {
          const rows = nextSelect();
          return {
            where: () => ({
              // Some call sites await `.where(...)` directly, others chain
              // `.limit(1)` — resolve both shapes from the same queue entry.
              then: (resolve: (v: unknown[]) => void) => resolve(rows),
              limit: async () => rows,
            }),
          };
        },
      }),
      update: (table: { __name: string }) => ({
        set: (vals: unknown) => {
          mocks.updateSet(table.__name, vals);
          return {
            where: async () => {
              mocks.calls.push(`update:${table.__name}`);
            },
          };
        },
      }),
      delete: (table: { __name: string }) => ({
        where: async () => {
          mocks.calls.push(`delete:${table.__name}`);
          if (mocks.deleteError) throw mocks.deleteError;
        },
      }),
      transaction: async () => {
        mocks.calls.push("transaction");
      },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _: "and", args }),
  eq: (...args: unknown[]) => ({ _: "eq", args }),
  inArray: (...args: unknown[]) => ({ _: "inArray", args }),
  isNull: (...args: unknown[]) => ({ _: "isNull", args }),
  sql: (strings: TemplateStringsArray, ...args: unknown[]) => ({ _: "sql", strings, args }),
}));

vi.mock("@/db/schema", () => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries([["__name", name], ...columns.map((c) => [c, `${name}.${c}`])]);
  return {
    account: table("account", ["accountId", "userId", "providerId"]),
    canvases: table("canvases", ["id", "ownerId", "teamId"]),
    canvasDocVersions: table("doc_versions", ["docKind", "docId"]),
    canvasMembers: table("canvas_members", ["canvasId", "userId"]),
    comments: table("comments", ["authorId", "content", "deletedAt"]),
    developerProfiles: table("developer_profiles", ["id", "discordId"]),
    linkedAccounts: table("linked_accounts", ["profileId"]),
    profileProjects: table("profile_projects", ["profileId", "imageKey"]),
    profileUrlStubs: table("profile_url_stubs", ["profileId"]),
    skillRequests: table("skill_requests", ["userId"]),
    userSkills: table("user_skills", ["userId"]),
  };
});

vi.mock("@/lib/discord", () => ({
  purgeGuildMemberCache: vi.fn(async () => undefined),
}));

vi.mock("@/lib/profile-project-image-storage", () => ({
  removeProfileProjectImageFromStorage: vi.fn(async () => undefined),
}));

import { cleanupUserData } from "../account-deletion";

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.selectQueue.length = 0;
  mocks.updateSet.mockClear();
  mocks.deleteError = null;
  mocks.env = { MMO_WORLD_URL: undefined, MMO_FORGET_TOKEN: undefined };
});

describe("cleanupUserData comment redaction", () => {
  it("redacts the user's comments before deleting the profile row", async () => {
    mocks.selectQueue.push([{ discordId: null }], []);
    await cleanupUserData("u1");

    const updateIdx = mocks.calls.indexOf("update:comments");
    const deleteIdx = mocks.calls.indexOf("delete:developer_profiles");
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeLessThan(deleteIdx);
  });

  it("blanks content and tombstones via COALESCE so earlier deletes keep their stamps", async () => {
    mocks.selectQueue.push([{ discordId: null }], []);
    await cleanupUserData("u1");

    expect(mocks.updateSet).toHaveBeenCalledWith(
      "comments",
      expect.objectContaining({
        content: "",
        deletedAt: expect.objectContaining({ _: "sql" }),
      }),
    );
  });

  it("deletes personal canvases and their versions before the profile row", async () => {
    mocks.selectQueue.push([{ discordId: null }], [], [{ id: "c1", deletedAt: null }]);
    await cleanupUserData("u1");

    const versionsIdx = mocks.calls.indexOf("delete:doc_versions");
    const canvasIdx = mocks.calls.indexOf("delete:canvases");
    expect(versionsIdx).toBeGreaterThanOrEqual(0);
    expect(versionsIdx).toBeLessThan(canvasIdx);
    expect(canvasIdx).toBeLessThan(mocks.calls.indexOf("delete:developer_profiles"));
  });

  it("does nothing when the user has no profile row", async () => {
    mocks.selectQueue.push([]);
    await cleanupUserData("ghost");
    expect(mocks.calls).toEqual([]);
  });
});

describe("cleanupUserData and the game world", () => {
  let posts: { url: string; body: unknown; auth: string | null }[] = [];
  let status = 200;

  beforeEach(() => {
    posts = [];
    status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        posts.push({
          url: String(input),
          body: JSON.parse(init.body as string),
          auth: new Headers(init.headers).get("authorization"),
        });
        return Response.json(
          status === 200 ? { forgotten: true, swept: true } : { code: "unavailable" },
          { status },
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const enable = () => {
    mocks.env = { MMO_WORLD_URL: "http://world.test", MMO_FORGET_TOKEN: "forget-token" };
  };

  it("asks the world once to forget the Discord account, then cleans up", async () => {
    enable();
    mocks.selectQueue.push([{ accountId: "123456789012345678" }], [{ discordId: null }], []);
    await cleanupUserData("u1");

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("http://world.test/v1/forget");
    expect(posts[0].auth).toBe("Bearer forget-token");
    expect(posts[0].body).toEqual({
      discordId: "123456789012345678",
      interactionId: expect.stringMatching(/^site-forget-[0-9a-f]{16}$/),
    });
    expect(mocks.calls).toContain("delete:developer_profiles");
  });

  it("forgets the game data even when the user has no developer profile", async () => {
    enable();
    mocks.selectQueue.push([{ accountId: "123456789012345678" }], []);
    await cleanupUserData("u1");

    expect(posts).toHaveLength(1);
    expect(mocks.calls).toEqual([]);
  });

  it("never calls the world when the site holds no forget token", async () => {
    mocks.env = { MMO_WORLD_URL: "http://world.test", MMO_FORGET_TOKEN: undefined };
    mocks.selectQueue.push([{ discordId: null }], []);
    await cleanupUserData("u1");

    expect(posts).toEqual([]);
    expect(mocks.calls).toContain("delete:developer_profiles");
  });

  it("skips the world for a user with no Discord account", async () => {
    enable();
    mocks.selectQueue.push([], [{ discordId: null }], []);
    await cleanupUserData("u1");

    expect(posts).toEqual([]);
    expect(mocks.calls).toContain("delete:developer_profiles");
  });

  it("throws before deleting anything when the world fails", async () => {
    enable();
    status = 503;
    mocks.selectQueue.push([{ accountId: "123456789012345678" }], [{ discordId: null }], []);

    await expect(cleanupUserData("u1")).rejects.toThrow(/503/);
    expect(mocks.calls).toEqual([]);
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});
