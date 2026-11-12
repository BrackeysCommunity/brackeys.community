import { SLOT_PATTERN } from "@jams/engine/game";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { engineProjects, engineSaves, user } from "@/db/schema";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

const PROJECT = "kitchen";
const PLAYER = "player";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedUser(db, PLAYER);
  await seedUser(db, "other");
});

beforeEach(async () => {
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
});

/** A bare account row, which nothing else references, so it can be deleted. */
async function account(id: string): Promise<string> {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@test.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

const save = (slot: string, over: Partial<typeof engineSaves.$inferInsert> = {}) => ({
  userId: PLAYER,
  projectId: PROJECT,
  slot,
  bytes: 1200,
  gameVersion: 1,
  releaseId: null,
  meta: { title: "Chapter 1", scene: "level-1", savedAt: 0, playTicks: 60 },
  ...over,
});

/** The database's own words for a refused statement: drizzle wraps them in `cause`. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${String(error)} ${cause instanceof Error ? cause.message : ""}`;
  }
  throw new Error("the statement went through");
}

const savedSlots = async () =>
  (await db.select({ slot: engineSaves.slot }).from(engineSaves)).map((r) => r.slot).sort();

describe("engine_saves", () => {
  it("holds the save's summary, not its bytes", async () => {
    await db.insert(engineSaves).values(save("auto"));
    const [row] = await db.select().from(engineSaves);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "bytes",
      "gameVersion",
      "meta",
      "projectId",
      "releaseId",
      "slot",
      "usedAt",
      "userId",
      "writtenAt",
    ]);
    expect(row?.writtenAt).toBeInstanceOf(Date);
    expect(row?.usedAt).toBeInstanceOf(Date);
  });

  it("checks the slot with the engine's slot pattern", async () => {
    for (const slot of ["a", "auto", "slot-1", "9", "a".repeat(32)]) {
      expect(SLOT_PATTERN.test(slot)).toBe(true);
      await db.insert(engineSaves).values(save(slot));
    }
    for (const slot of ["", "-a", "Auto", "slot_1", "a b", "a".repeat(33)]) {
      expect(SLOT_PATTERN.test(slot)).toBe(false);
      expect(await refusal(() => db.insert(engineSaves).values(save(slot)))).toContain(
        "engine_saves_slot",
      );
    }
  });

  it("refuses a second row for the same player, game and slot", async () => {
    await db.insert(engineSaves).values(save("auto"));
    expect(await refusal(() => db.insert(engineSaves).values(save("auto")))).toContain(
      "engine_saves_pkey",
    );
    await db.insert(engineSaves).values(save("auto", { userId: "other" }));
    expect(await savedSlots()).toEqual(["auto", "auto"]);
  });

  it("goes with the player's account", async () => {
    const leaving = await account("leaving");
    await db.insert(engineSaves).values([save("auto"), save("auto", { userId: leaving })]);
    await db.delete(user).where(eq(user.id, leaving));
    const rows = await db.select({ userId: engineSaves.userId }).from(engineSaves);
    expect(rows).toEqual([{ userId: PLAYER }]);
  });

  it("goes with the project", async () => {
    await db.insert(engineProjects).values({ projectId: "other-game", name: "Other" });
    await db.insert(engineSaves).values([save("auto"), save("auto", { projectId: "other-game" })]);
    await db.delete(engineProjects).where(eq(engineProjects.projectId, PROJECT));
    const rows = await db.select({ projectId: engineSaves.projectId }).from(engineSaves);
    expect(rows).toEqual([{ projectId: "other-game" }]);
  });

  it("keeps a save whose release isn't a row", async () => {
    await db.insert(engineSaves).values(save("auto", { releaseId: "f".repeat(64) }));
    expect(await savedSlots()).toEqual(["auto"]);
  });
});
