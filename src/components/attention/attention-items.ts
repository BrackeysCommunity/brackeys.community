/**
 * What "needs you" means, in one place.
 *
 * Three surfaces read this — the home dashboard's strip, the header's
 * attention menu, and the mobile tab bar's dot — and they must agree, or the
 * badge says 2 while the strip shows 3 and neither is trustworthy.
 *
 * The rule: an attention item is something only the viewer can clear, and
 * that no amount of reading clears. That is what separates it from the
 * notification bell, which counts events you haven't *looked* at. Reading a
 * "you've been invited" notification empties the bell; it does not answer the
 * invite, so it does not empty this.
 */

export type AttentionInvite = {
  id: number;
  status: string;
};

export type AttentionPost = {
  id: number;
  pendingResponseCount: number;
};

/** Invites still awaiting an answer. */
export function pendingInvites<T extends AttentionInvite>(invites: readonly T[]): T[] {
  return invites.filter((invite) => invite.status === "pending");
}

/** Posts with someone waiting on a decision. */
export function postsAwaitingTriage<T extends AttentionPost>(posts: readonly T[]): T[] {
  return posts.filter((post) => post.pendingResponseCount > 0);
}

/**
 * The single number worth badging: invites to answer plus applicants to
 * triage. Applicants are counted individually rather than per post — five
 * people waiting is five decisions, however few posts they landed on.
 */
export function attentionCount(
  invites: readonly AttentionInvite[],
  posts: readonly AttentionPost[],
): number {
  return (
    pendingInvites(invites).length +
    postsAwaitingTriage(posts).reduce((total, post) => total + post.pendingResponseCount, 0)
  );
}

/** Stable identity for an invite, so a dismissal can name it. */
export function inviteAttentionKey(invite: { id: number }): string {
  return `invite:${invite.id}`;
}

/**
 * A triage item's key carries its count. Dismissing "3 applicants waiting on
 * post 12" stores `post:12:3`; a fourth applicant makes the key `post:12:4`,
 * which was never dismissed, so the row returns.
 *
 * That versioning is the whole reason dismissal is safe here. A key of just
 * `post:12` would let a dismissal made this morning silently swallow someone
 * who applied this afternoon — the one failure this feature must not have.
 */
export function triageAttentionKey(post: AttentionPost): string {
  return `post:${post.id}:${post.pendingResponseCount}`;
}

export type VisibleAttention<I, P> = {
  invites: I[];
  posts: P[];
  /** How many outstanding items the viewer has dismissed out of sight. */
  hiddenCount: number;
};

/**
 * The outstanding items minus the ones the viewer has waved away. Returns the
 * hidden tally too: a dismissal must be visibly reversible, or the strip
 * becomes a place where things quietly disappear.
 */
export function visibleAttention<
  I extends AttentionInvite & { id: number },
  P extends AttentionPost,
>(
  invites: readonly I[],
  posts: readonly P[],
  dismissed: ReadonlySet<string>,
): VisibleAttention<I, P> {
  const outstandingInvites = pendingInvites(invites);
  const outstandingPosts = postsAwaitingTriage(posts);

  const visibleInvites = outstandingInvites.filter(
    (invite) => !dismissed.has(inviteAttentionKey(invite)),
  );
  const visiblePosts = outstandingPosts.filter((post) => !dismissed.has(triageAttentionKey(post)));

  return {
    invites: visibleInvites,
    posts: visiblePosts,
    hiddenCount:
      outstandingInvites.length -
      visibleInvites.length +
      (outstandingPosts.length - visiblePosts.length),
  };
}
