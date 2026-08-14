/**
 * Pure derivations behind the signed-in home dashboard. Everything here is
 * computed from data the sections already fetch — the "jam deadlines" strip
 * and the attention count are readings of the viewer's posts, applications
 * and invites rather than endpoints of their own.
 */

import { EXPIRY_NUDGE_DAYS, DAY_MS } from "@/lib/collab-lifecycle";
import { effectiveJamState } from "@/lib/jam-countdown";

export type DashboardInvite = {
  id: number;
  status: string;
};

export type DashboardPost = {
  id: number;
  status: string;
  expiresAt: string | Date | null;
  pendingResponseCount: number;
  jam: DashboardJamRef | null;
};

export type DashboardJamRef = {
  jamId: number;
  title: string | null;
  slug: string | null;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
};

/** A jam the viewer has a stake in, plus the milestone it is counting to. */
export type JamDeadline = {
  jam: DashboardJamRef;
  phase: "upcoming" | "running";
  /** Start for an upcoming jam, end for a running one. */
  at: Date;
};

/** Invites still awaiting an answer. */
export function pendingInvites<T extends DashboardInvite>(invites: readonly T[]): T[] {
  return invites.filter((invite) => invite.status === "pending");
}

/** Posts with someone waiting on a decision. */
export function postsAwaitingTriage<T extends DashboardPost>(posts: readonly T[]): T[] {
  return posts.filter((post) => post.pendingResponseCount > 0);
}

/**
 * The single number the attention strip is worth: invites to answer plus
 * applicants to triage. Both are things only the viewer can clear, which is
 * what separates them from the notification inbox's 15 types.
 */
export function attentionCount(
  invites: readonly DashboardInvite[],
  posts: readonly DashboardPost[],
): number {
  return (
    pendingInvites(invites).length +
    posts.reduce((total, post) => total + post.pendingResponseCount, 0)
  );
}

/**
 * Whether a post is close enough to expiry to be worth an inline EXTEND.
 * Same window the lifecycle sweep's "closes in N days" nudge uses, so the
 * button and the notification appear together rather than a day apart.
 */
export function isExpiringSoon(post: DashboardPost, now: Date = new Date()): boolean {
  if (post.status !== "recruiting" || !post.expiresAt) return false;
  const expiry = new Date(post.expiresAt).getTime();
  if (Number.isNaN(expiry)) return false;
  const remaining = expiry - now.getTime();
  return remaining <= EXPIRY_NUDGE_DAYS * DAY_MS;
}

/**
 * Jams the viewer is involved with — through a post they wrote or an
 * application they sent — nearest milestone first.
 *
 * Ended jams drop out: a deadline strip is a list of things still to make,
 * and a finished jam is neither a countdown nor an action. Deduped by jam id
 * because one jam commonly carries several of a viewer's posts.
 */
export function selectJamDeadlines(
  sources: readonly { jam: DashboardJamRef | null }[],
  now: Date = new Date(),
  limit = 4,
): JamDeadline[] {
  const byJamId = new Map<number, JamDeadline>();

  for (const { jam } of sources) {
    if (!jam || byJamId.has(jam.jamId)) continue;
    const state = effectiveJamState(jam.startsAt, jam.endsAt, now);
    if (state !== "upcoming" && state !== "running") continue;
    const target = state === "upcoming" ? jam.startsAt : jam.endsAt;
    if (!target) continue;
    const at = new Date(target);
    if (Number.isNaN(at.getTime())) continue;
    byJamId.set(jam.jamId, { jam, phase: state, at });
  }

  return [...byJamId.values()].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, limit);
}
