import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.ts";
import * as schema from "../../../../src/db/schema.ts";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 4,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
