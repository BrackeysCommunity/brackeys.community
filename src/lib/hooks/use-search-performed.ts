import { useEffect, useRef } from "react";

import {
  EVENTS,
  type AnalyticsEvent,
  type JamListSurface,
  type SearchSurface,
} from "@/lib/event-taxonomy";
import { captureEvent } from "@/lib/product-insights";

/**
 * Debounced `search_performed` for a listing surface. One event per settled
 * (query, filters) combination — not per keystroke, and not again when the
 * same search refetches. Pure browsing (no query, no filters) is not a
 * search and fires nothing.
 *
 * Pass `resultCount: null` while results for the current input are still
 * loading — the event waits for the real count, because `zero_results` is
 * the property the whole event exists for.
 */
export function useSearchPerformed(opts: {
  surface: SearchSurface;
  query: string | undefined;
  /** Which filter groups are active, e.g. `["skills", "availability"]`. */
  filterKinds: string[];
  resultCount: number | null;
  /** Surface-specific properties, e.g. the palette's `engine` and `kinds`. */
  properties?: Record<string, unknown>;
}) {
  useNarrowedListing({ event: EVENTS.searchPerformed, ...opts });
}

/**
 * The same contract for the three jam listings, under its own event name.
 *
 * Two things differ from the surfaces above, both because of what the jam
 * board is. First, `search_performed`'s `"jams"` surface is already taken by
 * one jam's submissions grid, so these get their own event rather than a
 * fourth meaning of the same name. Second, sort, month and page count as
 * filters here: on members or teams a sort narrows nothing, but on a board of
 * ~500 live jams and an archive of ~19,000 the controls that move you through
 * it *are* the browsing, and browsing is the top of the funnel this event
 * exists to open.
 */
export function useJamListFiltered(opts: {
  surface: JamListSurface;
  query: string | undefined;
  /** Active browse controls, e.g. `["sort", "page"]`. */
  filterKinds: string[];
  resultCount: number | null;
}) {
  useNarrowedListing({ event: EVENTS.jamListFiltered, ...opts });
}

/**
 * Shared body. The debounce is what makes one event per settled input rather
 * than one per keystroke; the `lastFired` key is what keeps a refetch of the
 * same input silent.
 */
function useNarrowedListing(opts: {
  event: AnalyticsEvent;
  surface: SearchSurface | JamListSurface;
  query: string | undefined;
  filterKinds: string[];
  resultCount: number | null;
  properties?: Record<string, unknown>;
}) {
  const { event, surface, query, resultCount } = opts;
  const properties = useRef(opts.properties);
  useEffect(() => {
    properties.current = opts.properties;
  });
  const filterKey = opts.filterKinds.join(",");
  const lastFired = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = query?.trim() ?? "";
    const filterKinds = filterKey ? filterKey.split(",") : [];
    if (resultCount == null) return;
    if (!trimmed && filterKinds.length === 0) return;
    const key = `${trimmed}|${filterKey}`;
    if (lastFired.current === key) return;
    const timer = setTimeout(() => {
      lastFired.current = key;
      captureEvent(event, {
        ...properties.current,
        surface,
        has_query: trimmed.length > 0,
        filter_kinds: filterKinds,
        result_count: resultCount,
        zero_results: resultCount === 0,
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [event, surface, query, filterKey, resultCount]);
}
