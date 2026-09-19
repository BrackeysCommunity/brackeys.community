import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collabPostDiscordShares, collabPosts, developerProfiles, user } from "@/db/schema";
import { clearFeedRefusal } from "@/lib/collab-discord-feed";
import {
  closePost,
  deletePost,
  getPostViewerState,
  reopenPost,
  shareToDiscord,
} from "@/orpc/router/collab";
import { seedCollabPost, seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});

/** Every discord.com call the mirror makes, recorded instead of sent. */
const calls: { method: string; url: string; body: unknown }[] = [];
/** Status the next write answers with, so the 404 branch is reachable. */
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

/** The limiter runs on Redis, which these tests don't stand up — so the
 *  spend/refund pair is recorded here instead, and the handler's contract
 *  ("a share that didn't happen isn't charged") is what gets asserted. */
const limiter: string[] = [];
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  assertRateLimit: async (bucket: string) => {
    limiter.push(`spend:${bucket}`);
  },
  refundRateLimit: async (bucket: string) => {
    limiter.push(`refund:${bucket}`);
  },
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(collabPostDiscordShares);
  await db.delete(collabPosts);
  await db.delete(developerProfiles);
  await db.delete(user);
  calls.length = 0;
  limiter.length = 0;
  nextStatus = 200;
  clearFeedRefusal();

  process.env.DISCORD_COLLAB_CHANNEL_ID = "9001";
  process.env.DISCORD_GUILD_ID = "7";
  process.env.DISCORD_BOT_TOKEN = "bot-token";

  await seedUser(db, "author");
  await seedUser(db, "stranger");
});

describe("shareToDiscord", () => {
  it("posts the embed once and remembers the message", async () => {
    const postId = await seedCollabPost(db, "author");

    const result = await call(shareToDiscord, { postId }, asUser("author"));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/channels/9001/messages");
    expect(result.messageUrl).toBe("discord://-/channels/7/9001/message-1");

    const [row] = await db
      .select()
      .from(collabPostDiscordShares)
      .where(eq(collabPostDiscordShares.postId, postId));
    expect(row.messageId).toBe("message-1");
    expect(row.channelId).toBe("9001");
    expect(row.sharedById).toBe("author");
  });

  it("edits the same message on a second press instead of posting a new one", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));
    await call(shareToDiscord, { postId }, asUser("author"));

    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
    const rows = await db.select().from(collabPostDiscordShares);
    expect(rows).toHaveLength(1);
  });

  it("re-posts when the remembered message is gone from Discord", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));

    nextStatus = 404;
    await call(shareToDiscord, { postId }, asUser("author"));

    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "POST"]);
  });

  it("is the author's alone", async () => {
    const postId = await seedCollabPost(db, "author");
    await expect(call(shareToDiscord, { postId }, asUser("stranger"))).rejects.toBeInstanceOf(
      ORPCError,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a post that is no longer recruiting", async () => {
    const postId = await seedCollabPost(db, "author", { status: "party_full" });
    await expect(call(shareToDiscord, { postId }, asUser("author"))).rejects.toThrow(
      /reopen it first/i,
    );
  });

  it("hands the cooldown back when Discord refuses the message", async () => {
    const postId = await seedCollabPost(db, "author");
    nextStatus = 500;

    await expect(call(shareToDiscord, { postId }, asUser("author"))).rejects.toThrow(
      /didn't take the message/i,
    );

    expect(limiter).toEqual(["spend:collab-discord-share", "refund:collab-discord-share"]);
    // Nothing recorded either — the next press is a first share, not an edit.
    expect(await db.select().from(collabPostDiscordShares)).toHaveLength(0);
  });

  it("keeps the cooldown when the message actually landed", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));
    expect(limiter).toEqual(["spend:collab-discord-share"]);
  });

  it("takes the button away for a while once Discord says the bot can't post", async () => {
    const postId = await seedCollabPost(db, "author");
    nextStatus = 403;

    await expect(call(shareToDiscord, { postId }, asUser("author"))).rejects.toThrow(
      /can't post in the collab channel/i,
    );

    // The next read of the page finds no button: a permission the guild
    // hasn't granted degrades the same way a channel that isn't configured.
    const mine = await call(getPostViewerState, { postId }, asUser("author"));
    expect(mine.discordShare?.available).toBe(false);
  });

  it("answers the author's own page with the mirror's state, and nobody else's", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));

    const mine = await call(getPostViewerState, { postId }, asUser("author"));
    expect(mine.discordShare?.available).toBe(true);
    expect(mine.discordShare?.sharedAt).toBeInstanceOf(Date);
    expect(mine.discordShare?.messageUrl).toBe("discord://-/channels/7/9001/message-1");

    const theirs = await call(getPostViewerState, { postId }, asUser("stranger"));
    expect(theirs.discordShare).toBeNull();
  });
});

describe("the mirror's lifecycle", () => {
  it("takes the message down when the post stops recruiting", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));

    await call(closePost, { postId }, asUser("author"));
    // Fire-and-forget, so let its microtasks drain. A feed of openings
    // should hold openings — a closed post leaves rather than greys.
    await vi.waitFor(() => expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]));
    await vi.waitFor(async () =>
      expect(await db.select().from(collabPostDiscordShares)).toHaveLength(0),
    );
  });

  it("re-shares cleanly after a close, rather than editing a message that is gone", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));
    await call(closePost, { postId }, asUser("author"));
    await vi.waitFor(async () =>
      expect(await db.select().from(collabPostDiscordShares)).toHaveLength(0),
    );

    await call(reopenPost, { postId }, asUser("author"));
    await call(shareToDiscord, { postId }, asUser("author"));

    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE", "POST"]);
  });

  it("takes the message down with the post", async () => {
    const postId = await seedCollabPost(db, "author");
    await call(shareToDiscord, { postId }, asUser("author"));

    await call(deletePost, { postId }, asUser("author"));

    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
    expect(await db.select().from(collabPostDiscordShares)).toHaveLength(0);
  });
});
