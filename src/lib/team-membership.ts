import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { canOverride, type ModPowerAction } from "@/lib/moderation-policy";

export type OverrideCaller = { user: { id: string }; isStaff: boolean; isAdmin: boolean };

export async function getMembership(teamId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return membership ?? null;
}

export async function requireMembership(teamId: string, userId: string) {
  const membership = await getMembership(teamId, userId);
  if (!membership) {
    throw new ORPCError("FORBIDDEN", { message: "You are not a member of this team." });
  }
  return membership;
}

export async function requireOwnership(teamId: string, userId: string) {
  const membership = await requireMembership(teamId, userId);
  if (membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", { message: "Only the team owner can do that." });
  }
  return membership;
}

/**
 * Owner passes as themselves (unlogged, whatever roles they hold); staff
 * and admins pass as an override when `MOD_POWERS` admits them. Everyone
 * else gets the exact pre-override refusals.
 */
export async function requireOwnershipOrOverride(
  action: ModPowerAction,
  teamId: string,
  context: OverrideCaller,
) {
  const membership = await getMembership(teamId, context.user.id);
  if (membership?.role === "owner") return { membership, isOverride: false as const };
  if (canOverride(action, context)) return { membership, isOverride: true as const };
  if (!membership) {
    throw new ORPCError("FORBIDDEN", { message: "You are not a member of this team." });
  }
  throw new ORPCError("FORBIDDEN", { message: "Only the team owner can do that." });
}

export async function requireMembershipOrOverride(
  action: ModPowerAction,
  teamId: string,
  context: OverrideCaller,
) {
  const membership = await getMembership(teamId, context.user.id);
  if (membership) return { membership, isOverride: false as const };
  if (canOverride(action, context)) return { membership: null, isOverride: true as const };
  throw new ORPCError("FORBIDDEN", { message: "You are not a member of this team." });
}
