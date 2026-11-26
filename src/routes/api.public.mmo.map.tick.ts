import { createFileRoute } from "@tanstack/react-router";

import { MAP_EDGE } from "@/lib/mmo-map/cache";
import { publicRead } from "@/lib/mmo-map/serve";

import { PathMapIndex } from "../../packages/mmo-api/src/index.ts";

/** The map at this tick: every discovered chunk and each payload's rev. */
export const Route = createFileRoute("/api/public/mmo/map/tick")({
  server: {
    handlers: {
      GET: ({ request }) => publicRead(request, PathMapIndex, MAP_EDGE.tick),
    },
  },
});
