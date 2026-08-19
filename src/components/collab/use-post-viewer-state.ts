import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useMemo } from "react";

import { activeUserStore } from "@/lib/active-user-store";
import { type StackOverlap, viewerStackOverlap } from "@/lib/stack-overlap";
import { orpc } from "@/orpc/client";

/** The parts of a post this hook needs; `getPost`'s public core supplies both. */
type ViewedPost = { authorId: string; skills: { id: number; name: string }[] } | null | undefined;

/**
 * Everything about a post that depends on *who is looking*, kept out of
 * `getPost` so that response can stay anonymous and edge-cached.
 *
 * Three sources, none of which the anonymous core can carry:
 *
 * - **isOwner** and the match badge are derived, not fetched — the post's
 *   `authorId` and stack are public, and the viewer's own skill ids come
 *   from one session-long `getMySkillIds` read shared with the board.
 * - **The applicant list** comes from `listResponses`, which enforces
 *   owner-or-staff server-side. It is only requested when the viewer plausibly
 *   passes that gate, so ordinary visitors never provoke a 403.
 * - **The viewer's own application** and **the contact block** come from
 *   `getPostViewerState`. Owners fetch it too — they cannot apply to their own
 *   post, but they should see the contact details they published.
 */
export function usePostViewerState(
  postId: number,
  post: ViewedPost,
  currentUserId?: string | null,
) {
  const isStaff = useStore(activeUserStore, (s) => s.profile?.isStaff ?? false);
  const isOwner = Boolean(currentUserId) && Boolean(post) && post?.authorId === currentUserId;
  const canTriage = isOwner || isStaff;

  const responsesQuery = useQuery({
    ...orpc.listResponses.queryOptions({ input: { postId } }),
    enabled: canTriage,
  });

  const viewerStateQuery = useQuery({
    ...orpc.getPostViewerState.queryOptions({ input: { postId } }),
    enabled: Boolean(currentUserId),
  });

  const skillIdsQuery = useQuery({
    ...orpc.getMySkillIds.queryOptions({ input: {} }),
    enabled: Boolean(currentUserId),
    staleTime: 5 * 60 * 1000,
  });

  const viewerOverlap: StackOverlap | null = useMemo(() => {
    if (!post) return null;
    return viewerStackOverlap({
      stack: post.skills,
      viewerSkillIds: skillIdsQuery.data ? new Set(skillIdsQuery.data) : undefined,
      authorId: post.authorId,
      viewerId: currentUserId,
    });
  }, [post, skillIdsQuery.data, currentUserId]);

  return {
    isOwner,
    canTriage,
    responses: responsesQuery.data ?? null,
    viewerResponse: isOwner ? null : (viewerStateQuery.data?.viewerResponse ?? null),
    contact: viewerStateQuery.data?.contact ?? null,
    authorDiscordId: viewerStateQuery.data?.authorDiscordId ?? null,
    authorDiscordUsername: viewerStateQuery.data?.authorDiscordUsername ?? null,
    viewerOverlap,
  };
}
