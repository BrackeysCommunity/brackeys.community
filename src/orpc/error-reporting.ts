import { ORPCError } from "@orpc/client";

import { captureServerException } from "@/lib/posthog-server";

/**
 * Which way into the router the failing call came. There is no shared base
 * procedure to hang error reporting off, so each entry point installs this
 * interceptor itself — and there are four, which is easy to under-count:
 *
 * - `private` — the session-bearing RPC mount (`/api/rpc`)
 * - `public` — the cacheable anonymous RPC mount (`/api/public/rpc`)
 * - `openapi` — the REST/OpenAPI mount (`/api`)
 * - `ssr` — server-rendered loaders, which call the router in-process via
 *   `createRouterClient` and so cross none of the mounts above
 */
type ProcedureTier = "private" | "public" | "openapi" | "ssr";

/**
 * `clientInterceptors` entry that reports unexpected procedure failures.
 *
 * Not user-attributed on any tier: the interceptor only sees the handler's
 * initial context (`{ headers }`), not what the auth middleware resolves —
 * and the public tier is anonymous by construction anyway
 * (`anonymousContext` in `src/routes/api.public.rpc.$.ts`).
 */
export function reportProcedureErrors(tier: ProcedureTier) {
  return async (options: { path: readonly string[]; next: () => Promise<unknown> }) => {
    try {
      return await options.next();
    } catch (error) {
      if (isExpected(error)) throw error;
      captureServerException(error, { tier, procedure: options.path.join(".") });
      throw error;
    }
  };
}

/**
 * A thrown `ORPCError` below 500 is the contract working — NOT_FOUND on a
 * missing jam, FORBIDDEN on a non-staff caller. Only 5xx and non-oRPC throws
 * (the ones nobody wrote a branch for) are worth an issue.
 */
function isExpected(error: unknown): boolean {
  return error instanceof ORPCError && error.status < 500;
}
