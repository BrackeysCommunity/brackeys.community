/**
 * How a team turns into a `/teams/$teamId` link. Teams bake their slug
 * into the row (unlike profiles, whose vanity stubs live in a side
 * table), so the slug always exists — the id fallback only matters for
 * rows created before a rename settles. Mirrors `profile-links.ts`,
 * which exists for the same reason: link derivation kept getting
 * re-derived inline.
 */

interface TeamLinkTarget {
  id: string;
  slug?: string | null;
}

/** The `$teamId` path segment for a team. */
export function teamSlug(team: TeamLinkTarget): string {
  // `||` not `??`: an empty slug is not a handle.
  return team.slug || team.id;
}

/** Route params object for TanStack Router's `to="/teams/$teamId"`. */
export function teamLinkParams(team: TeamLinkTarget) {
  return { teamId: teamSlug(team) };
}

/**
 * The slug a team name becomes: kebab-case, degenerate names falling back
 * to a generic stem. The server suffixes -2, -3… past collisions; the
 * client uses the bare form to preview the page a name would get.
 */
export function slugifyTeamName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  // Too short/degenerate names ("!!", "无") fall back to a generic stem.
  return base.length >= 3 ? base : `team${base ? `-${base}` : ""}`;
}
