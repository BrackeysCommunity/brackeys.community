import { createServiceDb } from "../../../../src/db/service-client.ts";
import { config } from "../config.ts";

export const { pool, db } = createServiceDb(config.DATABASE_URL);
export type DB = typeof db;
