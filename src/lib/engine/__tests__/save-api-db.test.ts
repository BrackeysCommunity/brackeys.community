import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineReleaseChannels, engineReleases, engineSaves } from "@/db/schema";
import { SITE } from "@/lib/legal-meta";
import { seedUser, type TestDb } from "@/test/db";

import { SITE_SAVE_ACCOUNT_BYTES, SITE_SAVE_LIMITS } from "../limits";
import { SIGNED_IN_SAVES_DESCRIBE } from "../local-saves";
import type { Viewer } from "../release-access";
import { ReleaseError } from "../release-errors";
import { memoryReleaseStore } from "../release-storage";
import type { ReleaseTxDb } from "../release-upload";
import {
  listAccountSaves,
  listSaves,
  putSave,
  readSave,
  removeSave,
  SAVE_READ_BUCKET,
  saveAccess,
  type SaveApiDeps,
} from "../save-api";
import { engineSaveKey } from "../storage-keys";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const GAME_A = "save-game-a";
const GAME_B = "save-game-b";
const OWN = "save-game-own";
const UNRELEASED = "save-game-unreleased";
const T0 = new Date("2026-11-12T15:00:00Z");

const viewer = (userId: string | null): Viewer => ({
  userId,
  staff: false,
  teamRole: null,
  isCreator: false,
});

let seq = 0;
const hex = (n: number) => n.toString(16).padStart(64, "0");

/** A fixed-window counter in memory, the limiter's contract. */
function memoryLimiter() {
  const counts = new Map<string, number>();
  const calls: { bucket: string; key: string; limit: number; window: number }[] = [];
  return {
    calls,
    rateLimit: async (bucket: string, key: string, limit: number, window: number) => {
      calls.push({ bucket, key, limit, window });
      const id = `${bucket}\u0000${key}`;
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      return count <= limit;
    },
  };
}

let store = memoryReleaseStore();
let limiter = memoryLimiter();
let clock = T0;

const deps = (): SaveApiDeps => ({
  db: db as unknown as ReleaseTxDb,
  store,
  rateLimit: limiter.rateLimit,
  now: () => clock,
});

async function seedProject(
  projectId: string,
  opts: { gameId?: string; saveMode?: string; production?: boolean } = {},
) {
  await db.insert(engineProjects).values({
    projectId,
    name: `Title of ${projectId}`,
    game: opts.gameId ?? projectId,
    createdById: "creator",
    visibility: "public",
    publicApprovedAt: T0,
    saveMode: opts.saveMode ?? "site",
  });
  if (opts.production === false) return;
  const id = hex(++seq);
  await db.insert(engineReleases).values({
    id,
    projectId,
    version: 1,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 2,
    fileCount: 1,
    engineVersion: "0.14.1",
    gameId: opts.gameId ?? projectId,
    snapshot: hex(1000 + seq),
    buildHash: hex(2000 + seq),
    target: "web",
    createdById: "creator",
    firstPromotedAt: T0,
  });
  await db
    .insert(engineReleaseChannels)
    .values({ projectId, channel: "production", releaseId: id });
}

function saveText(
  slot: string,
  opts: { game?: string; data?: unknown; title?: string; release?: string | null } = {},
): string {
  const file: SaveFile = {
    kind: "save",
    v: 1,
    game: opts.game ?? GAME_A,
    gameVersion: 3,
    engine: "0.14.1",
    release: (opts.release === undefined ? hex(77) : opts.release) as SaveFile["release"],
    project: null,
    slot,
    meta: {
      scene: "one",
      savedAt: 0,
      playTicks: 9,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
    },
    depth: "progress",
    persist: null,
    scene: { id: "one", runHash: "", sublevels: [] },
    data: (opts.data ?? null) as SaveFile["data"],
  };
  return formatSaveFile(file);
}

const utf8 = (text: string) => new TextEncoder().encode(text).length;

/** A save of exactly `bytes` UTF-8 bytes. */
function saveOfBytes(slot: string, bytes: number, game = GAME_A): string {
  const base = saveText(slot, { game, data: "" });
  return saveText(slot, { game, data: "x".repeat(bytes - utf8(base)) });
}

async function refusal(run: Promise<unknown>): Promise<ReleaseError> {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReleaseError);
  return error as ReleaseError;
}

const put = (userId: string | null, projectId: string, slot: string, text: string) =>
  putSave(deps(), { viewer: viewer(userId), projectId, slot, text });

const rowOf = async (userId: string, projectId: string, slot: string) => {
  const [row] = await db
    .select()
    .from(engineSaves)
    .where(
      and(
        eq(engineSaves.userId, userId),
        eq(engineSaves.projectId, projectId),
        eq(engineSaves.slot, slot),
      ),
    );
  return row;
};

let player = "";

beforeAll(async () => {
  await seedUser(db, "creator");
  await seedProject(GAME_A);
  await seedProject(GAME_B);
  await seedProject(OWN, { saveMode: "own" });
  await seedProject(UNRELEASED, { production: false });
});

beforeEach(async () => {
  store = memoryReleaseStore();
  limiter = memoryLimiter();
  clock = T0;
  player = `player-${++seq}`;
  await seedUser(db, player);
});

describe("putSave", () => {
  it("refuses a signed-out player with 401 save-forbidden", async () => {
    const error = await refusal(put(null, GAME_A, "one", saveText("one")));
    expect(error.status).toBe(401);
    expect(error.body).toEqual({
      code: "save-forbidden",
      message: `Sign in to save to your ${SITE.name} account.`,
    });
  });

  it("stores the bytes in the object and the row holds none", async () => {
    const text = saveText("one", { data: { secret: "only-in-the-object" }, title: "Chapter 2" });
    await expect(put(player, GAME_A, "one", text)).resolves.toEqual({ bytes: utf8(text) });

    const object = store.objects.get(engineSaveKey(player, GAME_A, "one"));
    expect(object?.contentType).toBe("application/json");
    expect(new TextDecoder().decode(object!.bytes)).toBe(text);

    const row = await rowOf(player, GAME_A, "one");
    expect(row).toEqual({
      userId: player,
      projectId: GAME_A,
      slot: "one",
      bytes: utf8(text),
      gameVersion: 3,
      releaseId: hex(77),
      meta: { scene: "one", savedAt: 0, playTicks: 9, title: "Chapter 2" },
      writtenAt: T0,
      usedAt: T0,
    });
    expect(JSON.stringify(row)).not.toContain("only-in-the-object");
  });

  it("accepts 32,768 bytes and refuses 32,769 with 413 save-too-large", async () => {
    const max = SITE_SAVE_LIMITS.maxBytes;
    await expect(put(player, GAME_A, "one", saveOfBytes("one", max))).resolves.toEqual({
      bytes: max,
    });
    const error = await refusal(put(player, GAME_A, "two", saveOfBytes("two", max + 1)));
    expect(error.status).toBe(413);
    expect(error.body).toMatchObject({
      code: "save-too-large",
      message: `This save is 33 KB; saves on ${SITE.name} are limited to 32 KB.`,
      used: max + 1,
      max,
    });
    expect(error.body.limit).toBeUndefined();
    expect(await rowOf(player, GAME_A, "two")).toBeUndefined();
  });

  it("refuses a fifth slot with 409 and accepts an overwrite of a held one", async () => {
    for (const slot of ["a", "b", "c", "d"]) await put(player, GAME_A, slot, saveText(slot));
    const error = await refusal(put(player, GAME_A, "e", saveText("e")));
    expect(error.status).toBe(409);
    expect(error.body).toMatchObject({
      code: "save-slot-limit",
      message: `You have 4 saves for this game, the most ${SITE.name} keeps. Delete one to save again.`,
      used: 4,
      max: 4,
    });
    await expect(put(player, GAME_A, "c", saveText("c", { title: "Again" }))).resolves.toBeTruthy();
    expect((await rowOf(player, GAME_A, "c"))?.meta.title).toBe("Again");
  });

  it("refuses a write past the 1 MiB account total across two games", async () => {
    const heldElsewhere = SITE_SAVE_ACCOUNT_BYTES - 20_000;
    await db.insert(engineSaves).values({
      userId: player,
      projectId: GAME_B,
      slot: "big",
      bytes: heldElsewhere,
      gameVersion: 1,
      releaseId: null,
      meta: { scene: "one", savedAt: 0, playTicks: 0 },
    });

    const error = await refusal(put(player, GAME_A, "one", saveOfBytes("one", 30_000)));
    expect(error.status).toBe(413);
    expect(error.body).toEqual({
      code: "save-too-large",
      message: `Your saves on ${SITE.name} have reached 1 MB across all games.`,
      hint: "Delete saves from games you no longer play in Settings → Game saves.",
      limit: "account-total",
      used: heldElsewhere,
      max: SITE_SAVE_ACCOUNT_BYTES,
    });
    expect(store.objects.size).toBe(0);

    await expect(put(player, GAME_A, "one", saveOfBytes("one", 20_000))).resolves.toEqual({
      bytes: 20_000,
    });
    // An overwrite counts only its own new size.
    await expect(put(player, GAME_A, "one", saveOfBytes("one", 19_000))).resolves.toBeTruthy();
  });

  it("refuses another game's save and another slot's with 422 schema", async () => {
    const otherGame = await refusal(put(player, GAME_A, "one", saveText("one", { game: GAME_B })));
    expect(otherGame.status).toBe(422);
    expect(otherGame.body).toMatchObject({
      code: "schema",
      message: `This save is for the game "${GAME_B}", not "${GAME_A}".`,
    });

    const otherSlot = await refusal(put(player, GAME_A, "one", saveText("two")));
    expect(otherSlot.status).toBe(422);
    expect(otherSlot.body.code).toBe("schema");

    const notASave = await refusal(put(player, GAME_A, "one", "{}"));
    expect(notASave.status).toBe(422);
    expect(notASave.body.code).toBe("schema");

    const longTitle = await refusal(
      put(player, GAME_A, "one", saveText("one", { title: "t".repeat(81) })),
    );
    expect(longTitle.status).toBe(422);

    const badSlot = await refusal(put(player, GAME_A, "Bad Slot", saveText("one")));
    expect(badSlot.status).toBe(422);
    expect(badSlot.body.code).toBe("schema");
    expect(store.objects.size).toBe(0);
  });

  it("refuses a game that saves on its own servers with 403", async () => {
    const error = await refusal(put(player, OWN, "one", saveText("one", { game: OWN })));
    expect(error.status).toBe(403);
    expect(error.body).toEqual({
      code: "save-forbidden",
      message: `This game doesn't save to ${SITE.name}.`,
      hint: "Its publisher set it to save on its own servers or not at all.",
    });
  });

  it("refuses a project with no production release, or none at all, with 403", async () => {
    const unreleased = await refusal(
      put(player, UNRELEASED, "one", saveText("one", { game: UNRELEASED })),
    );
    expect(unreleased.status).toBe(403);
    expect(unreleased.body.code).toBe("save-forbidden");
    const missing = await refusal(put(player, "no-such-project", "one", saveText("one")));
    expect(missing.status).toBe(403);
  });

  it("refuses the 121st write in an hour with 429 save-store-failed", async () => {
    for (let i = 0; i < 120; i++) await put(player, GAME_A, "one", saveText("one"));
    const error = await refusal(put(player, GAME_A, "one", saveText("one")));
    expect(error.status).toBe(429);
    expect(error.body).toEqual({
      code: "save-store-failed",
      message: "You're saving very often. Try again in a few minutes.",
    });
    expect(limiter.calls.at(-1)).toEqual({
      bucket: `engine-save-write:${GAME_A}`,
      key: player,
      limit: 120,
      window: 3600,
    });
    // The window is per game.
    await expect(
      put(player, GAME_B, "one", saveText("one", { game: GAME_B })),
    ).resolves.toBeTruthy();
  }, 60_000);
});

describe("saveAccess", () => {
  const project = {
    projectId: GAME_A,
    visibility: "public" as const,
    teamId: null,
    hiddenAt: null,
    saveMode: "site" as const,
  };
  const production = {
    id: hex(1),
    gameId: GAME_A,
    hiddenAt: null,
    collectedAt: null,
    firstPromotedAt: T0,
    jamPinned: false,
  };

  it("lets a signed-in player of the production release save", () => {
    expect(saveAccess(viewer("p"), project, production)).toBeNull();
  });

  it("refuses in the spec's order: signed out, hidden, mode, no production, may not play", () => {
    const hidden = { ...project, hiddenAt: T0, saveMode: "own" as const };
    expect(saveAccess(viewer(null), hidden, null)?.status).toBe(401);
    expect(saveAccess(viewer("p"), hidden, null)?.body.message).toContain("can't save");
    expect(saveAccess(viewer("p"), { ...project, saveMode: "none" }, null)?.body.message).toBe(
      `This game doesn't save to ${SITE.name}.`,
    );
    expect(saveAccess(viewer("p"), project, null)?.status).toBe(403);
    expect(saveAccess(viewer("p"), { ...project, visibility: "private" }, production)?.status).toBe(
      403,
    );
    expect(saveAccess(viewer("p"), project, { ...production, hiddenAt: T0 })?.status).toBe(403);
  });
});

describe("reads", () => {
  it("lists a game's saves and bumps used_at", async () => {
    await put(player, GAME_A, "one", saveText("one", { title: "First" }));
    await put(player, GAME_A, "two", saveText("two"));
    clock = new Date("2026-12-01T00:00:00Z");

    const list = await listSaves(deps(), { viewer: viewer(player), projectId: GAME_A });
    expect(list).toEqual({
      saves: [
        {
          slot: "one",
          meta: expect.objectContaining({ title: "First" }),
          bytes: expect.any(Number),
        },
        { slot: "two", meta: expect.objectContaining({ scene: "one" }), bytes: expect.any(Number) },
      ],
      limits: { maxBytes: 32_768, maxSlots: 4 },
      describe: SIGNED_IN_SAVES_DESCRIBE,
      mode: "site",
    });
    expect(SIGNED_IN_SAVES_DESCRIBE).toBe(
      `Saved to your ${SITE.name} account: up to 4 saves of 32 KB for this game. Saves you don't use for 180 days are deleted.`,
    );
    expect((await rowOf(player, GAME_A, "one"))?.usedAt).toEqual(clock);
    expect((await rowOf(player, GAME_A, "one"))?.writtenAt).toEqual(T0);
    expect(limiter.calls.at(-1)).toEqual({
      bucket: SAVE_READ_BUCKET,
      key: player,
      limit: 600,
      window: 3600,
    });
  });

  it("reads one save's text, bumping used_at, and null for an empty slot", async () => {
    const text = saveText("one");
    await put(player, GAME_A, "one", text);
    clock = new Date("2026-12-02T00:00:00Z");
    const slot = (s: string) => ({ viewer: viewer(player), projectId: GAME_A, slot: s });
    await expect(readSave(deps(), slot("one"))).resolves.toBe(text);
    expect((await rowOf(player, GAME_A, "one"))?.usedAt).toEqual(clock);
    await expect(readSave(deps(), slot("two"))).resolves.toBeNull();
    const signedOut = await refusal(
      readSave(deps(), { viewer: viewer(null), projectId: GAME_A, slot: "one" }),
    );
    expect(signedOut.status).toBe(401);
  });

  it("refuses the 601st read in an hour", async () => {
    const input = { viewer: viewer(player), projectId: GAME_A, slot: "one" };
    for (let i = 0; i < 600; i++) await limiter.rateLimit(SAVE_READ_BUCKET, player, 600, 3600);
    const error = await refusal(readSave(deps(), input));
    expect(error.status).toBe(429);
    expect(error.body.code).toBe("save-store-failed");
  });

  it("removes the object, then the row", async () => {
    await put(player, GAME_A, "one", saveText("one"));
    await removeSave(deps(), { viewer: viewer(player), projectId: GAME_A, slot: "one" });
    expect(store.objects.has(engineSaveKey(player, GAME_A, "one"))).toBe(false);
    expect(await rowOf(player, GAME_A, "one")).toBeUndefined();
    await expect(
      removeSave(deps(), { viewer: viewer(player), projectId: GAME_A, slot: "one" }),
    ).resolves.toBeUndefined();
  });

  it("leaves a slot with no row alone, as a first write's object has none yet", async () => {
    const key = engineSaveKey(player, GAME_A, "one");
    await store.put(key, new TextEncoder().encode("{}"), "application/json");
    await removeSave(deps(), { viewer: viewer(player), projectId: GAME_A, slot: "one" });
    expect(store.objects.has(key)).toBe(true);
  });

  it("groups the account's saves by game with each game's title", async () => {
    await put(player, GAME_B, "z", saveText("z", { game: GAME_B }));
    await put(player, GAME_A, "one", saveText("one"));
    await put(player, GAME_A, "two", saveText("two"));
    clock = new Date("2026-12-03T00:00:00Z");

    const account = await listAccountSaves(deps(), { userId: player });
    expect(account.games.map((g) => [g.projectId, g.title, g.saves.map((s) => s.slot)])).toEqual([
      [GAME_A, `Title of ${GAME_A}`, ["one", "two"]],
      [GAME_B, `Title of ${GAME_B}`, ["z"]],
    ]);
    expect(account.games[0]?.saves[0]).toMatchObject({
      gameVersion: 3,
      releaseId: hex(77),
      writtenAt: T0.toISOString(),
      usedAt: T0.toISOString(),
    });
    expect(account.usedBytes).toBe(
      account.games.flatMap((g) => g.saves).reduce((sum, s) => sum + s.bytes, 0),
    );
    expect(account).toMatchObject({ maxBytes: SITE_SAVE_ACCOUNT_BYTES, expiryDays: 180 });
    // Settings' listing isn't a use.
    expect((await rowOf(player, GAME_A, "one"))?.usedAt).toEqual(T0);
  });
});
