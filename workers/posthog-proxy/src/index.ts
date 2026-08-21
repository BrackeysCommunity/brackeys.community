/**
 * First-party reverse proxy for PostHog ingestion.
 *
 * Ad blockers match on `*.i.posthog.com`, which costs roughly 10–30% of
 * events. Cloudflare already fronts brackeys.community, so routing ingestion
 * through a path on our own origin makes the requests first-party and
 * indistinguishable from the rest of the app's traffic.
 *
 * The path deliberately avoids "analytics", "tracking", "telemetry",
 * "posthog", and "ph" — blocklists match those in URLs as readily as they
 * match hostnames, which would give back the problem this exists to solve.
 *
 * ## Cookieless makes the client IP load-bearing
 *
 * The app runs `cookieless_mode: "always"`, so there is no persistent
 * visitor id: PostHog derives one server-side from a hash that includes the
 * client IP. A proxy that forwards its own IP would collapse every visitor
 * into a handful of identities and quietly destroy unique counts — the
 * failure is silent, the numbers just get smaller and wronger. Hence the
 * explicit `X-Forwarded-For` below; it is not boilerplate.
 */

const INGEST_HOST = "eu.i.posthog.com";
/** Static assets (toolbar, lazily-loaded extensions) live on a second host. */
const ASSET_HOST = "eu-assets.i.posthog.com";

/**
 * The path the zone route mounts this worker on. PostHog serves from the
 * root of its hosts, so the prefix has to come off before forwarding —
 * `/ingest/e/` upstream is a 404, not a capture. Must match the route in
 * `wrangler.toml` and the path in `VITE_POSTHOG_HOST`.
 */
const ROUTE_PREFIX = "/ingest";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(`${ROUTE_PREFIX}/`)) {
      url.pathname = url.pathname.slice(ROUTE_PREFIX.length);
    }

    // `/static/*` is the asset host; everything else is ingestion. This split
    // is PostHog's, not ours — serving both from one host 404s the toolbar.
    const upstream = url.pathname.startsWith("/static/") ? ASSET_HOST : INGEST_HOST;

    url.hostname = upstream;
    url.protocol = "https:";
    url.port = "";

    const headers = new Headers(request.headers);
    headers.set("Host", upstream);

    // Preserve any upstream chain rather than replacing it, so the real
    // client stays first in the list.
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) {
      const existing = request.headers.get("X-Forwarded-For");
      headers.set("X-Forwarded-For", existing ? `${existing}, ${clientIp}` : clientIp);
    }

    return fetch(
      new Request(url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      }),
    );
  },
};
