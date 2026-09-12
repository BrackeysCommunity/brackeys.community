import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, notifications, user } from "@/db/schema";
import { clearReadNotifications, dismissNotifications } from "@/orpc/router/notifications";
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
 * Both procedures delete, so the thing to prove is what they refuse to
 * touch: another member's rows, and (for clear-read) the unread ones.
 */
let db: TestDb;

async function seedRow(userId: string, readAt: Date | null): Promise<number> {
  const [row] = await db
    .insert(notifications)
    .values({ userId, type: "collab_post_featured", data: {}, readAt })
    .returning({ id: notifications.id });
  return row!.id;
}

function idsFor(userId: string) {
  return db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .then((rows) => rows.map((r) => r.id).sort((a, b) => a - b));
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "reader");
  await seedUser(db, "other");
});

describe("dismissNotifications", () => {
  it("removes the caller's rows, read or not, and leaves everyone else's", async () => {
    const mine = await seedRow("reader", null);
    const mineRead = await seedRow("reader", new Date());
    const theirs = await seedRow("other", null);

    const result = await call(
      dismissNotifications,
      { ids: [mine, mineRead, theirs] },
      asUser("reader"),
    );

    expect(result.removed).toBe(2);
    expect(await idsFor("reader")).toEqual([]);
    expect(await idsFor("other")).toEqual([theirs]);
  });
});

describe("clearReadNotifications", () => {
  it("empties the read rows and keeps the unread ones", async () => {
    const unread = await seedRow("reader", null);
    await seedRow("reader", new Date());
    await seedRow("reader", new Date());
    const theirsRead = await seedRow("other", new Date());

    const result = await call(clearReadNotifications, {}, asUser("reader"));

    expect(result.removed).toBe(2);
    expect(await idsFor("reader")).toEqual([unread]);
    expect(await idsFor("other")).toEqual([theirsRead]);
  });
});
