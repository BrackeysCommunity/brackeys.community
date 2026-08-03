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
