import { createFileRoute } from "@tanstack/react-router";

import { MAP_EDGE } from "@/lib/mmo-map/cache";
import { clientKey } from "@/lib/mmo-map/limits";
import { asPlayer, notFound, overlayParams, readWorld } from "@/lib/mmo-map/serve";
import { mapViewer } from "@/lib/mmo-map/viewer";
import { mapEnabled } from "@/lib/mmo-map/world";

import { PathMapOverlay } from "../../packages/mmo-api/src/index.ts";

/**
 * One viewer's live layers, outside `/api/public/` so the edge never holds
 * it. The identity is the session's Discord link; the browser's query names
 * only the chunks or scope=sight.
 */
export const Route = createFileRoute("/api/mmo/map/overlay")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!mapEnabled()) return notFound();
        const params = overlayParams(request);
        if (params instanceof Response) return params;
        const viewer = await mapViewer(request);
        const userId = viewer.kind === "user" ? viewer.userId : undefined;
        if (viewer.kind === "user" && viewer.discordId) params.discordId = viewer.discordId;
        const response = await readWorld({
          path: PathMapOverlay,
          params,
          bucket: "mmo-map-overlay",
          key: clientKey(request, userId),
          edge: MAP_EDGE.overlay,
        });
        return viewer.kind === "user" && !viewer.discordId ? asPlayer(response) : response;
      },
    },
  },
});
