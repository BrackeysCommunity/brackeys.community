import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, skills, user, userSkills } from "@/db/schema";
import { addUserSkill, setMySkills } from "@/orpc/router/profile";
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
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));

/**
 * The profile's byline shows the first skill or two and nothing else, so
 * which one is first is the whole feature. Ordering has to survive the
 * round trip through the join table — where it used to be whatever
 * Postgres handed back.
 */

let db: TestDb;
let godot: number;
let blender: number;
let rust: number;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(userSkills);
  await db.delete(skills);
  await db.delete(developerProfiles);
  await db.delete(user);

  await seedUser(db, "member");
  [{ id: godot }, { id: blender }, { id: rust }] = await db
    .insert(skills)
    .values([{ name: "Godot" }, { name: "Blender" }, { name: "Rust" }])
    .returning({ id: skills.id });
});

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

describe("setMySkills", () => {
  it("returns the skills in the order it was given", async () => {
    await call(addUserSkill, { skillId: godot }, asUser("member"));
    await call(addUserSkill, { skillId: blender }, asUser("member"));
    await call(addUserSkill, { skillId: rust }, asUser("member"));

    const reordered = await call(
      setMySkills,
      { skillIds: [rust, godot, blender] },
      asUser("member"),
    );

    expect(names(reordered)).toEqual(["Rust", "Godot", "Blender"]);
    // And it survives the write, rather than being a property of the
    // response the client happened to get back.
    expect(
      names(await call(setMySkills, { skillIds: [rust, godot, blender] }, asUser("member"))),
    ).toEqual(["Rust", "Godot", "Blender"]);
  });

  it("appends a newly added skill at the end", async () => {
    await call(setMySkills, { skillIds: [rust, godot] }, asUser("member"));

    const after = await call(addUserSkill, { skillId: blender }, asUser("member"));

    expect(names(after)).toEqual(["Rust", "Godot", "Blender"]);
  });

  it("treats adding a skill twice as the no-op it looks like", async () => {
    await call(addUserSkill, { skillId: godot }, asUser("member"));
    const after = await call(addUserSkill, { skillId: godot }, asUser("member"));

    expect(names(after)).toEqual(["Godot"]);
  });

  it("refuses a skill that doesn't exist, without touching the stored set", async () => {
    await call(setMySkills, { skillIds: [godot] }, asUser("member"));

    await expect(call(setMySkills, { skillIds: [godot, 99999] }, asUser("member"))).rejects.toThrow(
      /do not exist/i,
    );
    expect(names(await call(setMySkills, { skillIds: [godot] }, asUser("member")))).toEqual([
      "Godot",
    ]);
  });

  it("drops the skills left out of the set", async () => {
    await call(setMySkills, { skillIds: [godot, blender, rust] }, asUser("member"));

    expect(names(await call(setMySkills, { skillIds: [blender] }, asUser("member")))).toEqual([
      "Blender",
    ]);
  });
});
