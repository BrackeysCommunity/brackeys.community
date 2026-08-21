/**
 * App-side cleanup for better-auth's `deleteUser` flow.
 *
 * better-auth deletes the `user` row itself, which cascades the auth tables
 * (sessions, accounts), notifications, and collab content. What it cannot
 * reach is `developer_profiles` — that table has no FK to `user` — so we
 * remove it here, which in turn cascades skills, skill requests, URL stubs,
 * profile projects, and linked accounts (including stored itch.io tokens).
 *
 * Moderation records (hammer schema) are keyed by Discord snowflake with no
 * FK onto `developer_profiles`, so self-serve deletion never touches them:
 * infraction and ban history stays with the guild while the profile row
 * disappears entirely.
 *
 * **What survives, and why.** Canonical projects are shared entities: other
 * contributors' pages, teams' showcases, and jam backlinks point at them.
 * So deletion reaches the user's *placements* (their own surface rows) and
 * stops there:
 *
 * - `project.projects` — untouched. `profile_projects.project_id` is
 *   `ON DELETE SET NULL` in the other direction, so removing a placement
 *   never reaches the project. An orphaned project is a periodic sweep's
 *   problem, not this flow's.
 * - `project.project_contributors` — the *credit* survives with its
 *   `display_name`; only the live link dies, via `profile_id ON DELETE SET
 *   NULL`. Nothing below deletes these rows, and nothing should: a shipped
 *   credit is history, and the person's name on it is what makes the
 *   project page true.
 * - MinIO objects — the loop below deletes the user's own uploads, which is
 *   safe precisely because a canonical row never references a user-scoped
 *   key (it carries a provider CDN URL, or its own project-scoped upload).
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { comments, developerProfiles, profileProjects } from "@/db/schema";
import { purgeGuildMemberCache } from "@/lib/discord";
import { removeProfileProjectImageFromStorage } from "@/lib/profile-project-image-storage";

export async function cleanupUserData(userId: string): Promise<void> {
  const [profile] = await db
    .select({ discordId: developerProfiles.discordId })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);
  if (!profile) return;

  // Uploaded project images live in MinIO, outside any DB cascade. Collect
  // keys before the rows disappear; removal failures are logged, not fatal —
  // an orphaned object must not block the account deletion itself.
  const projectImages = await db
    .select({ imageKey: profileProjects.imageKey })
    .from(profileProjects)
    .where(eq(profileProjects.profileId, userId));
  for (const { imageKey } of projectImages) {
    if (imageKey) await removeProfileProjectImageFromStorage(imageKey).catch(console.error);
  }

  // Redact the user's comments while `author_id` still points at them —
  // better-auth's user-row delete fires the set-null FK right after this
  // hook, and the rows become unfindable by author. Tombstoned chains
  // survive (replies keep rendering under "Deleted User"); COALESCE keeps
  // the original timestamp/attribution on comments already deleted.
  await db
    .update(comments)
    .set({ content: "", deletedAt: sql`COALESCE(${comments.deletedAt}, now())` })
    .where(eq(comments.authorId, userId));

  await db.delete(developerProfiles).where(eq(developerProfiles.id, userId));

  if (profile.discordId) await purgeGuildMemberCache(profile.discordId);
}
