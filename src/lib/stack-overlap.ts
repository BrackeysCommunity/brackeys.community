/** How a person's skills line up with a post's stack. */
export type StackOverlap = { matched: string[]; missing: string[]; total: number };

/**
 * Shared by both sides of the board: the server still computes it for a
 * post's applicant list (`listResponses`), while the listing computes it in
 * the browser so `listPosts` can stay anonymous and edge-cacheable. One
 * implementation so "you match 3/5" can't mean two different things.
 */
export function stackOverlap(
  stack: { id: number; name: string }[],
  userSkillIds: Set<number> | undefined,
): StackOverlap {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const s of stack) {
    (userSkillIds?.has(s.id) ? matched : missing).push(s.name);
  }
  return { matched, missing, total: stack.length };
}

/**
 * Whether to show a viewer the match hint at all, and what it says.
 *
 * Null in three cases, and they are the reason this is one function rather
 * than a condition written twice: a signed-out visitor has nothing to match
 * against, your own post would only ever tell you about yourself, and a post
 * with no stack has nothing to match. `listPosts` applies this in the
 * browser and `getPost` on the server — they must agree, or the same post
 * gains or loses a badge as you click into it.
 */
export function viewerStackOverlap({
  stack,
  viewerSkillIds,
  authorId,
  viewerId,
}: {
  stack: { id: number; name: string }[];
  viewerSkillIds: Set<number> | undefined;
  authorId: string;
  viewerId: string | null | undefined;
}): StackOverlap | null {
  if (!viewerId || authorId === viewerId || stack.length === 0) return null;
  return stackOverlap(stack, viewerSkillIds);
}
