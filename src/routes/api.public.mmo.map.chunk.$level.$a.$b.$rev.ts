import { createFileRoute } from "@tanstack/react-router";

import { MAP_EDGE } from "@/lib/mmo-map/cache";
import { badRequest, CHUNK_COORD, CHUNK_LEVELS, notFound, publicRead } from "@/lib/mmo-map/serve";
import { mapEnabled } from "@/lib/mmo-map/world";

import { PathMapChunk } from "../../packages/mmo-api/src/index.ts";

/** One chunk's shared base at area or tile level, at its rev. */
export const Route = createFileRoute("/api/public/mmo/map/chunk/$level/$a/$b/$rev")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        if (!mapEnabled()) return notFound();
        const { level, a, b, rev } = params;
        if (!CHUNK_LEVELS.has(level)) return badRequest("level is area or tile.");
        if (!CHUNK_COORD.test(a) || !CHUNK_COORD.test(b)) {
          return badRequest("A chunk is two integers.");
        }
        return publicRead(request, PathMapChunk, MAP_EDGE.content, {
          params: { a, b, level },
          rev,
        });
      },
    },
  },
});
