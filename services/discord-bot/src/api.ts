import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import type { publicRouter } from "../../../src/orpc/router/public";

/**
 * The bot's whole view of the site: the public tier at `/api/public/rpc`,
 * called over GET exactly as the browser calls it, so every answer rides
 * the edge cache the web app already warms.
 *
 * The router import is type-only — Bun erases it, so the image never holds
 * the router, drizzle, or a database URL and cannot accidentally run them.
 * What it buys is a client typed against the live procedures: a renamed
 * input or a dropped field fails this service's `tsc`, not a member's
 * command.
 */
export type PublicApi = RouterClient<typeof publicRouter>;

export type ApiOutcome = "hit" | "not_found" | "timeout" | "error";

/** The public API did not answer in time or at all — the honest outage line. */
export class ApiUnavailableError extends Error {
  readonly outcome: "timeout" | "error";
  constructor(outcome: "timeout" | "error", cause: unknown) {
    super(outcome === "timeout" ? "public API timed out" : "public API unreachable", { cause });
    this.name = "ApiUnavailableError";
    this.outcome = outcome;
  }
}

export type FetchLike = (input: Request, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Per-call budget. `AbortSignal.timeout` — a hung origin never holds an
   *  interaction past the window. */
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** One line per call: procedure, latency, and Cloudflare's cache status
   *  — the build criterion for Phase 0 is reading `HIT` here. */
  log?: (line: string) => void;
}

export function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError") &&
    !(error instanceof ApiUnavailableError)
  );
}

/**
 * A typed client for `origin`'s public tier. Every request carries a
 * timeout and logs `cf-cache-status`; network failures and timeouts
 * surface as `ApiUnavailableError` so the adapter can answer with one
 * outage line instead of a stack trace.
 */
export function createPublicApi(origin: string, options: ApiClientOptions = {}): PublicApi {
  const { timeoutMs = 2000, fetchImpl = fetch as FetchLike, log = () => {} } = options;

  const link = new RPCLink({
    url: `${origin}/api/public/rpc`,
    // GET is what makes these responses edge-cacheable. Inputs longer than
    // the URL budget fall back to POST — still correct, just a cache miss.
    method: () => "GET",
    fallbackMethod: "POST",
    fetch: async (request, init, _options, path) => {
      const startedAt = performance.now();
      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(request, { ...init, signal });
      } catch (error) {
        const outcome = isTimeout(error) ? "timeout" : "error";
        log(`[api] ${path.join(".")} ${outcome} after ${elapsed(startedAt)}ms`);
        throw new ApiUnavailableError(outcome, error);
      }
      log(
        `[api] ${path.join(".")} ${response.status} ${elapsed(startedAt)}ms cf=${
          response.headers.get("cf-cache-status") ?? "-"
        }`,
      );
      // The tier answers 5xx only when the origin is down or broken. Neither
      // is a state a member can do anything about, so both collapse into the
      // outage line rather than surfacing the server's own message.
      if (response.status >= 500) {
        throw new ApiUnavailableError("error", new Error(`HTTP ${response.status}`));
      }
      return response;
    },
  });

  return createORPCClient(link);
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
