import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAttention } from "@/components/attention/use-attention";
import useDateNow from "@/lib/hooks/use-date-now";
import { orpc } from "@/orpc/client";

import { selectJamDeadlines } from "./dashboard-derive";

/** The dashboard's numbers move when the viewer acts, not on a timer. */
const STALE_TIME_MS = 30 * 1000;

/**
 * The four viewer-scoped reads behind the signed-in home, plus the two
 * things derived from them.
 *
 * Invites and posts come from `useAttention` — the same hook the header badge
 * and the mobile tab dot read — so the three surfaces can never report
 * different numbers. The two queries here are the dashboard's alone.
 *
 * Parallel queries rather than one `getDashboard` procedure: they have
 * different invalidation triggers (answering an invite moves invites and
 * teams and nothing else), and `/` is the route where a single fat query
 * blocking on its slowest join is most expensive. If waterfalls ever show up
 * here, batching is the fix — the sections already read from one hook.
 */
export function useHomeDashboard() {
  const attention = useAttention();
  const now = useDateNow();

  const applications = useQuery({
    ...orpc.listMyResponses.queryOptions({ input: {} }),
    enabled: attention.signedIn,
    staleTime: STALE_TIME_MS,
  });
  const teams = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: attention.signedIn,
    staleTime: STALE_TIME_MS,
  });
  const watchedJams = useQuery({
    ...orpc.listMyJamWatches.queryOptions({ input: { scope: "upcoming", limit: 8 } }),
    enabled: attention.signedIn,
    staleTime: STALE_TIME_MS,
  });

  const applicationList = useMemo(() => applications.data ?? [], [applications.data]);
  const teamList = useMemo(() => teams.data ?? [], [teams.data]);
  const watchedJamList = useMemo(() => watchedJams.data?.jams ?? [], [watchedJams.data]);

  // Both halves of "jams I'm on the hook for": a jam the viewer is recruiting
  // for, and one they applied to someone else's post about.
  const jamDeadlines = useMemo(
    () => selectJamDeadlines([...attention.posts, ...applicationList], new Date(now)),
    [attention.posts, applicationList, now],
  );

  const isPending =
    attention.signedIn &&
    (attention.isPending || applications.isPending || teams.isPending || watchedJams.isPending);

  const hasContent =
    attention.invites.length > 0 ||
    applicationList.length > 0 ||
    attention.posts.length > 0 ||
    teamList.length > 0 ||
    watchedJamList.length > 0;

  return {
    /** False until the session resolves, so `/` never stalls on auth. */
    signedIn: attention.signedIn,
    isPending,
    hasContent,
    attention,
    applications: applicationList,
    posts: attention.posts,
    teams: teamList,
    jamDeadlines,
    watchedJams: watchedJamList,
  };
}

export type HomeDashboardData = ReturnType<typeof useHomeDashboard>;
