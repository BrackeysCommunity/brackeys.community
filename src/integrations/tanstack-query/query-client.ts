import { MutationCache, QueryClient } from "@tanstack/react-query";

import { markWrite } from "@/orpc/recent-write";

/**
 * The app's one query client, minted per router in `getRouter()` — which
 * means per request on the server, so no cache ever crosses viewers.
 *
 * There used to be two: one handed to the router as context, one minted by
 * a provider in `__root.tsx`. They never met, so the standard
 * `context.queryClient.ensureQueryData(...)` loader would have populated a
 * cache no `useQuery` reads — a prefetch that silently did nothing but
 * lengthen the navigation. `setupRouterSsrQueryIntegration` now mounts the
 * provider (see `router.tsx`), so there is only the one.
 *
 * Every successful mutation stamps the recent-write window, which flips
 * public-tier reads onto the private `no-store` mount so the writer sees
 * their own write instead of the edge cache's pre-write copy — see
 * src/orpc/recent-write.ts. Raw client calls that bypass useMutation
 * (the collab wizard's submit) call markWrite() themselves.
 */
export function makeQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({ onSuccess: markWrite }),
    // The library default is 0 — every query stale on arrival, refetching
    // on every mount and every window focus. 68 call sites were writing a
    // staleTime by hand (15 s–5 min); this is that policy stated once.
    // Explicit per-query values still win where they're set.
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
}
