/**
 * itch.io identity normalization. Pure — no database, no environment.
 *
 * Lives on its own because three places need the same comparison and one of
 * them (`project-sync.ts`) is imported by the `itchio-library-sync` service:
 * the jam participation match, the contributor→profile match in the backfill,
 * and the canonical credits written by the syncs. A second spelling of "is
 * this the same itch account" is how those three quietly disagree.
 */

/** Lowercase + strip trailing slashes so canonical itch URLs compare equal. */
export function normalizeItchProfileUrl(url: string | null | undefined): string | null {
  const normalized = url?.trim().toLowerCase().replace(/\/+$/, "");
  return normalized ? normalized : null;
}
