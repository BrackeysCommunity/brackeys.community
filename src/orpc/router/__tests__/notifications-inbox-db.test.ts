import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, notifications, user } from "@/db/schema";
import { listNotifications } from "@/orpc/router/notifications";
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
const viewerInGuild = { value: true };
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => viewerInGuild.value,
}));

/**
 * The inbox is a private read, so the actor's face is settled server-side
 * for the viewer: "Cookie invited you" has to name the same person the
 * team page it links to shows.
 */
let db: TestDb;

const GUILD_AVATAR = "https://cdn.discordapp.com/guilds/g/users/2/avatars/server.png";
const GLOBAL_AVATAR = "https://cdn.discordapp.com/avatars/2/global.png";

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "viewer");
  await seedUser(db, "cookie", { guildNickname: "Cookie 🍪" });
  await db
    .update(developerProfiles)
    .set({
      discordId: "1",
      discordUsername: "cookie_dev",
      avatarUrl: GLOBAL_AVATAR,
      guildAvatarUrl: GUILD_AVATAR,
    })
    .where(eq(developerProfiles.id, "cookie"));
  await db
    .update(developerProfiles)
    .set({ discordId: "9" })
    .where(eq(developerProfiles.id, "viewer"));
  await db.insert(notifications).values({
    userId: "viewer",
    type: "team_invite_received",
    actorId: "cookie",
    entityType: "team",
    entityId: "t1",
    data: { teamName: "comfy", teamSlug: "comfy" },
  });
});

describe("listNotifications actor face", () => {
  it("names the actor by the guild face for a viewer in the guild", async () => {
    viewerInGuild.value = true;
    const { items } = await call(listNotifications, { limit: 10 }, asUser("viewer"));
    expect(items[0]).toMatchObject({ actorName: "Cookie 🍪", actorAvatarUrl: GUILD_AVATAR });
  });

  it("names the actor by the global face for a viewer outside it", async () => {
    viewerInGuild.value = false;
    const { items } = await call(listNotifications, { limit: 10 }, asUser("viewer"));
    expect(items[0]).toMatchObject({ actorName: "cookie_dev", actorAvatarUrl: GLOBAL_AVATAR });
  });
});
