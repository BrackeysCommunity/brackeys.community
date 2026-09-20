import { describe, expect, it, vi } from "vite-plus/test";

import { trackedJamsQueryOptions } from "@/components/jams/JamCalendarPage/use-jam-data";

import { Route } from "../jams";

/**
 * The masthead prints "Tracking N jams" on all three jam views. When that
 * number arrived with a client-side fetch, the sentence rendered as
 * "Tracking 0 jams", then rewrapped to a second line on a phone and pushed
 * the page down — the whole of the calendar's measured layout shift. It
 * belongs to the section's layout route so the document carries it.
 */
type PrefetchedOptions = { queryKey: unknown[] };

/** Runs the layout loader against a stand-in query client and reports every
 * query it asked for. */
async function prefetchedKeys(): Promise<unknown[][]> {
  const prefetchQuery = vi.fn((_options: PrefetchedOptions) => Promise.resolve());
  const loader = Route.options.loader as (ctx: unknown) => Promise<unknown>;
  await loader({ context: { queryClient: { prefetchQuery } } });
  return prefetchQuery.mock.calls.map(([options]) => options.queryKey);
}

describe("/jams layout loader", () => {
  it("prefetches the tracked-jam count, so the masthead is final at paint", async () => {
    expect(await prefetchedKeys()).toEqual([trackedJamsQueryOptions().queryKey]);
  });

  it("does not prefetch a listing for it", async () => {
    for (const key of await prefetchedKeys()) expect(key[0]).not.toBe("list-jams");
  });
});
