import { createFileRoute } from "@tanstack/react-router";

import { MAP_EDGE } from "@/lib/mmo-map/cache";
import { publicRead } from "@/lib/mmo-map/serve";

import { PathMapRegions } from "../../packages/mmo-api/src/index.ts";

/** The widest level of the map, at its rev. */
export const Route = createFileRoute("/api/public/mmo/map/regions/$rev")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        publicRead(request, PathMapRegions, MAP_EDGE.content, { rev: params.rev }),
    },
  },
});
