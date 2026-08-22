import { useEffect, useRef } from "react";

/**
 * The load-more sentinel every infinite listing renders at its foot: an
 * IntersectionObserver that fires the next page as the marker scrolls into
 * range. Attach the returned ref to an empty element after the list.
 *
 * The observer only exists while a next page does — no page, no observer —
 * and a fetch already in flight is never doubled.
 */
export function useInfiniteScrollSentinel({
  hasNextPage,
  isFetching,
  fetchNext,
  rootMargin = "400px",
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  fetchNext: () => unknown;
  rootMargin?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetching) void fetchNext();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, fetchNext, rootMargin]);

  return sentinelRef;
}
