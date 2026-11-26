import { createFileRoute } from "@tanstack/react-router";

import { MAP_EDGE } from "@/lib/mmo-map/cache";
import { focusParams, notFound, publicRead } from "@/lib/mmo-map/serve";
import { mapEnabled } from "@/lib/mmo-map/world";

import { PathMapFocus } from "../../packages/mmo-api/src/index.ts";

/** Where a Discord server's view centres. A camera only: it grants no sight. */
export const Route = createFileRoute("/api/public/mmo/map/focus")({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!mapEnabled()) return notFound();
        const params = focusParams(request);
        if (params instanceof Response) return params;
        return publicRead(request, PathMapFocus, MAP_EDGE.tick, { params });
      },
    },
  },
});
