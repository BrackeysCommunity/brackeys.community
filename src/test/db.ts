import { openAsBlob } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { drizzle } from "drizzle-orm/pglite";

import { collabPosts, developerProfiles, user } from "../db/schema";
import { ensureSnapshot } from "./db-snapshot";

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
 * Every database restores from one migrated snapshot (see `db-snapshot.ts`)
 * rather than replaying the migrations: files that build a database per
 * test were timing out in the setup hook under full-suite load on the
 * replay cost alone.
 */
export async function createTestDb() {
  snapshot ??= ensureSnapshot().then((path) => openAsBlob(path));
  // Extensions the migrations `CREATE`: pglite only knows the ones it is
  // handed at construction, restored data dir included.
  const client = new PGlite({ loadDataDir: await snapshot, extensions: { pg_trgm, unaccent } });
  await client.waitReady;
  // Production Postgres runs in UTC; pglite defaults to the host zone,
  // which skews every `default now()` stamp against JS-side Date math
  // (the notification dedupe window, the sweep cutoffs). Session-scoped,
  // so the restored data dir does not carry it.
  await client.exec("SET TIME ZONE 'UTC';");
  return drizzle({ client });
}

let snapshot: Promise<Blob> | undefined;

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
