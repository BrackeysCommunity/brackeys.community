import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { z } from "zod";

import { CanvasesBrowsePage } from "@/components/canvas/CanvasesBrowsePage";
import { pageTitle } from "@/lib/site-meta";

const searchSchema = z.object({
  /** `personal`, or a team id. */
  scope: z.string().max(100).optional(),
  view: z.enum(["canvases", "deleted"]).default("canvases"),
});

const routeApi = getRouteApi("/canvases/");

export const Route = createFileRoute("/canvases/")({
  validateSearch: searchSchema,
  component: CanvasesIndex,
  head: () => ({
    meta: [{ title: pageTitle("Canvases") }, { name: "robots", content: "noindex" }],
  }),
});

function CanvasesIndex() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  return (
    <CanvasesBrowsePage
      scopeParam={search.scope}
      view={search.view}
      onChange={(next) => void navigate({ search: (prev) => ({ ...prev, ...next }) })}
    />
  );
}
