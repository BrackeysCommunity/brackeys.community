import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// vi.mock is hoisted above imports, so any references inside the factory must
// come from vi.hoisted (which runs before mocks) — not from top-level lets.
const mocks = vi.hoisted(() => ({
  // Account lookup: db.select().from().where().limit(1)
  accountLimit: vi.fn(async () => [] as { accessToken: string | null }[]),
  // Existing projects: db.select().from().where() awaited directly
  existingWhere: vi.fn(
    async () =>
      [] as {
        id: string;
        sourceId: string | null;
        published: boolean;
        url?: string | null;
        imageUrl?: string | null;
        imageKey?: string | null;
        missingSince?: Date | null;
      }[],
  ),
  insertOnConflict: vi.fn(async (_rows: unknown) => undefined),
  updateWhere: vi.fn(async (_patch: unknown) => undefined),
  fetchGames: vi.fn(async () => [] as unknown[]),
  convergeLibrary: vi.fn(async (_userId: string, _games: unknown[]) => ({ linked: 0, filled: 0 })),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.accountLimit,
          // Awaiting where() directly resolves the existing-projects query.
          then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            mocks.existingWhere().then(onFulfilled, onRejected),
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
  inArray: (...args: unknown[]) => ({ _: "inArray", args }),
  isNull: (...args: unknown[]) => ({ _: "isNull", args }),
}));

vi.mock("@/db/schema", () => ({
  linkedAccounts: {
    id: "id",
    profileId: "profileId",
    provider: "provider",
    tokenInvalidAt: "tokenInvalidAt",
    lastSyncedAt: "lastSyncedAt",
  },
  profileProjects: {
    id: "id",
    profileId: "profileId",
    source: "source",
    sourceId: "sourceId",
    published: "published",
    publishedAt: "publishedAt",
    url: "url",
    imageUrl: "imageUrl",
    imageKey: "imageKey",
  },
}));

// Keep the real exports (ItchApiError is instanceof-checked by the sync)
// and only stub the network call.
vi.mock("@/lib/itchio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/itchio")>()),
  fetchGames: mocks.fetchGames,
}));

// Canonical-project convergence has its own suite; here it only has to be
// *called*, with the provider payload this run fetched.
vi.mock("@/lib/projects", () => ({
  convergeLibraryPlacements: mocks.convergeLibrary,
}));

import { ItchApiError } from "@/lib/itchio";

import { ItchIoSyncFetchError, syncItchIoLibrary } from "../itchio-sync";

// Patches sent to db.update().set(), excluding the token-health stamp the
// sync writes on every successful fetch — most tests only care about the
// project-row updates.
const projectPatches = () =>
  mocks.updateWhere.mock.calls
    .map(([patch]) => patch as Record<string, unknown>)
    .filter((p) => !("lastSyncedAt" in p) && !("tokenInvalidAt" in p));

function game(overrides: Partial<Record<string, unknown>> & { id: number; published: boolean }) {
  return {
    title: `Game ${overrides.id}`,
    short_text: "a game",
    url: `https://dev.itch.io/game-${overrides.id}`,
    cover_url: `https://img.itch.zone/${overrides.id}.png`,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.accountLimit.mockClear();
  mocks.existingWhere.mockClear();
  mocks.insertOnConflict.mockClear();
  mocks.updateWhere.mockClear();
  mocks.fetchGames.mockClear();
  mocks.convergeLibrary.mockClear();
  mocks.accountLimit.mockResolvedValue([{ accessToken: "tok" }]);
  mocks.existingWhere.mockResolvedValue([]);
  mocks.fetchGames.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncItchIoLibrary()", () => {
  it("returns null when no itch.io account is linked", async () => {
    mocks.accountLimit.mockResolvedValue([]);
    await expect(syncItchIoLibrary("u1")).resolves.toBeNull();
    expect(mocks.fetchGames).not.toHaveBeenCalled();
  });

  it("returns null when the linked account has no access token", async () => {
    mocks.accountLimit.mockResolvedValue([{ accessToken: null }]);
    await expect(syncItchIoLibrary("u1")).resolves.toBeNull();
    expect(mocks.fetchGames).not.toHaveBeenCalled();
  });

  it("returns zeros without touching projects when the library is empty", async () => {
    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 0, drafts: 0 });
    expect(mocks.existingWhere).not.toHaveBeenCalled();
    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
  });

  it("imports unseen games with their published state", async () => {
    mocks.fetchGames.mockResolvedValue([
      game({ id: 1, published: true }),
      game({ id: 2, published: false }),
    ]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 2, total: 2, drafts: 1 });

    expect(mocks.insertOnConflict).toHaveBeenCalledTimes(1);
    expect(mocks.insertOnConflict).toHaveBeenCalledWith([
      expect.objectContaining({ sourceId: "1", published: true, source: "itchio" }),
      expect.objectContaining({ sourceId: "2", published: false, source: "itchio" }),
    ]);
    expect(projectPatches()).toEqual([]);
  });

  it("flips published when itch.io visibility changed", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: "https://img.itch.zone/1.png",
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: false })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1, drafts: 1 });

    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
    expect(projectPatches()).toEqual([{ published: false }]);
  });

  it("no-ops when nothing changed", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: "https://img.itch.zone/1.png",
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1, drafts: 0 });

    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
    expect(projectPatches()).toEqual([]);
  });

  it("refreshes the stored cover when itch.io's cover_url changed", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: "https://img.itch.zone/old.png",
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1, drafts: 0 });

    expect(projectPatches()).toEqual([
      { published: true, imageUrl: "https://img.itch.zone/1.png" },
    ]);
  });

  it("refreshes a stale URL after a provider-side rename", async () => {
    // The restricted probe HEADs the stored URL; leaving the old-username
    // URL in place would 404 and wrongly stamp the game restricted.
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://old-name.itch.io/game-1",
        imageUrl: "https://img.itch.zone/1.png",
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1, drafts: 0 });

    expect(projectPatches()).toEqual([{ published: true, url: "https://dev.itch.io/game-1" }]);
  });

  it("backfills a missing cover on re-sync", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: null,
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1, drafts: 0 });

    expect(mocks.updateWhere).toHaveBeenCalledWith({
      published: true,
      imageUrl: "https://img.itch.zone/1.png",
    });
  });

  it("never overwrites an owner-uploaded image (imageKey set)", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: null,
        imageKey: "profile-project-images/u1/custom.png",
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1, drafts: 0 });

    expect(projectPatches()).toEqual([]);
  });

  it("wraps itch.io fetch failures in ItchIoSyncFetchError", async () => {
    mocks.fetchGames.mockRejectedValue(new Error("boom"));
    await expect(syncItchIoLibrary("u1")).rejects.toBeInstanceOf(ItchIoSyncFetchError);
  });

  it("converges every placement onto a canonical project, with the provider payload", async () => {
    const games = [game({ id: 1, published: true })];
    mocks.fetchGames.mockResolvedValue(games);

    await syncItchIoLibrary("u1");

    expect(mocks.convergeLibrary).toHaveBeenCalledWith("u1", games);
  });

  it("converges even when the library came back empty", async () => {
    // A row imported before the canonical entity existed has a null
    // project_id, and no other code path will ever fix it — so an account
    // whose library is now empty still has to be swept.
    await syncItchIoLibrary("u1");

    expect(mocks.convergeLibrary).toHaveBeenCalledWith("u1", []);
  });
});

describe("token health stamping", () => {
  const stampPatches = () =>
    mocks.updateWhere.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .filter((p) => "lastSyncedAt" in p || "tokenInvalidAt" in p);

  it("clears tokenInvalidAt and moves lastSyncedAt on a successful fetch", async () => {
    await syncItchIoLibrary("u1");

    expect(stampPatches()).toEqual([{ tokenInvalidAt: null, lastSyncedAt: expect.any(Date) }]);
  });

  it("stamps tokenInvalidAt on a 401 and rethrows with the status", async () => {
    mocks.fetchGames.mockRejectedValue(new ItchApiError(401, "unauthorized"));

    const err = await syncItchIoLibrary("u1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ItchIoSyncFetchError);
    expect((err as ItchIoSyncFetchError).status).toBe(401);
    expect(stampPatches()).toEqual([{ tokenInvalidAt: expect.any(Date) }]);
  });

  it("does not stamp tokenInvalidAt on a 500", async () => {
    mocks.fetchGames.mockRejectedValue(new ItchApiError(500, "oops"));

    await expect(syncItchIoLibrary("u1")).rejects.toBeInstanceOf(ItchIoSyncFetchError);
    expect(stampPatches()).toEqual([]);
  });

  it("does not stamp tokenInvalidAt on a network failure", async () => {
    mocks.fetchGames.mockRejectedValue(new TypeError("fetch failed"));

    await expect(syncItchIoLibrary("u1")).rejects.toBeInstanceOf(ItchIoSyncFetchError);
    expect(stampPatches()).toEqual([]);
  });
});

describe("missing reconciliation", () => {
  const missingPatches = () =>
    mocks.updateWhere.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .filter((p) => "missingSince" in p);

  it("stamps rows that vanished from the library response", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row-gone",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: null,
        missingSince: null,
      },
      {
        id: "row-here",
        sourceId: "2",
        published: true,
        url: "https://dev.itch.io/game-2",
        imageUrl: "https://img.itch.zone/2.png",
        missingSince: null,
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 2, published: true })]);

    await syncItchIoLibrary("u1");

    expect(missingPatches()).toEqual([{ missingSince: expect.any(Date) }]);
  });

  it("preserves the first-missing time on later syncs", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row-gone",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: null,
        missingSince: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        id: "row-here",
        sourceId: "2",
        published: true,
        url: "https://dev.itch.io/game-2",
        imageUrl: "https://img.itch.zone/2.png",
        missingSince: null,
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 2, published: true })]);

    await syncItchIoLibrary("u1");

    expect(missingPatches()).toEqual([]);
  });

  it("clears the stamp when the game reappears", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row-back",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: "https://img.itch.zone/1.png",
        missingSince: new Date("2026-08-01T00:00:00.000Z"),
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await syncItchIoLibrary("u1");

    expect(missingPatches()).toEqual([{ missingSince: null }]);
  });

  it("never stamps off an empty response (API hiccup guard)", async () => {
    mocks.existingWhere.mockResolvedValue([
      {
        id: "row1",
        sourceId: "1",
        published: true,
        url: "https://dev.itch.io/game-1",
        imageUrl: null,
        missingSince: null,
      },
    ]);
    mocks.fetchGames.mockResolvedValue([]);

    await syncItchIoLibrary("u1");

    expect(missingPatches()).toEqual([]);
  });
});
