import { createServiceDb } from "../../../../src/db/service-client.ts";
import { config } from "../config.ts";

// A few more than the cron default: SCAN_CONCURRENCY jobs each hold a
// connection mid-query, plus the dedicated advisory-lock session.
export const { pool, db } = createServiceDb(config.DATABASE_URL, 8);
export type DB = typeof db;
