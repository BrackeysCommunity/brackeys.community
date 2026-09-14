import { createFileRoute } from "@tanstack/react-router";

/**
 * Railway's `healthcheckPath` for the Web service.
 *
 * Without one, Railway swaps containers as soon as the new one starts, so a
 * release that boots and immediately dies takes the site down before the
 * pipeline's deploy poll notices. With one, the old container keeps serving
 * until this answers 200.
 *
 * Deliberately touches nothing — no DB, no auth, no external call. A health
 * check that fails when Postgres blips would roll back a perfectly good
 * release; liveness here means "this build starts and serves", and the
 * dependencies have their own alerting.
 *
 * The version it reports is the same string the footer shows, which makes it
 * the cheapest way to confirm from outside what a service is actually running.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ ok: true, version: __APP_VERSION__ }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }),
    },
  },
});
