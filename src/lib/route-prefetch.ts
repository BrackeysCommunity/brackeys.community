/** Whether this loader run is the server-rendering one. */
export function isServerLoad(): boolean {
  return typeof window === "undefined";
}

/**
 * A loader's query prefetch: awaited on the server, let go on the client.
 *
 * On the server the await is the whole point — the query has to settle
 * before render or the ssr-query integration (see `router.tsx`) has nothing
 * to dehydrate, and the document ships a skeleton to both the browser and
 * the crawler.
 *
 * On the client, awaiting would hold the page the user is leaving for the
 * length of the request, which is the stall `defaultPendingMs` exists to
 * cover; on `/collab`, where every filter lives in the URL, it would do
 * that on each chip toggle. Letting it go is still ahead of where we were:
 * `defaultPreload: "intent"` runs loaders on hover, so the request is
 * usually already in flight before the click, and the page's own skeleton
 * covers whatever is left.
 *
 * Only prefetch queries whose result is identical for every viewer —
 * anything the server puts in this cache is serialized into the HTML.
 */
export function prefetchInLoader(prefetch: Promise<void>): Promise<void> | undefined {
  return isServerLoad() ? prefetch : undefined;
}
