import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { notifications } from "@/db/schema";
import {
  READ_NOTIFICATION_RETENTION_DAYS,
  sweepReadNotifications,
} from "@/lib/notification-retention";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

const DAY_MS = 86_400_000;

let db: TestDb;

async function seedRow(readAt: Date | null): Promise<number> {
  const [row] = await db
    .insert(notifications)
    .values({ userId: "reader", type: "collab_post_featured", data: {}, readAt })
    .returning({ id: notifications.id });
  return row!.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedUser(db, "reader");
});

describe("sweepReadNotifications", () => {
  it("retires read rows past the window and keeps the rest", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - (READ_NOTIFICATION_RETENTION_DAYS + 1) * DAY_MS);
    const recent = new Date(now.getTime() - (READ_NOTIFICATION_RETENTION_DAYS - 1) * DAY_MS);

    await seedRow(old);
    const keptRecent = await seedRow(recent);
    const keptUnread = await seedRow(null);

    expect(await sweepReadNotifications(db, now)).toBe(1);

    const left = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, "reader"));
    const byId = (a: number, b: number) => a - b;
    expect(left.map((r) => r.id).sort(byId)).toEqual([keptRecent, keptUnread].sort(byId));

    // Idempotent: the second pass finds nothing.
    expect(await sweepReadNotifications(db, now)).toBe(0);
  });
});
