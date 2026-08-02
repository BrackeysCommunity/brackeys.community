import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { JamFromList } from "../helpers";
import { FeaturedCard } from "./FeaturedCard";
import { ShelfHeader } from "./ShelfHeader";

/**
 * Width of the fade at each end of the rail — a CSS variable set per
 * breakpoint on the scroller so the fade covers exactly the bleed
 * gutter and never eats into the snapped cards.
 */
const FADE = "var(--shelf-fade)";

/**
 * The featured shelf: a horizontal snap carousel, the only one on the
 * board. The rail bleeds to the viewport edge below `lg` (negative
 * margins mirror the page shell's `p-4` / `sm:px-6` / `lg:px-10` /
 * `xl:px-14` padding) with matching scroll padding so snapped cards
 * align with the page gutter.
 *
 * Overflow in either direction is signalled by a mask fade on that edge
 * plus a paging arrow in the shelf header. The arrows are pointer-only,
 * since touch users just swipe.
 */
export function FeaturedShelf({
  jams,
  now,
  selectedKey,
  onSelect,
}: {
  jams: JamFromList[];
  now: Date;
  selectedKey: string | null;
  onSelect: (jam: JamFromList, layoutKey: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 4px slack absorbs sub-pixel scroll positions at the extremes.
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncEdges();
    el.addEventListener("scroll", syncEdges, { passive: true });
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", syncEdges);
      observer.disconnect();
    };
  }, [syncEdges, jams.length]);

  const page = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const maskImage = `linear-gradient(to right, ${
    edges.start ? `transparent 0, black ${FADE}` : "black 0"
  }, ${edges.end ? `black calc(100% - ${FADE}), transparent 100%` : "black 100%"})`;

  return (
    <section className="flex flex-col gap-3">
      <ShelfHeader
        title="FEATURED"
        blurb="the biggest jams on the board"
        actions={
          <div className="flex items-center gap-1.5">
            <PageButton side="start" enabled={edges.start} onClick={() => page(-1)} />
            <PageButton side="end" enabled={edges.end} onClick={() => page(1)} />
          </div>
        }
      />
      <div
        ref={scrollerRef}
        className="-mx-4 flex snap-x scroll-pl-4 gap-3 overflow-x-auto px-4 pb-1 [--shelf-fade:1rem] [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-pl-6 sm:px-6 sm:[--shelf-fade:1.5rem] lg:-mx-10 lg:scroll-pl-10 lg:px-10 lg:[--shelf-fade:2.5rem] xl:-mx-14 xl:scroll-pl-14 xl:px-14 xl:[--shelf-fade:3.5rem] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        {jams.map((jam) => {
          const layoutKey = `feat-${jam.jamId}`;
          return (
            <FeaturedCard
              key={jam.jamId}
              jam={jam}
              now={now}
              layoutKey={layoutKey}
              isSelected={selectedKey === layoutKey}
              onSelect={() => onSelect(jam, layoutKey)}
            />
          );
        })}
      </div>
    </section>
  );
}

function PageButton({
  side,
  enabled,
  onClick,
}: {
  side: "start" | "end";
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={onClick}
      disabled={!enabled}
      aria-label={side === "start" ? "Scroll featured jams left" : "Scroll featured jams right"}
      className={cn(
        // Pointer-only: touch users swipe the rail directly. Stated as
        // a hide-on-coarse variant rather than a show-on-fine one — a
        // base `hidden` would outrank the variant that unhides it.
        "flex [@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden",
      )}
    >
      <HugeiconsIcon icon={side === "start" ? ArrowLeft01Icon : ArrowRight01Icon} size={14} />
    </Button>
  );
}
