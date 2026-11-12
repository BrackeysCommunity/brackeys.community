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
