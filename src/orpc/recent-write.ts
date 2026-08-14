/**
 * Writer-sees-own-write for the edge-cached public tier.
 *
 * Public-tier reads are held by Cloudflare for `s-maxage` seconds
 * (see docs/caching.md), so a refetch right after a mutation can be
 * answered with the pre-write response. The fix is client-side: every
 * successful write calls `markWrite()`, and for the next window the
 * oRPC client (src/orpc/client.ts) routes public procedures through
 * the private `no-store` mount — same procedure instances, origin-fresh.
 * Everyone who didn't write keeps the edge cache.
 *
 * The window is the longest public-tier TTL a writer can be shown
 * stale (30s, `PUBLIC_EDGE_TTL`) plus headroom: an edge copy cached
 * just before the write expires within 30s of it, so once the window
 * passes the edge can no longer serve a pre-write response.
 */
const BYPASS_WINDOW_MS = 45_000;

let lastWriteAt = 0;

export function markWrite() {
  lastWriteAt = Date.now();
}

export function shouldBypassPublicCache() {
  return Date.now() - lastWriteAt < BYPASS_WINDOW_MS;
}
