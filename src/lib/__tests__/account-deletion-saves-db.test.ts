import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, engineProjects, engineSaves, user } from "@/db/schema";
import { cleanupUserData, type SaveObjectStore } from "@/lib/account-deletion";
import { engineSaveKey } from "@/lib/engine/storage-keys";
import { seedUser, type TestDb } from "@/test/db";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  purgeGuildMemberCache: async () => {},
}));
vi.mock("@/lib/canvas-sync-publish", () => ({
  publishCanvasRevoke: async () => {},
}));

const PROJECT = "kitchen";

let db: TestDb;

/** A bucket in memory; `failOn` keys refuse removal like an unreachable bucket would. */
function memoryStore(failOn: string[] = []): SaveObjectStore & { objects: Set<string> } {
  const objects = new Set<string>();
  return {
    objects,
    async list(prefix) {
      return [...objects].filter((key) => key.startsWith(prefix)).sort();
    },
    async remove(key) {
      if (failOn.includes(key)) throw new Error(`bucket refused ${key}`);
      objects.delete(key);
    },
  };
}

const save = (userId: string, slot: string) => ({
  userId,
  projectId: PROJECT,
  slot,
  bytes: 10,
  gameVersion: 1,
  releaseId: null,
  meta: { scene: "level-1", savedAt: 0, playTicks: 60 },
});

const rowsOf = async (userId: string) =>
  (
    await db
      .select({ slot: engineSaves.slot })
      .from(engineSaves)
      .where(eq(engineSaves.userId, userId))
      .orderBy(engineSaves.slot)
  ).map((r) => r.slot);

/** What better-auth does after `beforeDelete`: the user row goes, the saves cascade. */
async function closeAccount(userId: string, store: SaveObjectStore) {
  await cleanupUserData(userId, { saveObjects: store });
  await db.delete(user).where(eq(user.id, userId));
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(engineSaves);
  await db.delete(engineProjects);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "player");
  await seedUser(db, "other");
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
});
afterEach(() => vi.restoreAllMocks());

describe("closing an account removes its game saves", () => {
  it("deletes every save object, stragglers included, then the rows cascade", async () => {
    const store = memoryStore();
    await db.insert(engineSaves).values([save("player", "auto"), save("player", "slot-1")]);
    store.objects.add(engineSaveKey("player", PROJECT, "auto"));
    store.objects.add(engineSaveKey("player", PROJECT, "slot-1"));
    // An object no row names, from another project.
    store.objects.add(engineSaveKey("player", "gone", "auto"));
    await db.insert(engineSaves).values(save("other", "auto"));
    store.objects.add(engineSaveKey("other", PROJECT, "auto"));

    await cleanupUserData("player", { saveObjects: store });
    expect([...store.objects]).toEqual([engineSaveKey("other", PROJECT, "auto")]);
    // The rows still stand until the user row goes.
    expect(await rowsOf("player")).toEqual(["auto", "slot-1"]);

    await db.delete(user).where(eq(user.id, "player"));
    expect(await rowsOf("player")).toEqual([]);
    expect(await rowsOf("other")).toEqual(["auto"]);
  });

  it("goes on when an object is missing or the bucket refuses one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = engineSaveKey("player", PROJECT, "slot-2");
    const store = memoryStore([refused]);
    await db
      .insert(engineSaves)
      .values([save("player", "auto"), save("player", "slot-1"), save("player", "slot-2")]);
    // `auto` has a row but no object.
    store.objects.add(engineSaveKey("player", PROJECT, "slot-1"));
    store.objects.add(refused);

    await closeAccount("player", store);
    expect([...store.objects]).toEqual([refused]);
    expect(await rowsOf("player")).toEqual([]);
    expect(
      await db.select().from(developerProfiles).where(eq(developerProfiles.id, "player")),
    ).toEqual([]);
  });

  it("removes the objects of a player with no profile row", async () => {
    const store = memoryStore();
    await db.delete(developerProfiles).where(eq(developerProfiles.id, "player"));
    await db.insert(engineSaves).values(save("player", "auto"));
    store.objects.add(engineSaveKey("player", PROJECT, "auto"));

    await closeAccount("player", store);
    expect(store.objects.size).toBe(0);
    expect(await rowsOf("player")).toEqual([]);
  });
});
