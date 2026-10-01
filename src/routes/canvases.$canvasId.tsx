import { ORPCError } from "@orpc/client";
import { createFileRoute, notFound, getRouteApi } from "@tanstack/react-router";

import { canvasQueryOptions } from "@/components/canvas/canvas-queries";
import { CanvasPage } from "@/components/canvas/CanvasPage";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { pageTitle } from "@/lib/site-meta";

/**
 * One canvas. The loader's read is the gate: a canvas the viewer can't
 * see, or a dark flag, is this page's 404.
 */
const routeApi = getRouteApi("/canvases/$canvasId");

export const Route = createFileRoute("/canvases/$canvasId")({
  staticData: { shell: "takeover" },
  loader: async ({ context: { queryClient }, params }): Promise<{ title: string }> => {
    const canvas = await queryClient
      .ensureQueryData(canvasQueryOptions(params.canvasId))
      .catch((error: unknown) => {
        if (error instanceof ORPCError && error.code === "NOT_FOUND") return null;
        throw error;
      });
    if (!canvas) throw notFound();
    return { title: canvas.title };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: pageTitle(loaderData?.title ?? "Canvas") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CanvasRoute,
  notFoundComponent: () => <NotFoundPage />,
});

function CanvasRoute() {
  const { canvasId } = routeApi.useParams();
  return <CanvasPage canvasId={canvasId} />;
}
