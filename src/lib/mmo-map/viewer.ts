import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";

export type MapIdentity =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string; discordId?: string };

const ANONYMOUS: MapIdentity = { kind: "anonymous" };

/**
 * Who is looking at the map, from the session alone (GDD 4.12): characters
 * are keyed by Discord id, so a user with no Discord link sees no live layer.
 * An unreadable session or a banned user is anonymous.
 */
export async function mapViewer(request: Request): Promise<MapIdentity> {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session || isActiveBan(session.user)) return ANONYMOUS;
  const userId = session.user.id;
  const rows = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "discord")))
    .limit(1)
    .catch(() => []);
  const discordId = rows[0]?.accountId;
  return discordId ? { kind: "user", userId, discordId } : { kind: "user", userId };
}
