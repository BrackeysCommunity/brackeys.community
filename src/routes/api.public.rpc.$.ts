import "@/polyfill";
import { RPCHandler } from "@orpc/server/fetch";
import { StrictGetMethodPlugin } from "@orpc/server/plugins";
import { createFileRoute } from "@tanstack/react-router";

import { EVENTS, type PublicApiCallerKind } from "@/lib/event-taxonomy";
import { captureServerOwnedEvent } from "@/lib/posthog-server";
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

/**
 * Which kind of client this is, from headers only.
 *
 * `Sec-Fetch-Site` is the browser tell: every major browser sends one on
 * every fetch, and it is a forbidden header name, so page script can neither
 * forge nor suppress it. Nothing calling from a server sends it. That makes
 * "no `Sec-Fetch-*`" the honest definition of a non-browser caller, rather
 * than a user-agent string anyone can type.
 */
export function callerKind(request: Request): PublicApiCallerKind {
  if (request.headers.has("sec-fetch-site") || request.headers.has("sec-fetch-mode")) {
    return "browser";
  }
  const agent = request.headers.get("user-agent") ?? "";
  return agent.startsWith("brackeys-discord-bot/") ? "bot" : "unknown";
}

/** The procedure path, from the part of the URL after the mount. */
export function procedureName(url: string): string {
  try {
    const { pathname } = new URL(url);
    const rest = pathname.slice("/api/public/rpc".length).replace(/^\/+/, "");
    // oRPC spells nested procedures with slashes in the URL and dots
    // everywhere else; match the error reporter, which joins on dots.
    return rest ? rest.split("/").filter(Boolean).join(".") : "";
  } catch {
    return "";
  }
}

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/api/public/rpc",
    context: anonymousContext(),
  });

  const result = response ?? new Response("Not Found", { status: 404 });

  // Browser calls are deliberately not captured. The web app itself is the
  // heaviest caller of this mount — several per page load — and every one of
  // those is already described by a named event somewhere in the taxonomy,
  // so capturing them would multiply ingestion for no answer anyone wants.
  // What nothing else can see is the traffic with no browser behind it: the
  // Discord bot, the MCP server, and whatever else finds the tier.
  const kind = callerKind(request);
  if (kind !== "browser") {
    captureServerOwnedEvent(EVENTS.publicApiCalled, {
      procedure: procedureName(request.url),
      status: result.status,
      method: request.method,
      caller_kind: kind,
    });
  }

  return result;
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
