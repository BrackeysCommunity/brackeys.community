import { countDistinct, eq } from "drizzle-orm";

import { db } from "@/db";
import { linkedAccounts, teamMembers, user } from "@/db/schema";

/**
 * Stable dimensions attached to a person in PostHog, so a funnel or an
 * insight can be cohorted without any client-side identity work.
 *
 * Refreshed on **session create** rather than at signup: account age, linked
 * forges and team count are all zero on the day someone joins, and a person
 * property that only ever describes the first minute is worse than none.
 * Every sign-in is a fresh read, which is also the cadence that keeps them
 * roughly true for anyone who keeps using the site.
 *
 * These ride as `$set` on the `auth_signed_in` capture rather than as their
 * own `identify` call — same effect, one request instead of two, and they
 * cannot drift from the event that carries them.
 *
 * Deliberately not here: anything a viewer could use to re-identify a person
 * from an analytics export. Names, emails and Discord ids stay on the two
 * properties `identifyUser` already sends.
 */
export interface PersonProperties extends Record<string, unknown> {
  account_age_days: number;
  linked_provider_count: number;
  team_count: number;
}

/**
 * One round trip per sign-in, all three counts in a single statement. The
 * joins are over indexed foreign keys and the row counts per person are tiny
 * (a handful of links, a handful of teams).
 *
 * `developer_profiles.id` is the user id, so `linked_accounts.profile_id` and
 * `team_members.user_id` both key straight off it with no profile lookup.
 * `countDistinct` on the two joined tables is what stops them multiplying
 * each other — a member of three teams with two links would otherwise read as
 * six of each.
 */
export async function personProperties(userId: string): Promise<PersonProperties | null> {
  const [row] = await db
    .select({
      createdAt: user.createdAt,
      linkedProviderCount: countDistinct(linkedAccounts.provider),
      teamCount: countDistinct(teamMembers.teamId),
    })
    .from(user)
    .leftJoin(linkedAccounts, eq(linkedAccounts.profileId, user.id))
    .leftJoin(teamMembers, eq(teamMembers.userId, user.id))
    .where(eq(user.id, userId))
    .groupBy(user.id, user.createdAt);

  if (!row) return null;

  return {
    account_age_days: daysSince(row.createdAt),
    linked_provider_count: Number(row.linkedProviderCount ?? 0),
    team_count: Number(row.teamCount ?? 0),
  };
}

/**
 * Whole days, floored, never negative — a clock skew between the app and the
 * database should read as "joined today", not as a negative age that breaks
 * every cohort boundary above it.
 */
function daysSince(from: Date): number {
  const ms = Date.now() - from.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}
