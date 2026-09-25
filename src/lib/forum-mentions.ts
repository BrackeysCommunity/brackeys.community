/**
 * `@handle` mentions, where a handle is a profile url stub (see
 * `url-stub.ts`) — the one name a member picks and the one their profile
 * URL already uses. Pure and client-safe: the renderer links the same
 * handles the server notifies.
 */

const HANDLE = "[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]";

/** An `@handle` not glued to a word, an email address or a path before it. */
export const MENTION_PATTERN = new RegExp(`(^|[^\\w@/.])@(${HANDLE})(?![\\w-])`, "gi");

/** Mentions one post or comment can notify. */
export const MAX_MENTIONS = 10;

/** Code is quoted, not addressed: fenced blocks and inline spans don't mention. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

/** The distinct handles in `text`, lowercased, first `MAX_MENTIONS` only. */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of stripCode(text).matchAll(MENTION_PATTERN)) {
    found.add(match[2]!.toLowerCase());
    if (found.size >= MAX_MENTIONS) break;
  }
  return [...found];
}

/** Handles in `after` that `before` didn't have — an edit only pings the new ones. */
export function addedMentions(before: string | null, after: string): string[] {
  const had = new Set(before ? extractMentions(before) : []);
  return extractMentions(after).filter((handle) => !had.has(handle));
}
