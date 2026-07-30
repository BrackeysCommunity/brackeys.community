/**
 * App-side cleanup for better-auth's `deleteUser` flow.
 *
 * better-auth deletes the `user` row itself, which cascades the auth tables
 * (sessions, accounts), notifications, and collab content. What it cannot
 * reach is `developer_profiles` — that table has no FK to `user` — so we
 * remove it here, which in turn cascades skills, skill requests, URL stubs,
 * profile projects, and linked accounts (including stored itch.io tokens).
 *
 * Moderation records (hammer schema) reference `developer_profiles.discord_id`
 * with no delete rule, deliberately: self-serve deletion must not erase
 * infraction or ban history. When such records exist the profile delete hits
 * an FK violation and we fall back to anonymizing the profile — child rows
 * are removed and every personal field is cleared, leaving only the skeleton
 * row (id + discord id) the moderation tables point at.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  developerProfiles,
  linkedAccounts,
  profileProjects,
  profileUrlStubs,
  skillRequests,
  userSkills,
} from "@/db/schema";
import { purgeGuildMemberCache } from "@/lib/discord";
import { removeProfileProjectImageFromStorage } from "@/lib/profile-project-image-storage";

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23503"
  );
}

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

  try {
    await db.delete(developerProfiles).where(eq(developerProfiles.id, userId));
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;

    // Moderation records pin this profile — anonymize instead of delete.
    await db.transaction(async (tx) => {
      await tx.delete(userSkills).where(eq(userSkills.userId, userId));
      await tx.delete(skillRequests).where(eq(skillRequests.userId, userId));
      await tx.delete(profileUrlStubs).where(eq(profileUrlStubs.profileId, userId));
      await tx.delete(profileProjects).where(eq(profileProjects.profileId, userId));
      await tx.delete(linkedAccounts).where(eq(linkedAccounts.profileId, userId));
      await tx
        .update(developerProfiles)
        .set({
          discordUsername: "[deleted]",
          avatarUrl: null,
          guildNickname: null,
          guildJoinedAt: null,
          guildRoles: null,
          bio: null,
          tagline: null,
          githubUrl: null,
          twitterUrl: null,
          websiteUrl: null,
          availableForWork: false,
          availability: null,
          rateType: null,
          rateMin: null,
          rateMax: null,
          updatedAt: new Date(),
        })
        .where(eq(developerProfiles.id, userId));
    });
  }

  if (profile.discordId) await purgeGuildMemberCache(profile.discordId);
}
