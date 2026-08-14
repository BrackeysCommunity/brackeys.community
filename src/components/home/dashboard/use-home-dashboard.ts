import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { authClient } from "@/lib/auth-client";
import useDateNow from "@/lib/hooks/use-date-now";
import { orpc } from "@/orpc/client";

import { attentionCount, selectJamDeadlines } from "./dashboard-derive";

/** The dashboard's numbers move when the viewer acts, not on a timer. */
const STALE_TIME_MS = 30 * 1000;

/**
 * The four viewer-scoped reads behind the signed-in home, plus the two
 * things derived from them.
 *
 * Four parallel queries rather than one `getDashboard` procedure: they have
 * different invalidation triggers (accepting an invite moves invites and
 * teams and nothing else), and `/` is the route where a single fat query
 * blocking on its slowest join is most expensive. If waterfalls ever show up
 * here, batching is the fix — the sections already read from one hook.
 */
export function useHomeDashboard() {
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const now = useDateNow();

  const invites = useQuery({
    ...orpc.listMyInvites.queryOptions({ input: {} }),
    enabled: signedIn,
    staleTime: STALE_TIME_MS,
  });
  const applications = useQuery({
    ...orpc.listMyResponses.queryOptions({ input: {} }),
    enabled: signedIn,
    staleTime: STALE_TIME_MS,
  });
  const posts = useQuery({
    ...orpc.listMyPostsSummary.queryOptions({ input: {} }),
    enabled: signedIn,
    staleTime: STALE_TIME_MS,
  });
  const teams = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: signedIn,
    staleTime: STALE_TIME_MS,
  });

  const inviteList = useMemo(() => invites.data ?? [], [invites.data]);
  const applicationList = useMemo(() => applications.data ?? [], [applications.data]);
  const postList = useMemo(() => posts.data ?? [], [posts.data]);
  const teamList = useMemo(() => teams.data ?? [], [teams.data]);

  // Both halves of "jams I'm on the hook for": a jam the viewer is recruiting
  // for, and one they applied to someone else's post about.
  const jamDeadlines = useMemo(
    () => selectJamDeadlines([...postList, ...applicationList], new Date(now)),
    [postList, applicationList, now],
  );

  /** Accepting an invite lands the viewer on a roster, so both move. */
  const invalidateInvites = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: orpc.listMyInvites.queryOptions({ input: {} }).queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: orpc.listMyTeams.queryOptions({ input: {} }).queryKey,
    });
  }, [queryClient]);

  const invalidatePosts = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: orpc.listMyPostsSummary.queryOptions({ input: {} }).queryKey,
    });
  }, [queryClient]);

  const isPending =
    signedIn && (invites.isPending || applications.isPending || posts.isPending || teams.isPending);

  const hasContent =
    inviteList.length > 0 ||
    applicationList.length > 0 ||
    postList.length > 0 ||
    teamList.length > 0;

  return {
    /** False until the session resolves, so `/` never stalls on auth. */
    signedIn: signedIn && !sessionPending,
    isPending,
    hasContent,
    invites: inviteList,
    applications: applicationList,
    posts: postList,
    teams: teamList,
    jamDeadlines,
    attention: attentionCount(inviteList, postList),
    invalidateInvites,
    invalidatePosts,
  };
}

export type HomeDashboardData = ReturnType<typeof useHomeDashboard>;
