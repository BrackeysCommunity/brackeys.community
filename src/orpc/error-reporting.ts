import { ORPCError } from "@orpc/client";

import { captureServerException } from "@/lib/posthog-server";
import { readSession } from "@/orpc/middleware/auth";

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
 * The interceptor only sees the handler's initial context (`{ headers }`),
 * not what the auth middleware resolves — but that's enough to attribute:
 * on the error path (errors are rare; one extra session read is fine) it
 * resolves the session itself and attaches `user_id`, so a report can answer
 * "one user or everyone?". The public tier stays anonymous — its
 * header-stripping (`anonymousContext` in `src/routes/api.public.rpc.$.ts`)
 * is deliberate and test-enforced, so there is no session to read.
 */
export function reportProcedureErrors(tier: ProcedureTier) {
  return async (options: {
    context: unknown;
    path: readonly string[];
    next: () => Promise<unknown>;
  }) => {
    try {
      return await options.next();
    } catch (error) {
      if (isExpected(error)) throw error;
      const session = tier === "public" ? null : await readSession(options.context);
      captureServerException(error, {
        tier,
        procedure: options.path.join("."),
        user_id: session?.user.id,
      });
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
