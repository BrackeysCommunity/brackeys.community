import { createFileRoute, notFound, useRouterState } from "@tanstack/react-router";

import { loadTick, MapRequestError, TICK_KEY } from "@/components/map/map-api";
import { MapPage } from "@/components/map/MapPage";
import type { MapSearch } from "@/components/map/use-live-map";
import { DISCORD_SNOWFLAKE } from "@/lib/discord-snowflake";
import { buildMeta } from "@/lib/site-meta";

function int(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : undefined;
}

function positive(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A link's camera: a Discord server's view, or a tile and a zoom. Anything else is dropped. */
export function validateMapSearch(raw: Record<string, unknown>): MapSearch {
  const out: MapSearch = {};
  const server =
    typeof raw.server === "string"
      ? raw.server
      : typeof raw.server === "number" && Number.isSafeInteger(raw.server)
        ? String(raw.server)
        : undefined;
  if (server && DISCORD_SNOWFLAKE.test(server)) out.server = server;
  const q = int(raw.q);
  const r = int(raw.r);
  if (q !== undefined && r !== undefined) {
    out.q = q;
    out.r = r;
  }
  const z = positive(raw.z);
  if (z !== undefined) out.z = z;
  return out;
}

/**
 * The router reads `?server=` as JSON, and a Discord id is past a double's
 * precision, so the id is taken from the address as written.
 */
export function serverFromSearch(searchStr: string): string | undefined {
  const server = new URLSearchParams(searchStr).get("server") ?? "";
  return DISCORD_SNOWFLAKE.test(server) ? server : undefined;
}

/**
 * The live map. It is a 404 only when the site knows no world (the tick route
 * answers 404); any other failure opens the page and its tick query reports it.
 */
export const Route = createFileRoute("/map")({
  staticData: { shell: "takeover" },
  validateSearch: validateMapSearch,
  loader: async ({ context: { queryClient } }) => {
    if (queryClient.getQueryData(TICK_KEY)) return;
    try {
      queryClient.setQueryData(TICK_KEY, await loadTick());
    } catch (err) {
      if (err instanceof MapRequestError && err.status === 404) throw notFound();
    }
  },
  head: () =>
    buildMeta({
      title: "Live map",
      description: "The wasteland as it has been found, drawn live from the world.",
      path: "/map",
      noindexNofollow: true,
      canonical: false,
    }),
  component: MapRoute,
});

function MapRoute() {
  const search = Route.useSearch();
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const server = serverFromSearch(searchStr);
  return <MapPage search={{ ...search, server }} />;
}
