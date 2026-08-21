import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { notificationPreferences } from "@/db/schema";
import { applyUnsubscribe } from "@/lib/unsubscribe";
import { getPreferences, setEmailsDisabled, updatePreference } from "@/orpc/router/notifications";
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
 * The plan-16 unsubscribe-loop acceptance, against real SQL: a checkbox
 * click patches one channel without clobbering the other two (probes A and
 * C of the audit), and unsubscribe-all → master switch back on restores
 * the pre-unsub matrix instead of wiping it (probe B).
 */

let db: TestDb;
const USER = "pref-user";

async function prefs(userId: string) {
  return call(getPreferences, {}, asUser(userId));
}

function rowFor(data: Awaited<ReturnType<typeof prefs>>, type: string) {
  return data.preferences.find((p) => p.type === type)!;
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles, user, userNotificationSettings } = await import("@/db/schema");
  await db.delete(notificationPreferences);
  await db.delete(userNotificationSettings);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, USER);
});

describe("updatePreference", () => {
  it("patches only the channel the click sent (probe A)", async () => {
    await call(
      updatePreference,
      { type: "collab_response_received", inApp: false, email: false, digest: true },
      asUser(USER),
    );
    await call(updatePreference, { type: "collab_response_received", email: true }, asUser(USER));

    const row = rowFor(await prefs(USER), "collab_response_received");
    expect(row).toMatchObject({ inApp: false, email: true, digest: true });
  });

  it("does not cancel a digest opt-in when email is unticked (probe C)", async () => {
    await call(updatePreference, { type: "comment_received", digest: true }, asUser(USER));
    await call(updatePreference, { type: "comment_received", email: false }, asUser(USER));

    const row = rowFor(await prefs(USER), "comment_received");
    expect(row.digest).toBe(true);
  });

  it("resolves absent channels from the defaults on first write", async () => {
    await call(updatePreference, { type: "jam_starting", digest: true }, asUser(USER));

    const row = rowFor(await prefs(USER), "jam_starting");
    // jam_starting defaults to email on; the digest-only patch keeps it.
    expect(row).toMatchObject({ inApp: true, email: true, digest: true });
  });
});

describe("unsubscribe-all round trip (probe B)", () => {
  it("sets the kill switch without touching the matrix, so re-enabling restores it", async () => {
    await call(
      updatePreference,
      { type: "collab_response_received", email: false, digest: true },
      asUser(USER),
    );

    await applyUnsubscribe(db, USER, "all");

    const during = await prefs(USER);
    expect(during.emailsDisabled).toBe(true);
    // No per-type sweep: the only row is the one the user created.
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, USER));
    expect(rows).toHaveLength(1);

    await call(setEmailsDisabled, { disabled: false }, asUser(USER));

    const after = await prefs(USER);
    expect(after.emailsDisabled).toBe(false);
    expect(rowFor(after, "collab_response_received")).toMatchObject({
      email: false,
      digest: true,
    });
    // A type the user never touched is back on its default, not forced off.
    expect(rowFor(after, "team_invite_received").email).toBe(true);
  });

  it("still turns off email and digest for a single-type unsubscribe", async () => {
    await applyUnsubscribe(db, USER, "comment_reply");

    const data = await prefs(USER);
    expect(data.emailsDisabled).toBe(false);
    expect(rowFor(data, "comment_reply")).toMatchObject({ email: false, digest: false });
  });
});
