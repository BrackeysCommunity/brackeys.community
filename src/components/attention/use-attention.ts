import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { attentionCount, visibleAttention } from "./attention-items";
import { useDismissedAttention } from "./dismissed-attention";

/** These numbers move when the viewer acts, not on a timer. */
const STALE_TIME_MS = STALE.viewer;

/**
 * The two viewer-scoped reads every attention surface needs, plus the
 * dismissal filter applied on top.
 *
 * Deliberately the same query keys the home dashboard uses, so mounting the
 * header's menu on `/` costs nothing: TanStack dedupes them into one fetch
 * each. That is also why the dashboard composes this hook instead of
 * declaring the same two queries again — two declarations would be two
 * chances to pass a different input and quietly split the cache entry.
 */
export function useAttention() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const dismissed = useDismissedAttention();

  const invitesQuery = useQuery({
    ...orpc.listMyInvites.queryOptions({ input: {} }),
    enabled: signedIn,
    staleTime: STALE_TIME_MS,
  });
  const postsQuery = useQuery({
    ...orpc.listMyPostsSummary.queryOptions({ input: {} }),
    enabled: signedIn,
    staleTime: STALE_TIME_MS,
  });

  const invites = useMemo(() => invitesQuery.data ?? [], [invitesQuery.data]);
  const posts = useMemo(() => postsQuery.data ?? [], [postsQuery.data]);

  const visible = useMemo(
    () => visibleAttention(invites, posts, dismissed),
    [invites, posts, dismissed],
  );

  /** Answering an invite lands the viewer on a roster, so teams move too. */
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

  return {
    signedIn,
    isPending: signedIn && (invitesQuery.isPending || postsQuery.isPending),
    /** Every invite, settled ones included — the strip wants only the
     *  outstanding ones, but the dashboard shows recent history too. */
    invites,
    posts,
    /** Outstanding, minus what the viewer dismissed. */
    visibleInvites: visible.invites,
    visibleTriage: visible.posts,
    hiddenCount: visible.hiddenCount,
    /** What the badge shows: dismissals lower it, or the badge and the
     *  strip would tell the viewer two different numbers. */
    count: attentionCount(visible.invites, visible.posts),
    invalidateInvites,
    invalidatePosts,
  };
}

export type AttentionData = ReturnType<typeof useAttention>;
