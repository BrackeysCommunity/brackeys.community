import { eq } from "drizzle-orm";

import { db } from "@/db";
import { teams } from "@/db/schema";

/**
 * Bumps a team's `last_activity_at` — the signal the lifecycle sweep and
 * `/teams` discovery ordering both read. Call it from anything that
 * counts as the team being alive: post create/reopen/extend, member
 * join/leave/invite, showcase changes, settings saves. Keeping every
 * writer here means the sweep stays a pure reader.
 *
 * Null-tolerant so callers can pass an optional link straight through.
 */
export async function touchTeamActivity(teamId: string | null | undefined): Promise<void> {
  if (!teamId) return;
  await db.update(teams).set({ lastActivityAt: new Date() }).where(eq(teams.id, teamId));
}
