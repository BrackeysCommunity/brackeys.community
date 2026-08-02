/**
 * How a user turns into a `/profile/$userId` link. The route resolves
 * either a raw id or a vanity stub server-side, so prefer whatever handle
 * the user claimed and fall back to the id. Lives in `lib/` because the
 * header, the user menu, and the collab surfaces all need it — it used to
 * be re-derived inline at each of them.
 */

interface ProfileLinkTarget {
  id: string;
  urlStub?: string | null;
}

/** The `$userId` path segment for a user. */
export function profileSlug(user: ProfileLinkTarget): string {
  // `||` not `??`: an empty stub is not a claimed handle.
  return user.urlStub || user.id;
}

/** Route params object for TanStack Router's `to="/profile/$userId"`. */
export function profileLinkParams(user: ProfileLinkTarget) {
  return { userId: profileSlug(user) };
}
