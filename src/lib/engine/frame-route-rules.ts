/**
 * Nitro `routeRules` for hosted games, spread into `vite.config.ts`'s table. Route-rule headers
 * apply to 2xx only, so a 404 or 410 from the frame route is never cached immutable.
 */
export const frameRouteRules = {
  // Release files: the release id names every byte below it, so all of it is immutable.
  "/frames/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
  // Private and team releases: never at the edge.
  "/frames-private/**": { headers: { "cache-control": "private, max-age=3600" } },
  // The play and game pages are documents: framed only by ourselves, except the embed page.
  "/games/*/play/**": { headers: { "content-security-policy": "frame-ancestors 'self'" } },
  "/games/*/embed/**": { headers: { "content-security-policy": "frame-ancestors *" } },
} as const satisfies Record<string, { headers: Record<string, string> }>;

const FRAME_PATH = /^\/frames(?:-private)?\//;

/** `origin`'s host, lower-cased, or null for a value that isn't a URL. */
export function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

const env = (name: string): string | undefined =>
  typeof process === "undefined" ? undefined : process.env[name];

/**
 * The play host: `ENGINE_PLAY_ORIGIN`'s (or `configured`'s) host, else null
 * when frames share the site's, including a play origin set to the site's
 * own (`site`, default `VITE_SITE_ORIGIN` or `APP_URL`), which would
 * otherwise turn every page of the site into a 404.
 */
export function playHost(
  configured: string | null | undefined = env("ENGINE_PLAY_ORIGIN"),
  site: string | null | undefined = env("VITE_SITE_ORIGIN") || env("APP_URL"),
): string | null {
  const trimmed = configured?.trim();
  const host = trimmed ? hostOf(trimmed) : null;
  const siteHost = site?.trim() ? hostOf(site.trim()) : null;
  return host === siteHost ? null : host;
}

/** Whether `url` came in on the play host; false while there is none. */
export const onPlayHost = (url: URL, host: string | null): boolean =>
  host !== null && url.host.toLowerCase() === host;

/**
 * The play host answers only the frame routes: anything else there is a 404, so game files
 * never share a host with the site's pages, API or sign-in. Null lets the request through.
 */
export function playHostRefusal(
  request: Request,
  host: string | null = playHost(),
): Response | null {
  const url = new URL(request.url);
  if (!onPlayHost(url, host) || FRAME_PATH.test(url.pathname)) return null;
  return new Response(request.method === "HEAD" ? null : "Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
