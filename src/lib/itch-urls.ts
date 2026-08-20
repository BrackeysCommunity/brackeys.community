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

/**
 * Jam slugs an itch.io game page declares itself submitted to, read off the
 * `Submission to <jam>` action button:
 *
 *   <li class="jam_entry"><a href="https://itch.io/jam/candyjam/rate/1287">
 *
 * The itch OAuth API exposes no jam data at all, so a member's game page is
 * the only place this association can be read for a jam the scraper hasn't
 * discovered. Matching on the game's own id keeps stray `/rate/` links
 * elsewhere on the page (devlogs, comments) out of the result.
 */
export function parseJamSubmissionSlugs(html: string, gameId: number): string[] {
  const pattern = /itch\.io\/jam\/([A-Za-z0-9._-]+)\/rate\/(\d+)/g;
  const slugs = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    if (match[1] && Number(match[2]) === gameId) slugs.add(match[1].toLowerCase());
  }
  return [...slugs];
}
