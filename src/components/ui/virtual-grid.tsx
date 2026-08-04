import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** `useLayoutEffect` that stays quiet on the server. */
const useIsoLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * How much of the list renders before anything has been measured — the
 * server pass and the first client render, both of which happen before
 * the scrollport is known. A screenful, not the whole list: the point of
 * this component is that a thousand banner images never mount at once.
 */
const UNMEASURED_ITEMS = 12;

interface VirtualGridProps<T> {
  items: T[];
  /** Stable identity per item — also keys the virtualizer's rows. */
  getItemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  /**
   * Layout classes for one row: the column ladder and the gaps, exactly
   * what the unvirtualized container used to carry (`grid grid-cols-1
   * gap-3 sm:grid-cols-2 …`, or `flex flex-col gap-2` for a plain list).
   * The column count is read back off the resolved CSS rather than
   * restated in JS, so the breakpoints live in one place.
   */
  rowClassName: string;
  /** Row height in px before a real row has been measured. */
  estimateRowHeight: number;
  /** Rows kept mounted past each edge of the viewport. */
  overscan?: number;
  /** Classes for the container itself — frame, border, rounding. Must
   * not add top padding: the row offsets are measured from its top edge. */
  className?: string;
  /**
   * Always-mounted trailer, rendered under the rows. The infinite-scroll
   * sentinel belongs here — inside the virtualized set it would be
   * unmounted exactly when it matters.
   */
  footer?: ReactNode;
}

/**
 * A responsive grid (or single-column list) that only mounts the rows
 * near the viewport.
 *
 * These boards are page-flow sections, not their own scrollports: the
 * app scrolls an ancestor tagged `data-scroll-root` (see the shells in
 * `routes/__root.tsx`), and the list is one band inside a page that also
 * carries a hero, a toolbar, and — on the jam board — three more shelves.
 * So the virtualizer hangs off that ancestor and offsets itself by
 * `scrollMargin`, the distance from the top of the scrolled content down
 * to this list, re-measured as things above it change height.
 *
 * Items are chunked into rows of `columns`, where `columns` comes from
 * the resolved `grid-template-columns` of an empty probe row. That keeps
 * `auto-fill` ladders working — the grid still decides how many cards
 * fit, and the virtualizer just reads the answer.
 *
 * With no scrolling ancestor (Storybook, tests) it renders the list
 * whole rather than truncating it.
 */
export function VirtualGrid<T>({
  items,
  getItemKey,
  renderItem,
  rowClassName,
  estimateRowHeight,
  overscan = 2,
  className,
  footer,
}: VirtualGridProps<T>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);

  // `undefined` until the lookup has run, `null` once it has run and
  // found nothing — the two are different renders, not the same one.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null | undefined>(undefined);
  useIsoLayoutEffect(() => {
    setScrollEl(wrapperRef.current?.closest<HTMLElement>("[data-scroll-root]") ?? null);
  }, []);

  const [{ columns, rowGap }, setMetrics] = useState({ columns: 0, rowGap: 0 });
  useIsoLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const read = () => {
      // A probe with no box isn't laid out — the shells keep the
      // inactive one mounted under `display: none`, and an unlaid grid
      // reports its *specified* template ("repeat(1, minmax(0, 1fr))")
      // rather than resolved tracks. Keep the last real reading; the
      // observer fires again when the subtree comes back.
      if (probe.getBoundingClientRect().width === 0) return;
      const style = getComputedStyle(probe);
      const template = style.gridTemplateColumns;
      const next = {
        // Anything that isn't a grid (the flex-column list layouts) is
        // one item per row.
        columns: template && template !== "none" ? template.split(" ").length : 1,
        rowGap: Number.parseFloat(style.rowGap) || 0,
      };
      setMetrics((prev) =>
        prev.columns === next.columns && prev.rowGap === next.rowGap ? prev : next,
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [rowClassName]);

  const measuring = scrollEl === undefined || columns === 0;
  const virtualized = !measuring && scrollEl !== null && items.length > 0;
  const rowCount = virtualized ? Math.ceil(items.length / columns) : 0;

  const [scrollMargin, setScrollMargin] = useState(0);

  const virtualizer = useVirtualizer({
    enabled: virtualized,
    count: rowCount,
    getScrollElement: () => scrollEl ?? null,
    // Read where the page already is. The virtualizer doesn't sample the
    // scroll offset when it attaches — it only starts listening — and it
    // *pushes* its remembered offset onto the element, so leaving this at
    // the default 0 both renders the wrong rows and yanks the page back
    // to the top. Several of these share one scrollport (four shelves on
    // the jam board, one per expanded shelf), so every late attach would
    // do it again.
    initialOffset: () => scrollEl?.scrollTop ?? 0,
    estimateSize: () => estimateRowHeight,
    // Rows are absolutely positioned, so the CSS row gap between them
    // never applies — the virtualizer adds it to the offsets instead.
    gap: rowGap,
    overscan,
    scrollMargin,
    getItemKey: (rowIndex) => {
      const first = items[rowIndex * columns];
      return first === undefined ? rowIndex : getItemKey(first, rowIndex * columns);
    },
  });

  // Re-read after every render rather than on a dependency list: the
  // offset moves whenever anything above the list changes height — filter
  // chips appearing, a hero image loading, an earlier shelf correcting
  // its own estimate — and none of that is visible from in here. It only
  // reads (and only writes state on a real move), so scroll-driven
  // renders settle instead of looping.
  useIsoLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !scrollEl) return;
    const offset =
      sheet.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - offset) < 1 ? prev : offset));
  });

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      {/* An empty copy of one row, laid over the top edge so it costs no
          space in flow. The resolved `grid-template-columns` on it is
          what tells the virtualizer how many items share a row. */}
      <div
        ref={probeRef}
        aria-hidden
        className={cn(rowClassName, "pointer-events-none invisible absolute inset-x-0 top-0 h-0")}
      />

      {virtualized ? (
        <div
          ref={sheetRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * columns;
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className={cn(rowClassName, "absolute top-0 left-0 w-full")}
                style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
              >
                {items.slice(start, start + columns).map((item, i) => (
                  <Fragment key={getItemKey(item, start + i)}>
                    {renderItem(item, start + i)}
                  </Fragment>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={rowClassName}>
          {(measuring ? items.slice(0, UNMEASURED_ITEMS) : items).map((item, i) => (
            <Fragment key={getItemKey(item, i)}>{renderItem(item, i)}</Fragment>
          ))}
        </div>
      )}

      {footer}
    </div>
  );
}
