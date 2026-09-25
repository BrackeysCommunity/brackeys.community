import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { forumPostDiscordShares, forumPosts, threads, user } from "@/db/schema";
import { clearDevlogFeedRefusal } from "@/lib/forum-discord-feed";
import {
  createForumPost,
  deleteForumPost,
  getForumPost,
  shareForumPostToDiscord,
  updateForumPost,
} from "@/orpc/router/forum";
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

const calls: { method: string; url: string; body: unknown }[] = [];
let nextStatus = 200;
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
  discordWriteFetch: async (url: string, init: { method: string; body?: unknown }) => {
    calls.push({ method: init.method, url, body: init.body });
    const status = nextStatus;
    nextStatus = 200;
    return new Response(status === 200 ? JSON.stringify({ id: "message-1" }) : "", { status });
  },
}));
vi.mock("@/lib/guild-sync", () => ({ refreshGuildRolesThrottled: async () => {} }));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "alice");
  await seedUser(db, "bob");
  await db.update(user).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) });
  calls.length = 0;
  nextStatus = 200;
  clearDevlogFeedRefusal();
  process.env.DISCORD_DEVLOGS_CHANNEL_ID = "devlogs";
  process.env.DISCORD_GUILD_ID = "guild";
  process.env.DISCORD_BOT_TOKEN = "token";
});

const shareRow = async (postId: number) =>
  (
    await db.select().from(forumPostDiscordShares).where(eq(forumPostDiscordShares.postId, postId))
  )[0];

describe("#devlogs mirror", () => {
  it("posts a devlog ticked at publish, rewrites it on edit, takes it down on delete", async () => {
    const post = await call(
      createForumPost,
      { kind: "devlog", title: "Caves", body: "procedural caves", shareToDiscord: true },
      asUser("alice"),
    );
    await expect.poll(async () => (await shareRow(post.id))?.messageId).toBe("message-1");
    expect(calls[0]).toMatchObject({ method: "POST", url: expect.stringContaining("/devlogs/") });

    await call(
      updateForumPost,
      { postId: post.id, title: "Caves, take two", body: "better caves" },
      asUser("alice"),
    );
    await expect.poll(() => calls.filter((c) => c.method === "PATCH").length).toBe(1);

    await call(deleteForumPost, { postId: post.id }, asUser("alice"));
    expect(calls.at(-1)?.method).toBe("DELETE");
    expect((await shareRow(post.id))?.messageId).toBeNull();
  });

  it("never mirrors a post that isn't a devlog, or an unticked one", async () => {
    await call(
      createForumPost,
      { kind: "post", body: "hi", shareToDiscord: true },
      asUser("alice"),
    );
    await call(createForumPost, { kind: "devlog", title: "Quiet", body: "shh" }, asUser("alice"));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
  });

  it("shares after the fact for the devlog's editors, and reports the state to them", async () => {
    const post = await call(
      createForumPost,
      { kind: "devlog", title: "Later", body: "words" },
      asUser("alice"),
    );
    await expect(
      call(shareForumPostToDiscord, { postId: post.id }, asUser("bob")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const shared = await call(shareForumPostToDiscord, { postId: post.id }, asUser("alice"));
    expect(shared.messageUrl).toContain("guild/devlogs/message-1");

    const page = await call(getForumPost, { postId: post.id }, asUser("alice"));
    expect(page?.viewer.discordShare).toMatchObject({ available: true, live: true });
    const asReader = await call(getForumPost, { postId: post.id }, asUser("bob"));
    expect(asReader?.viewer.discordShare).toBeNull();
  });

  it("reports a refusal from Discord", async () => {
    const post = await call(
      createForumPost,
      { kind: "devlog", title: "Nope", body: "words" },
      asUser("alice"),
    );
    nextStatus = 403;
    await expect(
      call(shareForumPostToDiscord, { postId: post.id }, asUser("alice")),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
