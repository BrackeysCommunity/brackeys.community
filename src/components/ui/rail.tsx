import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ShelfHeader } from "@/components/ui/shelf-header";
import { useDragScroll } from "@/lib/hooks/use-drag-scroll";
import { cn } from "@/lib/utils";

/**
 * Bleed and fade width in one string, mirroring the page shell's `p-4` /
 * `sm:px-6` / `lg:px-10` / `xl:px-14` padding: the rail runs to the
 * viewport edge, and the padding puts the gutter back *inside* the
 * scrollport so the first tile isn't flush to the edge. `--rail-fade`
 * tracks the same measure so the edge fade covers exactly the bleed and
 * never eats into a tile.
 */
const RAIL_GUTTERS =
  "-mx-4 px-4 [--rail-fade:1rem] sm:-mx-6 sm:px-6 sm:[--rail-fade:1.5rem] lg:-mx-10 lg:px-10 lg:[--rail-fade:2.5rem] xl:-mx-14 xl:px-14 xl:[--rail-fade:3.5rem]";

/**
 * Vertical breathing room inside the scrollport. `overflow-x` clips the
 * cross axis too, so without this a tile's hover lift, drop shadow, or
 * focus ring gets sheared off at the rail's edge.
 */
const RAIL_PADDING = "py-1.5";

/** Scrollbar hidden across engines — the fade and the arrows carry the
 * overflow affordance, and a gutter-wide scrollbar re-crops the tiles. */
const RAIL_SCROLLBAR =
  "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** How far an arrow press travels, as a share of the visible rail. */
const PAGE_FRACTION = 0.8;

/**
 * A titled horizontal carousel that bleeds to the viewport edges: a run
 * of fixed-width tiles that reads as a highlight rather than a listing,
 * with the last tile visibly cut off so it doesn't end in a tidy column
 * that says "that's all of them".
 *
 * The whole shelf is the component — heading, blurb, paging arrows, and
 * the scrollport — so a rail is one call and every rail on the site
 * behaves the same. Overflow in either direction is signalled by a mask
 * fade on that edge plus its arrow; pointer users can also grab the rail
 * and throw it, touch users just swipe.
 *
 * The rail free-scrolls: it stops where the throw ran out rather than
 * landing on a tile. Scroll snapping is what a carousel usually reaches
 * for here, and it fights everything else on the surface — it hijacks the
 * end of a drag, and it chases any tile being animated out of the rail,
 * dragging the whole run along behind it. The arrows are the one place
 * position is chosen for you, and they page by a screenful.
 *
 * Children are the tiles themselves, direct and `shrink-0`.
 */
export function Rail({
  title,
  blurb,
  variant = "display",
  label,
  className,
  children,
}: {
  title?: string;
  blurb?: string;
  /** `display` is a section heading; `label` is the lighter micro-label
   * treatment, for a rail that sits under a page's real heading. */
  variant?: "display" | "label";
  /** What the arrows say they scroll ("featured jams"). Defaults to the
   * title, which is usually already the answer. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const { dragging } = useDragScroll(el);

  const syncEdges = useCallback(() => {
    if (!el) return;
    // 4px slack absorbs sub-pixel scroll positions at the extremes.
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [el]);

  useEffect(() => {
    if (!el) return;
    syncEdges();
    el.addEventListener("scroll", syncEdges, { passive: true });
    // The tiles are watched too, not just the scrollport: a rail whose
    // content arrives with a fetch grows `scrollWidth` without ever
    // resizing the scroller itself.
    const sizes = new ResizeObserver(syncEdges);
    const observeAll = () => {
      sizes.observe(el);
      for (const child of Array.from(el.children)) sizes.observe(child);
    };
    observeAll();
    const children = new MutationObserver(() => {
      observeAll();
      syncEdges();
    });
    children.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", syncEdges);
      sizes.disconnect();
      children.disconnect();
    };
  }, [el, syncEdges]);

  const page = (direction: 1 | -1) => {
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * PAGE_FRACTION, behavior: "smooth" });
  };

  const maskImage = `linear-gradient(to right, ${
    edges.start ? "transparent 0, black var(--rail-fade)" : "black 0"
  }, ${edges.end ? "black calc(100% - var(--rail-fade)), transparent 100%" : "black 100%"})`;

  return (
    <section className="flex flex-col gap-3">
      {(title || blurb) && (
        <ShelfHeader
          title={title}
          blurb={blurb}
          variant={variant}
          actions={
            <div className="flex items-center gap-1.5">
              <PageButton
                side="start"
                label={label ?? title ?? "the rail"}
                enabled={edges.start}
                onClick={() => page(-1)}
              />
              <PageButton
                side="end"
                label={label ?? title ?? "the rail"}
                enabled={edges.end}
                onClick={() => page(1)}
              />
            </div>
          }
        />
      )}

      <div
        ref={setEl}
        className={cn(
          "flex cursor-grab gap-3 overflow-x-auto overscroll-x-contain",
          RAIL_GUTTERS,
          RAIL_PADDING,
          RAIL_SCROLLBAR,
          // The descendant selector outranks each tile's own
          // `cursor-pointer`, so the grab cursor holds across the rail.
          dragging && "cursor-grabbing select-none [&_*]:cursor-grabbing",
          className,
        )}
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        {children}
      </div>
    </section>
  );
}

function PageButton({
  side,
  label,
  enabled,
  onClick,
}: {
  side: "start" | "end";
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={onClick}
      disabled={!enabled}
      aria-label={`Scroll ${label.toLowerCase()} ${side === "start" ? "left" : "right"}`}
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
