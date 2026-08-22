import { eq } from "drizzle-orm";

import { db } from "@/db";
import { developerProfiles, user } from "@/db/schema";
import { isActiveBan } from "@/lib/ban-state";
import { isGuildBanned } from "@/lib/discord";
import { recordModerationAction } from "@/lib/moderation-audit";
import { bestEffort } from "@/lib/posthog-server";

export const GUILD_BAN_REASON = "Banned from the Brackeys Discord server.";

/**
 * Mirrors a Discord guild ban into the app's own ban fields. Runs on session
 * create, after the profile sync has resolved the Discord id; best-effort, since
 * sign-in must not fail because Discord did. Asymmetric — a guild *un*ban
 * doesn't clear this, staff lift it from `/admin`.
 */
export async function applyGuildBanOnSignIn(userId: string): Promise<boolean> {
  // Fail-open is the deliberate trade (sign-in over ban enforcement), which
  // is exactly why a failure here must be reported: a broken check means
  // guild-banned users are passing the gate.
  const applied = await bestEffort("guild_ban_gate.check", { user_id: userId }, async () => {
    const [row] = await db
      .select({
        discordId: developerProfiles.discordId,
        bannedAt: user.bannedAt,
        bannedUntil: user.bannedUntil,
        unbannedAt: user.unbannedAt,
      })
      .from(user)
      .leftJoin(developerProfiles, eq(developerProfiles.id, user.id))
      .where(eq(user.id, userId))
      .limit(1);

    if (!row?.discordId) return false;
    // Re-stamping would reset a duration staff chose.
    if (isActiveBan(row)) return false;
    if (!(await isGuildBanned(row.discordId))) return false;

    const now = new Date();
    await db
      .update(user)
      .set({
        bannedAt: now,
        bannedUntil: null,
        unbannedAt: null,
        banReason: GUILD_BAN_REASON,
        bannedById: null,
        updatedAt: now,
      })
      .where(eq(user.id, userId));

    await recordModerationAction({
      action: "user_banned",
      actorId: null,
      targetType: "user",
      targetId: userId,
      subjectUserId: userId,
      reason: GUILD_BAN_REASON,
      metadata: { source: "discord_guild_ban", discordId: row.discordId },
    });

    return true;
  });
  return applied ?? false;
}
