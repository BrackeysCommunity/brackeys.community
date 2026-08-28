import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { orpc } from "@/orpc/client";

/** What the viewer-state companion contributes to the page's team shape. */
export type TeamViewerState = {
  viewerRole: string | null;
  isOwner: boolean;
  isStaffViewer: boolean;
  viewerInvite: { id: number; message: string | null } | null;
  pendingInvites: {
    id: number;
    inviteeId: string;
    createdAt: string | Date;
    inviteeUsername: string | null;
    inviteeAvatar: string | null;
  }[];
};

const SIGNED_OUT: TeamViewerState = {
  viewerRole: null,
  isOwner: false,
  isStaffViewer: false,
  viewerInvite: null,
  pendingInvites: [],
};

/**
 * The viewer's standing with a team, fetched separately from the team
 * itself so `getTeam` can stay anonymous and edge-cacheable.
 *
 * Returns the signed-out shape while the query is disabled or in flight,
 * which is the same thing the page renders for a visitor: no invite bar, no
 * manage button. The page composes this onto the public core, so every
 * component below it keeps working against one team object.
 *
 * `invalidate` refreshes *both* halves because the actions on this page move
 * both at once: accepting an invite adds you to the roster (public) and
 * clears your invite (private), and inviting someone changes the owner's
 * pending queue while leaving the roster alone.
 */
export function useTeamViewerState(teamId: string, signedIn: boolean) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    ...orpc.getTeamViewerState.queryOptions({ input: { teamId } }),
    enabled: signedIn,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: orpc.getTeam.queryOptions({ input: { teamId } }).queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: orpc.getTeamForInsider.queryOptions({ input: { teamId } }).queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: orpc.getTeamViewerState.queryOptions({ input: { teamId } }).queryKey,
    });
  }, [queryClient, teamId]);

  return { viewerState: data ?? SIGNED_OUT, invalidate };
}
