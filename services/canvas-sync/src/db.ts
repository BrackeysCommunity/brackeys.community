import { createServiceDb } from "../../../src/db/service-client.ts";

/** Stores hold a row lock for the length of a merge, so a few more than the default. */
export function createDb(databaseUrl: string) {
  return createServiceDb(databaseUrl, 8);
}

export type ServiceDb = ReturnType<typeof createDb>["db"];
