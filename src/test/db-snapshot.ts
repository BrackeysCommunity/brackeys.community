import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

/**
 * The migrated pglite data dir as a tarball on disk, keyed by the content
 * of the migrations. Built once per checkout state — by the global setup
 * ahead of the workers, or lazily by the first caller — and restored by
 * every `createTestDb()` after that, which is several times cheaper than
 * replaying the migrations.
 */
const CACHE_DIR = join(process.cwd(), "node_modules", ".cache", "brackeys-test-db");

function migrations(): { folder: string; sql: string }[] {
  const dir = join(process.cwd(), "drizzle");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((folder) => ({ folder, sql: readFileSync(join(dir, folder, "migration.sql"), "utf8") }));
}

export async function ensureSnapshot(): Promise<string> {
  const files = migrations();
  const hash = createHash("sha1");
  for (const { folder, sql } of files) hash.update(folder).update("\0").update(sql).update("\0");
  const path = join(CACHE_DIR, `${hash.digest("hex")}.tar`);
  if (existsSync(path)) return path;

  // Extensions the migrations `CREATE`: pglite only knows the ones it is
  // handed at construction.
  const client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("SET TIME ZONE 'UTC';");
  for (const { sql } of files) await client.exec(sql);
  const blob = await client.dumpDataDir("none");
  await client.close();

  mkdirSync(CACHE_DIR, { recursive: true });
  for (const stale of readdirSync(CACHE_DIR)) rmSync(join(CACHE_DIR, stale), { force: true });
  // Written beside then renamed so a worker racing the build never reads a
  // partial tarball.
  const partial = `${path}.${process.pid}.partial`;
  writeFileSync(partial, Buffer.from(await blob.arrayBuffer()));
  renameSync(partial, path);
  return path;
}
