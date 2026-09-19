/**
 * Postgres error codes, read through whatever has wrapped them.
 *
 * Imported relatively by `project-sync.ts`, which the itchio-scraper crawler
 * copies into its image and runs under bun with no bundler — so: no `@/`
 * imports, nothing beyond the standard library, and a matching COPY line in
 * `services/itchio-scraper/Dockerfile`.
 */

/** `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/** How far down a `cause` chain to look before giving up. */
const MAX_DEPTH = 5;

/**
 * True when `error`, or anything it wraps, is a Postgres unique violation.
 *
 * The chain walk is the whole point. Drizzle wraps every query failure in a
 * `DrizzleQueryError` that carries the driver's error on `cause` and sets no
 * `code` of its own, so testing the outer error alone quietly stopped
 * matching when that wrapper arrived. Three separate call sites had written
 * the same outer-only check, which left every one of their retry paths
 * unreachable: the project sync's slug retry and game-id read-back both died
 * that way, and the collisions surfaced as raw `DrizzleQueryError`s instead.
 *
 * Reaching for `.cause` exactly once would only move the assumption one
 * level down — nothing promises the wrapper stays a single layer deep.
 */
export function isUniqueViolation(error: unknown): boolean {
  let cursor: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && cursor != null; depth++) {
    if (typeof cursor !== "object") return false;
    if ((cursor as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}
