import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { forumCategories, forumPosts, teams, threads, threadSubscriptions } from "@/db/schema";
import { loadSubject, resolveThread } from "@/lib/comment-subjects";
import { seedUser, type TestDb } from "@/test/db";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

let forumEnabled = true;
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => forumEnabled,
}));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles, user } = await import("@/db/schema");
  forumEnabled = true;
  await db.delete(threads);
  await db.delete(forumPosts);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
});

async function categoryId(slug: string): Promise<number> {
  const [row] = await db
    .select({ id: forumCategories.id })
    .from(forumCategories)
    .where(eq(forumCategories.slug, slug));
  return row!.id;
}

async function seedPost(values: Partial<typeof forumPosts.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(forumPosts)
    .values({
      kind: "post",
      categoryId: await categoryId("show-and-tell"),
      authorId: "author",
      body: "hello forum",
      excerpt: "hello forum",
      publishedAt: new Date(),
      ...values,
    })
    .returning({ id: forumPosts.id });
  return row!.id;
}

describe("forum migration", () => {
  it("seeds the categories, with Announcements staff-only", async () => {
    const rows = await db.select().from(forumCategories);
    expect(rows.map((r) => r.slug).sort()).toEqual([
      "announcements",
      "devlogs",
      "feedback",
      "help",
      "jam-talk",
      "off-topic",
      "show-and-tell",
    ]);
    expect(rows.find((r) => r.slug === "announcements")!.postingPolicy).toBe("staff");
  });

  it("requires a title on everything but a post, and a devlog for team posts", async () => {
    await seedUser(db, "author");
    await expect(seedPost({ kind: "question" })).rejects.toThrow();

    const [team] = await db
      .insert(teams)
      .values({ slug: "crew", name: "Crew", createdBy: "author" })
      .returning({ id: teams.id });
    await expect(seedPost({ teamId: team!.id })).rejects.toThrow();
    await expect(seedPost({ kind: "devlog", title: "Entry 1", teamId: team!.id })).resolves.toEqual(
      expect.any(Number),
    );
  });

  it("refuses a published post without a publish time", async () => {
    await seedUser(db, "author");
    await expect(seedPost({ publishedAt: null })).rejects.toThrow();
  });
});

describe("forum_post comment subject", () => {
  it("creates one thread and subscribes the author", async () => {
    await seedUser(db, "author");
    const id = await seedPost();
    const ref = { type: "forum_post", id } as const;
    const subject = (await loadSubject(ref, null))!;
    expect(subject.url).toBe(`/forum/${id}`);
    expect(subject.title).toBe("hello forum");

    const thread = await resolveThread(ref, subject);
    expect(thread.forumPostId).toBe(id);
    const subs = await db
      .select()
      .from(threadSubscriptions)
      .where(eq(threadSubscriptions.threadId, thread.id));
    expect(subs.map((s) => s.userId)).toEqual(["author"]);
  });

  it("reads as absent while the forum flag is off", async () => {
    await seedUser(db, "author");
    const id = await seedPost();
    forumEnabled = false;
    expect(await loadSubject({ type: "forum_post", id }, "author")).toBeNull();
  });

  it("keeps a deleted post's thread readable but closed", async () => {
    await seedUser(db, "author");
    const id = await seedPost({ deletedAt: new Date() });
    const subject = (await loadSubject({ type: "forum_post", id }, null))!;
    expect(subject.commentingEnabled).toBe(true);
    expect(subject.closedReason).toBe("This post was deleted.");
  });

  it("survives its author's account being deleted", async () => {
    await seedUser(db, "author");
    const id = await seedPost();
    const { user } = await import("@/db/schema");
    await db.delete(user).where(eq(user.id, "author"));

    const subject = (await loadSubject({ type: "forum_post", id }, null))!;
    expect(subject.ownerId).toBeNull();
    const thread = await resolveThread({ type: "forum_post", id }, subject);
    expect(thread.forumPostId).toBe(id);
  });
});
