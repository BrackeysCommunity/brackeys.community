import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { MapIndex, MapOverlayQuery } from "../../../packages/mmo-api/src/index.ts";
import { PathMapIndex } from "../../../packages/mmo-api/src/index.ts";
import type { Level } from "../../../packages/mmo-map/src/index.ts";
import { overlayQueryString } from "../../../packages/mmo-map/src/index.ts";

/** The site's map routes: the shared payloads under /api/public/, the viewer's overlay outside it. */
export const MAP_ROUTES = {
  tick: "/api/public/mmo/map/tick",
  focus: (server: string) => `/api/public/mmo/map/focus?${new URLSearchParams({ server })}`,
  style: (rev: string) => `/api/public/mmo/map/style/${encodeURIComponent(rev)}`,
  regions: (rev: string) => `/api/public/mmo/map/regions/${encodeURIComponent(rev)}`,
  chunk: (level: Exclude<Level, "region">, a: number, b: number, rev: string) =>
    `/api/public/mmo/map/chunk/${level}/${a}/${b}/${encodeURIComponent(rev)}`,
  overlay: (q: MapOverlayQuery) => `/api/mmo/map/overlay?${overlayQueryString(q)}`,
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

// structural: how often a refused map read is asked again, and how long a
// Retry-After it will wait for.
const MAP_RETRIES = 3;
const MAP_RETRY_WAIT_MAX_S = 10;
const MAP_RETRY_BASE_MS = 1000;
const MAP_RETRY_CAP_MS = 8000;

/** Only a busy or briefly unavailable world is asked again, and never past a long Retry-After. */
export function retryMapRead(failures: number, err: unknown): boolean {
  return (
    err instanceof MapRequestError &&
    (err.status === 429 || err.status === 503) &&
    failures < MAP_RETRIES &&
    (err.retryAfter ?? 0) <= MAP_RETRY_WAIT_MAX_S
  );
}

/** The world's own Retry-After when it sent one, else a doubling wait. */
export function mapRetryDelay(failures: number, err: unknown): number {
  if (err instanceof MapRequestError && err.retryAfter !== undefined) return err.retryAfter * 1000;
  return Math.min(MAP_RETRY_BASE_MS * 2 ** failures, MAP_RETRY_CAP_MS);
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
