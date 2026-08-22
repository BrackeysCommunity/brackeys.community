/**
 * Drizzle handle for the Bun services, spelled once. Each service passes
 * its own parsed config's DATABASE_URL; the pool cap stays deliberately
 * small — these are batch/cron processes, not request servers.
 *
 * Import-graph neutral like `src/lib/notify-core.ts`: services reach it by
 * relative path, and their Dockerfiles must COPY this file.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createServiceDb(connectionString: string, max = 4) {
  const pool = new pg.Pool({ connectionString, max });
  return { pool, db: drizzle({ client: pool }) };
}
