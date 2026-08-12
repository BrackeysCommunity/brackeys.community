import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  };
});

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
  eq: (...args: unknown[]) => ({ _: "eq", args }),
  sql: (strings: TemplateStringsArray, ...args: unknown[]) => ({ _: "sql", strings, args }),
}));

vi.mock("@/db/schema", () => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries([["__name", name], ...columns.map((c) => [c, `${name}.${c}`])]);
  return {
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

  it("does nothing when the user has no profile row", async () => {
    mocks.selectQueue.push([]);
    await cleanupUserData("ghost");
    expect(mocks.calls).toEqual([]);
  });
});
