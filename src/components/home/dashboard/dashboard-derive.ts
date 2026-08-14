/**
 * Pure derivations behind the signed-in home dashboard. Everything here is
 * computed from data the sections already fetch — the "jam clocks" strip is a
 * reading of the viewer's posts and applications rather than an endpoint of
 * its own.
 *
 * What counts as an attention item lives in `@/components/attention` instead:
 * the header badge and the mobile tab dot need the same answer, and this
 * module is the dashboard's alone.
 */

import { EXPIRY_NUDGE_DAYS, DAY_MS } from "@/lib/collab-lifecycle";
import { effectiveJamState } from "@/lib/jam-countdown";

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

/**
 * Whether a post is close enough to expiry to be worth an inline EXTEND.
 * Same window the lifecycle sweep's "closes in N days" nudge uses, so the
 * button and the notification appear together rather than a day apart.
 */
export function isExpiringSoon(
  post: Pick<DashboardPost, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
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
