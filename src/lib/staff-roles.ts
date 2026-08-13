import { eq } from "drizzle-orm";

import { db } from "@/db";
import { developerProfiles } from "@/db/schema";
import { applyRoleOverrides } from "@/lib/discord";

/**
 * A user's effective role names: the guild roles cached at their last
 * Discord sync, plus any `ADMIN_DISCORD_IDS` override.
 *
 * The override is applied *here*, at authorization time, rather than when
 * roles sync. A break-glass that depends on a successful Discord
 * round-trip having landed in the cache isn't one — it would be defeated
 * by the very outages it exists for, and it can't bootstrap a user who
 * holds no guild role (the throttled re-sync only fires from staff-gated
 * middleware, so someone locked out could never trigger it). Keeping it
 * out of the write path also leaves `developer_profiles.guildRoles` a
 * faithful mirror of Discord.
 *
 * Null when the user has no profile row at all.
 */
export async function resolveUserRoles(userId: string): Promise<string[] | null> {
  const [profile] = await db
    .select({
      guildRoles: developerProfiles.guildRoles,
      discordId: developerProfiles.discordId,
    })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);

  if (!profile) return null;
  return applyRoleOverrides(profile.discordId, profile.guildRoles ?? []);
}
