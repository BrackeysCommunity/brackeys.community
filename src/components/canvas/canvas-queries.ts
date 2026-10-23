import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export type CanvasScope = { kind: "personal" } | { kind: "team"; teamId: string };
export type CanvasDetail = Awaited<ReturnType<typeof client.getCanvas>>;
export type CanvasListItem = Awaited<ReturnType<typeof client.listCanvases>>[number];
export type CanvasEntity = NonNullable<
  Awaited<ReturnType<typeof client.getCanvasEntities>>[number]
>;
export type CanvasAttachmentMap = CanvasDetail["attachments"];

export const PERSONAL_SCOPE: CanvasScope = { kind: "personal" };

export function scopeKey(scope: CanvasScope): string {
  return scope.kind === "team" ? `team:${scope.teamId}` : "personal";
}

export function canvasQueryOptions(canvasId: string) {
  return { ...orpc.getCanvas.queryOptions({ input: { canvasId } }), staleTime: STALE.viewer };
}

export function canvasScopesQueryOptions() {
  return { ...orpc.listCanvasScopes.queryOptions({ input: {} }), staleTime: STALE.listing };
}

export function canvasListQueryOptions(
  scope: CanvasScope,
  options: {
    deleted?: boolean;
    thumbnails?: boolean;
    limit?: number;
    orderBy?: "path" | "edited";
  } = {},
) {
  return {
    ...orpc.listCanvases.queryOptions({ input: { scope, ...options } }),
    staleTime: STALE.viewer,
  };
}

export function recentCanvasesQueryOptions(scope?: CanvasScope) {
  return {
    ...orpc.listRecentCanvases.queryOptions({ input: { scope } }),
    staleTime: STALE.viewer,
  };
}

export type LiveCanvas = Awaited<ReturnType<typeof client.listLiveCanvases>>[number];

/** How often an open "Live now" list re-reads who is where. */
export const LIVE_POLL_MS = 15_000;

/** The viewer's canvases others have open now; polled while something shows it. */
export function liveCanvasesQueryOptions(scope?: CanvasScope) {
  return {
    ...orpc.listLiveCanvases.queryOptions({ input: { scope } }),
    staleTime: LIVE_POLL_MS,
    refetchInterval: LIVE_POLL_MS,
  };
}

export type CanvasPresence = Awaited<ReturnType<typeof client.getCanvasPresence>>;

/**
 * Who has a canvas open, polled while shown. A reader passes its tab's
 * `viewer` id, which counts it when signed out.
 */
export function canvasPresenceQueryOptions(canvasId: string, viewer?: string) {
  return {
    ...orpc.getCanvasPresence.queryOptions({ input: { canvasId, viewer } }),
    staleTime: LIVE_POLL_MS,
    refetchInterval: LIVE_POLL_MS,
  };
}

export function canvasVersionsQueryOptions(canvasId: string) {
  return {
    ...orpc.listCanvasVersions.queryOptions({ input: { canvasId } }),
    staleTime: STALE.viewer,
  };
}

/** Every canvas listing and the Recent list, after a create, move or delete. */
function invalidateCanvasLists(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.listCanvases.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.listRecentCanvases.key() }),
  ]);
}

export function useCreateCanvas() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: { scope: CanvasScope; path: string }) => client.createCanvas(input),
    onSuccess: async ({ id }) => {
      await invalidateCanvasLists(queryClient);
      await navigate({ to: "/canvases/$canvasId", params: { canvasId: id } });
    },
    onError: toastMutationError("canvas.create", "Couldn't create the canvas."),
  });
}

export function useMoveCanvas(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => client.moveCanvas({ canvasId, path }),
    onSuccess: async () => {
      await Promise.all([
        invalidateCanvasLists(queryClient),
        queryClient.invalidateQueries({ queryKey: canvasQueryOptions(canvasId).queryKey }),
      ]);
    },
    onError: toastMutationError("canvas.move", "Couldn't rename the canvas."),
  });
}

export function useDeleteCanvas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canvasId: string) => client.deleteCanvas({ canvasId }),
    onSuccess: async () => {
      await invalidateCanvasLists(queryClient);
      toast.success("Moved to Recently deleted.");
    },
    onError: toastMutationError("canvas.delete", "Couldn't delete the canvas."),
  });
}

export function useRestoreCanvas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canvasId: string) => client.restoreCanvas({ canvasId }),
    onSuccess: async ({ path }) => {
      await invalidateCanvasLists(queryClient);
      toast.success(`Restored as ${path}.`);
    },
    onError: toastMutationError("canvas.restore", "Couldn't restore the canvas."),
  });
}

export function useOpenJamPlan() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { jamId: number; scope: CanvasScope }) => client.openJamPlanCanvas(input),
    onSuccess: async ({ id, created }) => {
      if (created) await invalidateCanvasLists(queryClient);
      await navigate({ to: "/canvases/$canvasId", params: { canvasId: id } });
    },
    onError: toastMutationError("canvas.jam_plan", "Couldn't open the plan."),
  });
}

// ── Sharing and moderation ───────────────────────────────────────────────────

export type CanvasVisibility = "private" | "team" | "unlisted" | "public";
export type CanvasMemberRole = "editor" | "viewer";
export type CanvasMember = Awaited<ReturnType<typeof client.listCanvasMembers>>[number];
export type SharedCanvas = Awaited<ReturnType<typeof client.listSharedCanvases>>[number];
export type PublicCanvasListItem = Awaited<ReturnType<typeof client.listPublicCanvases>>[number];

export function canvasMembersQueryOptions(canvasId: string) {
  return {
    ...orpc.listCanvasMembers.queryOptions({ input: { canvasId } }),
    staleTime: STALE.viewer,
  };
}

export function sharedCanvasesQueryOptions(options: { thumbnails?: boolean } = {}) {
  return {
    ...orpc.listSharedCanvases.queryOptions({ input: { thumbnails: options.thumbnails ?? false } }),
    staleTime: STALE.viewer,
  };
}

export function publicCanvasesQueryOptions(owner: { ownerId: string } | { teamId: string }) {
  return {
    ...orpc.listPublicCanvases.queryOptions({ input: owner }),
    staleTime: STALE.listing,
  };
}

/** The canvas itself, who it's shared with, and every list it shows up in. */
function invalidateSharing(queryClient: QueryClient, canvasId: string) {
  return Promise.all([
    invalidateCanvasLists(queryClient),
    queryClient.invalidateQueries({ queryKey: canvasQueryOptions(canvasId).queryKey }),
    queryClient.invalidateQueries({ queryKey: orpc.listCanvasMembers.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.listSharedCanvases.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.listPublicCanvases.key() }),
  ]);
}

export function useSetCanvasVisibility(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (visibility: CanvasVisibility) =>
      client.setCanvasVisibility({ canvasId, visibility }),
    onSuccess: () => invalidateSharing(queryClient, canvasId),
    onError: toastMutationError("canvas.visibility", "Couldn't change who can see the canvas."),
  });
}

export function useAddCanvasMember(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: CanvasMemberRole }) =>
      client.addCanvasMember({ canvasId, ...input }),
    onSuccess: () => invalidateSharing(queryClient, canvasId),
    onError: toastMutationError("canvas.share", "Couldn't share the canvas."),
  });
}

export function useUpdateCanvasMember(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: CanvasMemberRole }) =>
      client.updateCanvasMember({ canvasId, ...input }),
    onSuccess: () => invalidateSharing(queryClient, canvasId),
    onError: toastMutationError("canvas.member_role", "Couldn't change their role."),
  });
}

export function useRemoveCanvasMember(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => client.removeCanvasMember({ canvasId, userId }),
    onSuccess: () => invalidateSharing(queryClient, canvasId),
    onError: toastMutationError("canvas.member_remove", "Couldn't remove them."),
  });
}

/** Leaving a canvas shared with you, then back to your own canvases. */
export function useLeaveCanvas(canvasId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => client.removeCanvasMember({ canvasId }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: canvasQueryOptions(canvasId).queryKey });
      await queryClient.invalidateQueries({ queryKey: orpc.listSharedCanvases.key() });
      toast.success("You left the canvas.");
      await navigate({ to: "/canvases" });
    },
    onError: toastMutationError("canvas.leave", "Couldn't leave the canvas."),
  });
}

export function useMoveCanvasToTeam(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => client.moveCanvasToTeam({ canvasId, teamId }),
    onSuccess: async ({ path, linkTurnedOff }) => {
      await invalidateSharing(queryClient, canvasId);
      toast.success(`Moved to the team as ${path}.`, {
        description: linkTurnedOff
          ? "Its link is off: only the team's owners can share a team canvas beyond the team."
          : undefined,
      });
    },
    onError: toastMutationError("canvas.move_to_team", "Couldn't move the canvas."),
  });
}

export function useReportCanvas(canvasId: string) {
  return useMutation({
    mutationFn: (reason: string) => client.reportCanvas({ canvasId, reason }),
    onSuccess: () => toast.success("Thanks. Staff will take a look."),
    onError: toastMutationError("canvas.report", "Couldn't send the report."),
  });
}

export function useSetCanvasHidden(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { hidden: boolean; reason?: string }) =>
      client.setCanvasHidden({ canvasId, ...input }),
    onSuccess: async (_result, input) => {
      await Promise.all([
        invalidateSharing(queryClient, canvasId),
        queryClient.invalidateQueries({ queryKey: orpc.listCanvasReports.key() }),
      ]);
      toast.success(input.hidden ? "Canvas hidden." : "Canvas visible again.");
    },
    onError: toastMutationError("canvas.hide", "Couldn't change the canvas."),
  });
}
