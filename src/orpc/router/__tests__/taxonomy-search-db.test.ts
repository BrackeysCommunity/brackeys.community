import { call } from "@orpc/server";
import { eq, ilike } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { skills, userSkills } from "@/db/schema";
import { unaccented } from "@/lib/sql-fuzzy";
import { escapeLike } from "@/lib/sql-like";
import { listCollabRoles } from "@/orpc/router/collab";
import { listMembers } from "@/orpc/router/member";
import { listSkills } from "@/orpc/router/profile";
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

/** Accent-folded, typo-tolerant search over the seeded skill and role catalogues. */
let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
});

async function skillNames(search: string) {
  const rows = await call(listSkills, { search }, asUser(null));
  return rows.map((s) => s.name);
}

describe("listSkills search", () => {
  it("finds LÖVE without the umlaut", async () => {
    expect(await skillNames("love")).toEqual(["LÖVE"]);
    expect(await skillNames("LÖVE")).toEqual(["LÖVE"]);
  });

  it("finds LÖVE by its community name", async () => {
    expect(await skillNames("love2d")).toContain("LÖVE");
  });

  it("tolerates a typo and ranks the best match first", async () => {
    expect((await skillNames("godto"))[0]).toBe("Godot");
    expect((await skillNames("Unity"))[0]).toBe("Unity");
  });
});

describe("listCollabRoles search", () => {
  it("tolerates a typo", async () => {
    const rows = await call(listCollabRoles, { search: "pixle artist" }, asUser(null));
    expect(rows[0]?.name).toBe("Pixel Artist");
  });
});

describe("listMembers search by skill", () => {
  it("reaches accented skill names", async () => {
    await seedUser(db, "love-dev", { discordUsername: "Someone" });
    const [love] = await db.select().from(skills).where(eq(skills.name, "LÖVE"));
    await db.insert(userSkills).values({ userId: "love-dev", skillId: love.id });

    const { members } = await call(
      listMembers,
      { search: "love", limit: 50, offset: 0 },
      asUser(null),
    );
    expect(members.map((m) => m.id)).toContain("love-dev");
  });
});

describe("vocabulary duplicate guard", () => {
  it("treats an unaccented spelling as the same name", async () => {
    const [match] = await db
      .select({ name: skills.name })
      .from(skills)
      .where(ilike(unaccented(skills.name), unaccented(escapeLike("love"))));
    expect(match?.name).toBe("LÖVE");
  });
});
