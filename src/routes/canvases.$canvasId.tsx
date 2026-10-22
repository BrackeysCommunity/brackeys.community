import { ORPCError } from "@orpc/client";
import { createFileRoute, notFound, getRouteApi } from "@tanstack/react-router";

import { canvasHeadHeaders, canvasHeadMeta } from "@/components/canvas/canvas-head";
import { canvasQueryOptions } from "@/components/canvas/canvas-queries";
import { CanvasPage } from "@/components/canvas/CanvasPage";
import { NotFoundPage } from "@/components/layout/NotFoundPage";

/**
 * One canvas. The loader's read is the gate: a canvas the viewer can't
 * see, or a dark flag, is this page's 404.
 */
const routeApi = getRouteApi("/canvases/$canvasId");

export const Route = createFileRoute("/canvases/$canvasId")({
  staticData: { shell: "takeover" },
  loader: async ({ context: { queryClient }, params }) => {
    const canvas = await queryClient
      .ensureQueryData(canvasQueryOptions(params.canvasId))
      .catch((error: unknown) => {
        if (error instanceof ORPCError && error.code === "NOT_FOUND") return null;
        throw error;
      });
    if (!canvas) throw notFound();
    return {
      id: canvas.id,
      title: canvas.title,
      visibility: canvas.visibility,
      hidden: canvas.hidden,
      deletedAt: canvas.deletedAt,
      nodeCount: canvas.nodeCount,
    };
  },
  head: ({ loaderData }) => canvasHeadMeta(loaderData ?? null),
  headers: ({ loaderData }) => canvasHeadHeaders(loaderData ?? null),
  component: CanvasRoute,
  notFoundComponent: () => <NotFoundPage />,
});

function CanvasRoute() {
  const { canvasId } = routeApi.useParams();
  return <CanvasPage canvasId={canvasId} />;
}
