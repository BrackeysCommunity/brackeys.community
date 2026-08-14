import { count } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { collabRoles, skills, threads, user } from "@/db/schema";
import { createTestDb, seedUser } from "@/test/db";

describe("pglite test harness", () => {
  it("applies every committed migration, seeds included", async () => {
    const db = await createTestDb();

    const [roles] = await db.select({ value: count() }).from(collabRoles);
    expect(roles!.value).toBeGreaterThan(0);

    const [skillRows] = await db.select({ value: count() }).from(skills);
    expect(skillRows!.value).toBeGreaterThan(0);
  });

  it("round-trips a seeded user and enforces the schema's constraints", async () => {
    const db = await createTestDb();
    await seedUser(db, "alice");

    const rows = await db.select().from(user);
    expect(rows.map((r) => r.id)).toEqual(["alice"]);

    // The social layer's partial unique indexes made it into the DDL: a
    // second thread for the same subject must conflict, not duplicate.
    await db.insert(threads).values({ subjectType: "profile", profileUserId: "alice" });
    await expect(
      db.insert(threads).values({ subjectType: "profile", profileUserId: "alice" }),
    ).rejects.toThrow();
  });
});
