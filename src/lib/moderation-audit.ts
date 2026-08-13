import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  developerProfiles,
  moderationActions,
  type ModerationActionType,
  type ModerationTargetType,
} from "@/db/schema";

/**
 * The site's moderation log. Every staff action writes one row here, and
 * every write is best-effort: an action that already landed in the DB must
 * never report failure because the logging leg did. That trade is
 * deliberate — a missing log line is recoverable, a removal that reports
 * failure after succeeding is not.
 *
 * Distinct from the removal notification, which is the user's copy and
 * theirs to delete. This is the one that answers "why did this come down"
 * in six months.
 */
export type ModerationLogEntry = {
  action: ModerationActionType;
  actorId: string;
  targetType: ModerationTargetType;
  targetId?: string | number | null;
  /** Whose stuff was acted on, when there is one. */
  subjectUserId?: string | null;
  reason?: string | null;
  /** Names, titles, previous values — whatever keeps the row readable once
   * the target row is gone. */
  metadata?: Record<string, unknown>;
};

async function actorName(actorId: string): Promise<string | null> {
  const [profile] = await db
    .select({
      discordUsername: developerProfiles.discordUsername,
      guildNickname: developerProfiles.guildNickname,
    })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, actorId))
    .limit(1);
  return profile?.guildNickname ?? profile?.discordUsername ?? null;
}

export async function recordModerationAction(entry: ModerationLogEntry): Promise<void> {
  try {
    await db.insert(moderationActions).values({
      action: entry.action,
      actorId: entry.actorId,
      // Snapshotted so the row stays readable if the account is later
      // deleted and the FK nulls out.
      actorName: await actorName(entry.actorId),
      subjectUserId: entry.subjectUserId ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId == null ? null : String(entry.targetId),
      reason: entry.reason?.trim() || null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.warn("[moderation-audit] failed to record action", { action: entry.action, err });
  }
}
