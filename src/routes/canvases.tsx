import { createFileRoute, Outlet } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { useFlagBlocks } from "@/lib/hooks/use-flag";

/**
 * Every `/canvases/*` page sits behind `canvases-enabled`. The procedures
 * are the real gate (NOT_FOUND while it's off); this covers a flag turned
 * off mid-visit.
 */
export const Route = createFileRoute("/canvases")({
  component: CanvasesLayout,
});

function CanvasesLayout() {
  if (useFlagBlocks("canvases-enabled")) return <NotFoundPage />;
  return <Outlet />;
}
