import { useEffect, useRef } from "react";

import { EVENTS, type SearchSurface } from "@/lib/event-taxonomy";
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
}) {
  const { surface, query, resultCount } = opts;
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
      captureEvent(EVENTS.searchPerformed, {
        surface,
        has_query: trimmed.length > 0,
        filter_kinds: filterKinds,
        result_count: resultCount,
        zero_results: resultCount === 0,
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [surface, query, filterKey, resultCount]);
}
