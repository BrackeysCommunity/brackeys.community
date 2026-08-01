import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// vi.mock is hoisted above imports, so any references inside the factory must
// come from vi.hoisted (which runs before mocks) — not from top-level lets.
const mocks = vi.hoisted(() => ({
  // Account lookup: db.select().from().where().limit(1)
  accountLimit: vi.fn(async () => [] as unknown[]),
  // Entry matches: db.select().from().innerJoin().where() awaited directly
  matchesWhere: vi.fn(async (_cond: unknown) => [] as unknown[]),
  // Awaited-where queries, in call order: overall results, then existing rows
  plainWhere: vi.fn(async () => [] as unknown[]),
  insertOnConflict: vi.fn(async (_rows: unknown) => undefined),
  updateWhere: vi.fn(async (_patch: unknown) => undefined),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.accountLimit,
          // Awaiting where() directly resolves overall-results / existing-rows.
          then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            mocks.plainWhere().then(onFulfilled, onRejected),
        }),
        innerJoin: () => ({
          where: mocks.matchesWhere,
        }),
      }),
    }),
    insert: () => ({
      values: (rows: unknown) => ({
        onConflictDoNothing: () => mocks.insertOnConflict(rows),
      }),
    }),
    update: () => ({
      set: (patch: unknown) => ({
        where: () => mocks.updateWhere(patch),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _: "and", args }),
  eq: (...args: unknown[]) => ({ _: "eq", args }),
  or: (...args: unknown[]) => ({ _: "or", args }),
  inArray: (...args: unknown[]) => ({ _: "inArray", args }),
  isNull: (...args: unknown[]) => ({ _: "isNull", args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ _: "sql", strings, values }),
}));

vi.mock("@/db/schema", () => ({
  linkedAccounts: { profileId: "profileId", provider: "provider" },
  profileProjects: {
    id: "id",
    profileId: "profileId",
    source: "source",
    sourceId: "sourceId",
    result: "result",
    teamMembers: "teamMembers",
    imageUrl: "imageUrl",
    imageKey: "imageKey",
  },
  itchJams: { jamId: "jamId", title: "title", slug: "slug", entriesCount: "entriesCount" },
  itchJamEntries: {
    entryId: "entryId",
    jamId: "jamId",
    authorId: "authorId",
    contributors: "contributors",
  },
  itchJamEntryResults: { entryId: "entryId", rank: "rank", criterion: "criterion" },
}));

import {
  composeOverallResult,
  normalizeItchProfileUrl,
  syncItchIoJamParticipations,
} from "../itchio-jam-sync";

function account(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    providerUserId: "42",
    providerProfileUrl: "https://dev.itch.io",
    ...overrides,
  };
}

function match(
  overrides: Partial<Record<string, unknown>> & { entryId: number },
  jamEntriesCount: number | null = 200,
) {
  return {
    entry: {
      jamId: 9000,
      gameTitle: `Entry ${overrides.entryId}`,
      gameShortText: "a jam game",
      gameUrl: `https://dev.itch.io/entry-${overrides.entryId}`,
      gameCoverUrl: `https://img.itch.zone/${overrides.entryId}.png`,
      rateUrl: `https://itch.io/jam/some-jam/rate/${overrides.entryId}`,
      submittedAt: new Date("2026-02-10T00:00:00Z"),
      contributors: [],
      ...overrides,
    },
    jamEntriesCount,
  };
}

beforeEach(() => {
  mocks.accountLimit.mockClear();
  mocks.matchesWhere.mockClear();
  mocks.plainWhere.mockClear();
  mocks.insertOnConflict.mockClear();
  mocks.updateWhere.mockClear();
  mocks.accountLimit.mockResolvedValue([account()]);
  mocks.matchesWhere.mockResolvedValue([]);
  mocks.plainWhere.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeItchProfileUrl()", () => {
  it("lowercases and strips trailing slashes", () => {
    expect(normalizeItchProfileUrl("https://Dev.itch.io/")).toBe("https://dev.itch.io");
    expect(normalizeItchProfileUrl("https://dev.itch.io//")).toBe("https://dev.itch.io");
  });

  it("returns null for null or empty input", () => {
    expect(normalizeItchProfileUrl(null)).toBeNull();
    expect(normalizeItchProfileUrl("  ")).toBeNull();
    expect(normalizeItchProfileUrl("/")).toBeNull();
  });
});

describe("composeOverallResult()", () => {
  it("includes the jam's entry count when known", () => {
    expect(composeOverallResult(12, 312)).toBe("Overall: #12 of 312");
  });

  it("omits the entry count when missing or zero", () => {
    expect(composeOverallResult(12, null)).toBe("Overall: #12");
    expect(composeOverallResult(12, 0)).toBe("Overall: #12");
  });
});

describe("syncItchIoJamParticipations()", () => {
  it("returns null when no itch.io account is linked", async () => {
    mocks.accountLimit.mockResolvedValue([]);
    await expect(syncItchIoJamParticipations("u1")).resolves.toBeNull();
    expect(mocks.matchesWhere).not.toHaveBeenCalled();
  });

  it("returns zeros without querying entries when no usable identity exists", async () => {
    mocks.accountLimit.mockResolvedValue([
      account({ providerUserId: "not-a-number", providerProfileUrl: null }),
    ]);
    await expect(syncItchIoJamParticipations("u1")).resolves.toEqual({ imported: 0, total: 0 });
    expect(mocks.matchesWhere).not.toHaveBeenCalled();
  });

  it("returns zeros when no entries match", async () => {
    await expect(syncItchIoJamParticipations("u1")).resolves.toEqual({ imported: 0, total: 0 });
    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
  });

  it("imports unseen entries as itchio-jam rows", async () => {
    mocks.matchesWhere.mockResolvedValue([
      match({ entryId: 1, contributors: [{ name: "dev", url: "https://dev.itch.io" }] }),
    ]);
    // overall results: none yet; existing rows: none
    mocks.plainWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(syncItchIoJamParticipations("u1")).resolves.toEqual({ imported: 1, total: 1 });

    expect(mocks.insertOnConflict).toHaveBeenCalledTimes(1);
    expect(mocks.insertOnConflict).toHaveBeenCalledWith([
      expect.objectContaining({
        profileId: "u1",
        type: "jam",
        source: "itchio-jam",
        sourceId: "1",
        jamId: 9000,
        published: true,
        submissionTitle: "Entry 1",
        submissionUrl: "https://itch.io/jam/some-jam/rate/1",
        result: null,
        teamMembers: ["dev"],
      }),
    ]);
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });

  it("composes result from the Overall rank and jam entry count", async () => {
    mocks.matchesWhere.mockResolvedValue([match({ entryId: 1 }, 312)]);
    mocks.plainWhere.mockResolvedValueOnce([{ entryId: 1, rank: 12 }]).mockResolvedValueOnce([]);

    await syncItchIoJamParticipations("u1");

    expect(mocks.insertOnConflict).toHaveBeenCalledWith([
      expect.objectContaining({ result: "Overall: #12 of 312" }),
    ]);
  });

  it("backfills result on re-sync once the Overall rank lands", async () => {
    mocks.matchesWhere.mockResolvedValue([match({ entryId: 1 }, 312)]);
    mocks.plainWhere.mockResolvedValueOnce([{ entryId: 1, rank: 3 }]).mockResolvedValueOnce([
      {
        id: "row1",
        sourceId: "1",
        result: null,
        teamMembers: null,
        imageUrl: "https://img.itch.zone/1.png",
        imageKey: null,
      },
    ]);

    await expect(syncItchIoJamParticipations("u1")).resolves.toEqual({ imported: 0, total: 1 });

    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.updateWhere).toHaveBeenCalledWith({ result: "Overall: #3 of 312" });
  });

  it("keeps the team roster in step", async () => {
    mocks.matchesWhere.mockResolvedValue([
      match({
        entryId: 1,
        contributors: [
          { name: "dev", url: "https://dev.itch.io" },
          { name: "friend", url: "https://friend.itch.io" },
        ],
      }),
    ]);
    mocks.plainWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "row1",
        sourceId: "1",
        result: null,
        teamMembers: ["dev"],
        imageUrl: "https://img.itch.zone/1.png",
        imageKey: null,
      },
    ]);

    await syncItchIoJamParticipations("u1");

    expect(mocks.updateWhere).toHaveBeenCalledWith({ teamMembers: ["dev", "friend"] });
  });

  it("refreshes the cover but never overwrites an owner-uploaded image", async () => {
    mocks.matchesWhere.mockResolvedValue([match({ entryId: 1 }), match({ entryId: 2 })]);
    mocks.plainWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "row1",
        sourceId: "1",
        result: null,
        teamMembers: null,
        imageUrl: "https://img.itch.zone/old.png",
        imageKey: null,
      },
      {
        id: "row2",
        sourceId: "2",
        result: null,
        teamMembers: null,
        imageUrl: "https://img.itch.zone/old.png",
        imageKey: "profile-project-images/u1/custom.png",
      },
    ]);

    await syncItchIoJamParticipations("u1");

    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.updateWhere).toHaveBeenCalledWith({
      imageUrl: "https://img.itch.zone/1.png",
    });
  });

  it("no-ops on re-sync when nothing changed", async () => {
    mocks.matchesWhere.mockResolvedValue([match({ entryId: 1 }, 312)]);
    mocks.plainWhere.mockResolvedValueOnce([{ entryId: 1, rank: 12 }]).mockResolvedValueOnce([
      {
        id: "row1",
        sourceId: "1",
        result: "Overall: #12 of 312",
        teamMembers: null,
        imageUrl: "https://img.itch.zone/1.png",
        imageKey: null,
      },
    ]);

    await expect(syncItchIoJamParticipations("u1")).resolves.toEqual({ imported: 0, total: 1 });

    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });
});
