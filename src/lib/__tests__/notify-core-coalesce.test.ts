import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { notifications } from "@/db/schema";
import { approvedSkillsOf } from "@/lib/notification-copy";
import { recordNotification, type NotifyParams } from "@/lib/notify-core";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

/**
 * `coalesceWithin` against real SQL. The contract: inside the window, a
 * second notice of the same (user, type) folds into the first row — data
 * merged, bumped to now, unread again, nothing to enqueue — and the
 * entity is deliberately not part of the match, because the rows being
 * folded are about different requests.
 */

let db: TestDb;

function approval(requestId: number, skillName: string): NotifyParams {
  const entry = { skillName, requestedName: skillName };
  return {
    userId: "requester",
    type: "skill_request_approved",
    entityType: "skill_request",
    entityId: String(requestId),
    data: { ...entry, approved: [entry] },
    coalesceWithin: {
      ms: 15 * 60_000,
      merge: (existing) => ({ ...existing, approved: [...approvedSkillsOf(existing), entry] }),
    },
  };
}

function rows() {
  return db.select().from(notifications).where(eq(notifications.userId, "requester"));
}

beforeEach(async () => {
  db = await createTestDb();
  await seedUser(db, "requester");
});

describe("recordNotification coalesceWithin", () => {
  it("folds a second notice into the first row inside the window", async () => {
    const first = await recordNotification(db, approval(1, "Kotlin"));
    expect(first).not.toBeNull();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, first!.id));

    const second = await recordNotification(db, approval(2, "Godot"));
    expect(second).toBeNull();

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.readAt).toBeNull();
    expect(approvedSkilledNames(all[0]!.data)).toEqual(["Kotlin", "Godot"]);
  });

  it("starts a new row once the window has passed", async () => {
    const first = await recordNotification(db, approval(1, "Kotlin"));
    await db
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(notifications.id, first!.id));

    const second = await recordNotification(db, approval(2, "Godot"));
    expect(second).not.toBeNull();
    expect(await rows()).toHaveLength(2);
  });

  it("does not fold across recipients", async () => {
    await seedUser(db, "someone-else");
    await recordNotification(db, approval(1, "Kotlin"));
    const theirs = await recordNotification(db, {
      ...approval(2, "Godot"),
      userId: "someone-else",
    });
    expect(theirs).not.toBeNull();
    expect(await rows()).toHaveLength(1);
  });
});

function approvedSkilledNames(data: Record<string, unknown>): string[] {
  return approvedSkillsOf(data).map((entry) => entry.skillName);
}
