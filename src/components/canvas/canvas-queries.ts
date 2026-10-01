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
