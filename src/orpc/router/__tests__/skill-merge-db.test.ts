import { call } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  collabPostSkills,
  developerProfiles,
  moderationActions,
  notifications,
  skills,
  user,
  userSkills,
} from "@/db/schema";
import { mergeSkill, updateSkill } from "@/orpc/router/admin";
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
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));

/** Folding a duplicate skill ("love2d") into the canonical one ("LÖVE"). */
let db: TestDb;
let love: number;
let love2d: number;
let godot: number;

async function skillId(name: string) {
  const [row] = await db.select({ id: skills.id }).from(skills).where(eq(skills.name, name));
  return row!.id;
}

async function skillsOf(userId: string) {
  const rows = await db
    .select({ name: skills.name, sortOrder: userSkills.sortOrder })
    .from(userSkills)
    .innerJoin(skills, eq(skills.id, userSkills.skillId))
    .where(eq(userSkills.userId, userId))
    .orderBy(asc(userSkills.sortOrder));
  return rows;
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(developerProfiles);
  await db.delete(user);
  await db.delete(skills).where(eq(skills.name, "love2d"));

  await seedUser(db, "admin", { guildRoles: ["Admin"] });
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "only-dupe");
  await seedUser(db, "has-both");

  [{ id: love2d }] = await db
    .insert(skills)
    .values({ name: "love2d", category: "Engines" })
    .returning({ id: skills.id });
  love = await skillId("LÖVE");
  godot = await skillId("Godot");

  await db.insert(userSkills).values([
    { userId: "only-dupe", skillId: love2d, sortOrder: 0 },
    { userId: "only-dupe", skillId: godot, sortOrder: 1 },
    { userId: "has-both", skillId: love, sortOrder: 0 },
    { userId: "has-both", skillId: love2d, sortOrder: 1 },
    { userId: "has-both", skillId: godot, sortOrder: 2 },
  ]);
});

describe("mergeSkill", () => {
  it("moves members onto the target, keeping their order", async () => {
    await call(mergeSkill, { sourceId: love2d, targetId: love }, asUser("admin"));

    expect(await skillsOf("only-dupe")).toEqual([
      { name: "LÖVE", sortOrder: 0 },
      { name: "Godot", sortOrder: 1 },
    ]);
    // The duplicate row goes, and the gap it left closes.
    expect(await skillsOf("has-both")).toEqual([
      { name: "LÖVE", sortOrder: 0 },
      { name: "Godot", sortOrder: 1 },
    ]);
    expect(await db.select().from(skills).where(eq(skills.id, love2d))).toEqual([]);
  });

  it("re-tags collab posts, dropping a tag the post already had", async () => {
    const solo = await seedCollabPost(db, "only-dupe");
    const both = await seedCollabPost(db, "has-both");
    await db.insert(collabPostSkills).values([
      { postId: solo, skillId: love2d },
      { postId: both, skillId: love2d },
      { postId: both, skillId: love },
    ]);

    const result = await call(mergeSkill, { sourceId: love2d, targetId: love }, asUser("admin"));
    expect(result.posts).toBe(1);

    for (const postId of [solo, both]) {
      const tags = await db
        .select({ skillId: collabPostSkills.skillId })
        .from(collabPostSkills)
        .where(eq(collabPostSkills.postId, postId));
      expect(tags).toEqual([{ skillId: love }]);
    }
  });

  it("notifies only members whose skill changed name, and logs the merge", async () => {
    const result = await call(mergeSkill, { sourceId: love2d, targetId: love }, asUser("admin"));
    expect(result.members).toBe(1);

    const notices = await db
      .select({ userId: notifications.userId, data: notifications.data })
      .from(notifications)
      .where(eq(notifications.type, "skill_renamed"));
    expect(notices).toEqual([
      { userId: "only-dupe", data: { fromName: "love2d", toName: "LÖVE" } },
    ]);

    const [log] = await db
      .select()
      .from(moderationActions)
      .where(
        and(
          eq(moderationActions.action, "vocabulary_merged"),
          eq(moderationActions.actorId, "admin"),
        ),
      );
    expect(log?.metadata).toMatchObject({ from: "love2d", to: "LÖVE", members: 1 });
  });

  it("is admin-only", async () => {
    await expect(
      call(mergeSkill, { sourceId: love2d, targetId: love }, asUser("staff")),
    ).rejects.toThrow();
    expect(await skillsOf("only-dupe")).toHaveLength(2);
    expect((await skillsOf("only-dupe"))[0]?.name).toBe("love2d");
  });

  it("refuses to merge a skill into itself", async () => {
    await expect(
      call(mergeSkill, { sourceId: love, targetId: love }, asUser("admin")),
    ).rejects.toThrow();
  });
});

describe("updateSkill", () => {
  it("notifies every holder when the name changes", async () => {
    await call(updateSkill, { skillId: love2d, name: "Love 2D" }, asUser("staff"));

    const notices = await db
      .select({ userId: notifications.userId, data: notifications.data })
      .from(notifications)
      .where(eq(notifications.type, "skill_renamed"))
      .orderBy(asc(notifications.userId));
    expect(notices).toEqual([
      { userId: "has-both", data: { fromName: "love2d", toName: "Love 2D" } },
      { userId: "only-dupe", data: { fromName: "love2d", toName: "Love 2D" } },
    ]);
  });

  it("stays quiet for a category-only change", async () => {
    await call(
      updateSkill,
      { skillId: love2d, name: "love2d", category: "Frameworks" },
      asUser("staff"),
    );
    expect(
      await db.select().from(notifications).where(eq(notifications.type, "skill_renamed")),
    ).toEqual([]);
  });
});
