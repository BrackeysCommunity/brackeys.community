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
        imageUrl?: string | null;
        imageKey?: string | null;
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
}));

vi.mock("@/db/schema", () => ({
  linkedAccounts: { profileId: "profileId", provider: "provider" },
  profileProjects: {
    id: "id",
    profileId: "profileId",
    source: "source",
    sourceId: "sourceId",
    published: "published",
    publishedAt: "publishedAt",
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

// Only the throttled path calls the jam sync; stub it so this suite's db
// mock doesn't have to satisfy the jam module's imports.
vi.mock("@/lib/itchio-jam-sync", () => ({
  syncItchIoJamParticipations: vi.fn(async () => null),
}));

// Canonical-project convergence has its own suite; here it only has to be
// *called*, with the provider payload this run fetched.
vi.mock("@/lib/projects", () => ({
  convergeLibraryPlacements: mocks.convergeLibrary,
}));

import { ItchIoSyncFetchError, syncItchIoLibrary } from "../itchio-sync";

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
    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 0 });
    expect(mocks.existingWhere).not.toHaveBeenCalled();
    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
  });

  it("imports unseen games with their published state", async () => {
    mocks.fetchGames.mockResolvedValue([
      game({ id: 1, published: true }),
      game({ id: 2, published: false }),
    ]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 2, total: 2 });

    expect(mocks.insertOnConflict).toHaveBeenCalledTimes(1);
    expect(mocks.insertOnConflict).toHaveBeenCalledWith([
      expect.objectContaining({ sourceId: "1", published: true, source: "itchio" }),
      expect.objectContaining({ sourceId: "2", published: false, source: "itchio" }),
    ]);
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });

  it("flips published when itch.io visibility changed", async () => {
    mocks.existingWhere.mockResolvedValue([
      { id: "row1", sourceId: "1", published: true, imageUrl: "https://img.itch.zone/1.png" },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: false })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1 });

    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.updateWhere).toHaveBeenCalledWith({ published: false });
  });

  it("no-ops when nothing changed", async () => {
    mocks.existingWhere.mockResolvedValue([
      { id: "row1", sourceId: "1", published: true, imageUrl: "https://img.itch.zone/1.png" },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1 });

    expect(mocks.insertOnConflict).not.toHaveBeenCalled();
    expect(mocks.updateWhere).not.toHaveBeenCalled();
  });

  it("refreshes the stored cover when itch.io's cover_url changed", async () => {
    mocks.existingWhere.mockResolvedValue([
      { id: "row1", sourceId: "1", published: true, imageUrl: "https://img.itch.zone/old.png" },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1 });

    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.updateWhere).toHaveBeenCalledWith({
      published: true,
      imageUrl: "https://img.itch.zone/1.png",
    });
  });

  it("backfills a missing cover on re-sync", async () => {
    mocks.existingWhere.mockResolvedValue([
      { id: "row1", sourceId: "1", published: true, imageUrl: null },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1 });

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
        imageUrl: null,
        imageKey: "profile-project-images/u1/custom.png",
      },
    ]);
    mocks.fetchGames.mockResolvedValue([game({ id: 1, published: true })]);

    await expect(syncItchIoLibrary("u1")).resolves.toEqual({ imported: 0, total: 1 });

    expect(mocks.updateWhere).not.toHaveBeenCalled();
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
