import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { MapIndex, MapOverlayQuery } from "../../../packages/mmo-api/src/index.ts";
import { PathMapIndex } from "../../../packages/mmo-api/src/index.ts";
import type { Level } from "../../../packages/mmo-map/src/index.ts";
import { chunkId } from "../../../packages/mmo-map/src/index.ts";

/** The site's map routes: the shared payloads under /api/public/, the viewer's overlay outside it. */
export const MAP_ROUTES = {
  tick: "/api/public/mmo/map/tick",
  focus: (server: string) => `/api/public/mmo/map/focus?${new URLSearchParams({ server })}`,
  style: (rev: string) => `/api/public/mmo/map/style/${encodeURIComponent(rev)}`,
  regions: (rev: string) => `/api/public/mmo/map/regions/${encodeURIComponent(rev)}`,
  chunk: (level: Exclude<Level, "region">, a: number, b: number, rev: string) =>
    `/api/public/mmo/map/chunk/${level}/${a}/${b}/${encodeURIComponent(rev)}`,
  overlay: (q: MapOverlayQuery) =>
    `/api/mmo/map/overlay?${q.sight ? "scope=sight" : `chunks=${(q.chunks ?? []).map(chunkId).join(",")}`}`,
} as const;

/** A map read that did not answer 200; status 0 is a request that never reached the site. */
export class MapRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code = "",
    readonly retryAfter?: number,
  ) {
    super(`map read failed: ${status}${code ? ` ${code}` : ""}`);
    this.name = "MapRequestError";
  }
}

async function readReply<T>(res: Response): Promise<T> {
  if (res.status !== 200) {
    let code = "";
    try {
      code = ((await res.json()) as { code?: string } | null)?.code ?? "";
    } catch {
      // A refusal without a JSON body still has its status.
    }
    const retry = Number(res.headers.get("retry-after"));
    throw new MapRequestError(
      res.status,
      code,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return (await res.json()) as T;
}

/** One map read from the browser. */
export async function mapGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new MapRequestError(0, "unavailable");
  }
  return readReply<T>(res);
}

export const TICK_KEY = ["mmo-map", "tick"] as const;

/**
 * The page's gate and its first index. On the server it is the tick route's
 * own handler with this request, so the page answers exactly when the route
 * does; in the browser it is the route.
 */
export const loadTick = createIsomorphicFn()
  .server(async (): Promise<MapIndex> => {
    const [{ publicRead }, { MAP_EDGE }] = await Promise.all([
      import("@/lib/mmo-map/serve"),
      import("@/lib/mmo-map/cache"),
    ]);
    return readReply<MapIndex>(await publicRead(getRequest(), PathMapIndex, MAP_EDGE.tick));
  })
  .client((): Promise<MapIndex> => mapGet<MapIndex>(MAP_ROUTES.tick));
