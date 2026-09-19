import { ensureSnapshot } from "./db-snapshot";

/** Builds the migrated test-database snapshot once, before any worker needs it. */
export default async function setup(): Promise<void> {
  await ensureSnapshot();
}
