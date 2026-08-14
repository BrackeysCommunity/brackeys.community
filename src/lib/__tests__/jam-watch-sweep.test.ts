import { and, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  jamWatches,
  notifications,
  type NotificationType,
} from "@/db/schema";
import { sweepJamWatches } from "@/lib/jam-watch-sweep";
import { recordNotification } from "@/lib/notify-core";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

/**
 * The sweep against real SQL — the send path (`recordNotification`, the same
 * write the service's notify() makes before enqueueing side-effects), the
 * claim-stamp idempotency ("run it twice, assert one row"), and the
 * tombstone/window exclusions. The email leg past the notification row is
 * the worker's, out of scope here.
 */

const HOUR = 60 * 60 * 1000;

let db: TestDb;
const notify = async (params: Parameters<typeof recordNotification>[1]) => {
  await recordNotification(db, params);
};

async function seedJam(
  jamId: number,
  dates: Partial<typeof itchJams.$inferInsert> = {},
): Promise<number> {
  await db.insert(itchJams).values({
    jamId,
    slug: `jam-${jamId}`,
    title: `Jam ${jamId}`,
    status: "upcoming",
    ...dates,
  });
  return jamId;
}

async function watch(userId: string, jamId: number) {
  await db.insert(jamWatches).values({ userId, jamId });
}

function notificationsFor(userId: string, type: NotificationType) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
}

beforeEach(async () => {
  db = await createTestDb();
  await seedUser(db, "watcher");
});

describe("sweepJamWatches — jam_starting", () => {
  it("notifies a watcher once for a jam inside the start window, and never again", async () => {
    const now = new Date();
    const jamId = await seedJam(1, { startsAt: new Date(now.getTime() + 12 * HOUR) });
    await watch("watcher", jamId);

    const first = await sweepJamWatches(db, notify, now);
    expect(first.jam_starting).toBe(1);

    // The exercise the plan asked for: run it twice, assert one row.
    const second = await sweepJamWatches(db, notify, new Date(now.getTime() + HOUR));
    expect(second.jam_starting).toBe(0);

    const rows = await notificationsFor("watcher", "jam_starting");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ jamId: 1, jamTitle: "Jam 1", jamUrl: "/jams/jam-1" });

    const [watchRow] = await db.select().from(jamWatches).where(eq(jamWatches.jamId, jamId));
    expect(watchRow!.startNotifiedAt).not.toBeNull();
  });

  it("ignores jams outside the notice window, already started, or unwatched", async () => {
    const now = new Date();
    await seedJam(1, { startsAt: new Date(now.getTime() + 72 * HOUR) });
    await seedJam(2, { startsAt: new Date(now.getTime() - 1 * HOUR) });
    await seedJam(3, { startsAt: new Date(now.getTime() + 12 * HOUR) }); // in window, nobody watching
    await watch("watcher", 1);
    await watch("watcher", 2);

    const sent = await sweepJamWatches(db, notify, now);
    expect(sent.jam_starting).toBe(0);
    expect(await notificationsFor("watcher", "jam_starting")).toHaveLength(0);
  });

  it("skips tombstoned jams even when their dates read as due", async () => {
    const now = new Date();
    const jamId = await seedJam(1, {
      startsAt: new Date(now.getTime() + 12 * HOUR),
      missingSince: new Date(now.getTime() - 24 * HOUR),
    });
    await watch("watcher", jamId);

    const sent = await sweepJamWatches(db, notify, now);
    expect(sent.jam_starting).toBe(0);
  });
});

describe("sweepJamWatches — jam_voting_open", () => {
  it("fires once when submissions closed and a real voting window is open", async () => {
    const now = new Date();
    const jamId = await seedJam(1, {
      startsAt: new Date(now.getTime() - 96 * HOUR),
      endsAt: new Date(now.getTime() - 2 * HOUR),
      votingEndsAt: new Date(now.getTime() + 48 * HOUR),
    });
    await watch("watcher", jamId);

    expect((await sweepJamWatches(db, notify, now)).jam_voting_open).toBe(1);
    expect((await sweepJamWatches(db, notify, now)).jam_voting_open).toBe(0);
    expect(await notificationsFor("watcher", "jam_voting_open")).toHaveLength(1);
  });

  it("announces nothing for a jam with no voting phase", async () => {
    const now = new Date();
    const jamId = await seedJam(1, {
      startsAt: new Date(now.getTime() - 96 * HOUR),
      endsAt: new Date(now.getTime() - 2 * HOUR),
      votingEndsAt: null,
    });
    await watch("watcher", jamId);

    expect((await sweepJamWatches(db, notify, now)).jam_voting_open).toBe(0);
  });
});

describe("sweepJamWatches — jam_results_posted", () => {
  it("fires on the first sweep after a placement row exists, once per watcher", async () => {
    const now = new Date();
    const jamId = await seedJam(1, { endsAt: new Date(now.getTime() - 96 * HOUR) });
    await seedUser(db, "other-watcher");
    await watch("watcher", jamId);
    await watch("other-watcher", jamId);

    // No results scraped yet → nothing to say.
    expect((await sweepJamWatches(db, notify, now)).jam_results_posted).toBe(0);

    await db.insert(itchJamEntries).values({
      entryId: 900,
      jamId,
      gameId: 5000,
      rateUrl: "https://itch.io/jam/jam-1/rate/900",
      gameTitle: "Entry",
      gameUrl: "https://someone.itch.io/entry",
    });
    await db.insert(itchJamEntryResults).values({
      entryId: 900,
      criterion: "Overall",
      rank: 1,
      score: "4.500",
      rawScore: "4.500",
    });

    expect((await sweepJamWatches(db, notify, now)).jam_results_posted).toBe(2);
    expect((await sweepJamWatches(db, notify, now)).jam_results_posted).toBe(0);
    expect(await notificationsFor("watcher", "jam_results_posted")).toHaveLength(1);
    expect(await notificationsFor("other-watcher", "jam_results_posted")).toHaveLength(1);
  });
});

describe("sweepJamWatches — send path", () => {
  it("respects a watcher who turned every channel off for the type", async () => {
    const now = new Date();
    const jamId = await seedJam(1, { startsAt: new Date(now.getTime() + 12 * HOUR) });
    await watch("watcher", jamId);
    const { notificationPreferences } = await import("@/db/schema");
    await db.insert(notificationPreferences).values({
      userId: "watcher",
      type: "jam_starting",
      inApp: false,
      email: false,
      digest: false,
    });

    // The stamp still claims (the sweep's counter reflects the attempt) but
    // no row lands — recordNotification refuses an all-channels-off write.
    await sweepJamWatches(db, notify, now);
    expect(await notificationsFor("watcher", "jam_starting")).toHaveLength(0);

    const [row] = await db.select({ value: count() }).from(notifications);
    expect(row!.value).toBe(0);
  });
});
