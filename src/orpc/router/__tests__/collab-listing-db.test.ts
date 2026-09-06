import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collabPosts, developerProfiles, user } from "@/db/schema";
import { countPostsByType, listPosts } from "@/orpc/router/collab";
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

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(collabPosts);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "author");
  await seedCollabPost(db, "author", { title: "open post", status: "recruiting" });
  await seedCollabPost(db, "author", { title: "closed post", status: "party_full" });
  await seedCollabPost(db, "author", { title: "expired post", status: "expired" });
});

const titles = (posts: { title: string }[]) => posts.map((p) => p.title).sort();

/**
 * A sweep-expired post leaves the board: it only comes back when a caller
 * asks for that status by name, and the CLOSED filter means owner-closed.
 */
describe("listPosts and expired posts", () => {
  it("hides expired posts from the default listing", async () => {
    const { posts, total } = await call(listPosts, {}, asUser(null));
    expect(titles(posts)).toEqual(["closed post", "open post"]);
    expect(total).toBe(2);
  });

  it("keeps expired posts out of the CLOSED filter", async () => {
    const { posts } = await call(listPosts, { status: "party_full" }, asUser(null));
    expect(titles(posts)).toEqual(["closed post"]);
  });

  it("returns them when asked for by status", async () => {
    const { posts } = await call(listPosts, { status: "expired" }, asUser(null));
    expect(titles(posts)).toEqual(["expired post"]);
  });

  it("agrees with the type counts above the board", async () => {
    const counts = await call(countPostsByType, {}, asUser(null));
    expect(counts.all).toBe(2);
  });
});
