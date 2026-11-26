import { createFileRoute } from "@tanstack/react-router";

import { MAP_EDGE } from "@/lib/mmo-map/cache";
import { publicRead } from "@/lib/mmo-map/serve";

import { PathMapStyle } from "../../packages/mmo-api/src/index.ts";

/** The map's look, from the setting pack, at its rev. */
export const Route = createFileRoute("/api/public/mmo/map/style/$rev")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        publicRead(request, PathMapStyle, MAP_EDGE.content, { rev: params.rev }),
    },
  },
});
