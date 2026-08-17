import "@/polyfill";
import { RPCHandler } from "@orpc/server/fetch";
import { StrictGetMethodPlugin } from "@orpc/server/plugins";
import { createFileRoute } from "@tanstack/react-router";

import { reportProcedureErrors } from "@/orpc/error-reporting";
import { publicRouter } from "@/orpc/router/public";

/**
 * The cacheable public tier. Everything here answers identically for every
 * caller, so responses can sit in a shared edge cache (docs/caching.md).
 *
 * `StrictGetMethodPlugin` refuses GET for any procedure that hasn't opted in
 * via `.route({ method: "GET" })` — standard RPC-over-GET CSRF hygiene, and
 * a second lock on which procedures this mount will serve.
 */
const handler = new RPCHandler(publicRouter, {
  plugins: [new StrictGetMethodPlugin()],
  clientInterceptors: [reportProcedureErrors("public")],
});

/**
 * Anonymity by construction: the incoming request's headers are dropped on
 * the floor rather than forwarded, so a procedure that regrew a session
 * lookup would still resolve anonymous and could not personalise a response
 * destined for a shared cache. Exported so a test can hold this to it —
 * quietly passing `request.headers` here would defeat the whole tier.
 */
export function anonymousContext(): { headers: Headers } {
  return { headers: new Headers() };
}

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/api/public/rpc",
    context: anonymousContext(),
  });

  return response ?? new Response("Not Found", { status: 404 });
}

export const Route = createFileRoute("/api/public/rpc/$")({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
    },
  },
});
