import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { collabPosts, developerProfiles, user } from "../db/schema";

/**
 * An isolated in-memory Postgres (pglite) with every committed migration
 * applied, for DB-backed tests. Migration ordering comes from the
 * timestamped folder names, same as drizzle-kit v1.
 *
 * Test files swap it in for the app's singleton with:
 *
 *   vi.mock("@/db", async () => {
 *     const { createTestDb } = await import("@/test/db");
 *     return { db: await createTestDb() } as unknown as typeof import("@/db");
 *   });
 *
 * Each call is a fresh database, so parallel test files never share state.
 */
export async function createTestDb() {
  const client = new PGlite();
  // Production Postgres runs in UTC; pglite defaults to the host zone,
  // which skews every `default now()` stamp against JS-side Date math
  // (the notification dedupe window, the sweep cutoffs).
  await client.exec("SET TIME ZONE 'UTC';");
  const migrationsDir = join(process.cwd(), "drizzle");
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8");
    await client.exec(sql);
  }
  return drizzle({ client });
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/** Identity + profile rows in one call — what a signed-in member needs. */
export async function seedUser(
  db: TestDb,
  id: string,
  overrides: Partial<typeof developerProfiles.$inferInsert> = {},
): Promise<string> {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@test.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(developerProfiles).values({
    id,
    discordId: `discord-${id}`,
    discordUsername: id,
    ...overrides,
  });
  return id;
}

/** A minimal recruiting post; returns its id. */
export async function seedCollabPost(
  db: TestDb,
  authorId: string,
  overrides: Partial<typeof collabPosts.$inferInsert> = {},
): Promise<number> {
  const [post] = await db
    .insert(collabPosts)
    .values({
      authorId,
      type: "hobby",
      title: `${authorId}'s post`,
      description: "A test post.",
      contactType: "discord_dm",
      contactMethod: authorId,
      ...overrides,
    })
    .returning({ id: collabPosts.id });
  return post!.id;
}
