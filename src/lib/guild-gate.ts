import { ORPCError } from "@orpc/client";

/** What `requireGuildMember` and `forumWrite` refuse a non-member with. */
export const NOT_GUILD_MEMBER_MESSAGE =
  "You must be a member of the Brackeys Discord server to perform this action.";

/**
 * The guild bar's refusal, as distinct from every other FORBIDDEN (a ban,
 * a staff-only category, someone else's post). The client answers this one
 * with the Join Discord modal rather than a toast.
 */
export function isNotGuildMemberError(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    error.code === "FORBIDDEN" &&
    error.message === NOT_GUILD_MEMBER_MESSAGE
  );
}
