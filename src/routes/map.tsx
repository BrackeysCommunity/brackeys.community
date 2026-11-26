import { createFileRoute, notFound, useRouterState } from "@tanstack/react-router";

import { loadTick, TICK_KEY } from "@/components/map/map-api";
import { MapPage } from "@/components/map/MapPage";
import type { MapSearch } from "@/components/map/use-live-map";
import { buildMeta } from "@/lib/site-meta";

const SNOWFLAKE = /^\d{1,20}$/;

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
  if (server && SNOWFLAKE.test(server)) out.server = server;
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
  return SNOWFLAKE.test(server) ? server : undefined;
}

/** The live map. It exists only where the site knows a world: the tick route's answer is the gate. */
export const Route = createFileRoute("/map")({
  staticData: { shell: "takeover" },
  validateSearch: validateMapSearch,
  loader: async ({ context: { queryClient } }) => {
    if (queryClient.getQueryData(TICK_KEY)) return;
    const index = await loadTick().catch(() => {
      throw notFound();
    });
    queryClient.setQueryData(TICK_KEY, index);
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
