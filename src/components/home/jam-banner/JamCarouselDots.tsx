import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";

import { PAGE_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

/**
 * Slide index plus the way it last moved, so the outgoing slide can leave
 * on the side it's heading away from. Reads modulo `count`: a pin change
 * can shrink the deck under a live index.
 *
 * `key` changes on every move and belongs on the sliding element instead of
 * the slide's id: keyed by id, a quick back-and-forth brings a slide back
 * while it's still exiting, and framer reverses that exit in place rather
 * than entering it from the side the move came from.
 */
export function useCarouselSlide(count: number) {
  const [{ index, direction, key }, setState] = useState({ index: 0, direction: 1, key: 0 });
  const slide = count > 0 ? index % count : 0;
  const step = useCallback(
    (by: 1 | -1) =>
      setState((prev) => ({
        index: ((prev.index % count) + by + count) % count,
        direction: by,
        key: prev.key + 1,
      })),
    [count],
  );
  const go = useCallback(
    (to: number) =>
      setState((prev) =>
        to === prev.index % count
          ? prev
          : { index: to, direction: to < prev.index % count ? -1 : 1, key: prev.key + 1 },
      ),
    [count],
  );
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  return { slide, direction, key, go, next, prev };
}

/**
 * Enter/exit for a sliding banner, keyed on `custom` — the direction, or 0
 * for a plain fade under reduced motion. Pass the same value to the
 * `AnimatePresence` so the exiting slide sees the latest direction.
 */
export const CAROUSEL_SLIDE_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, x: 32 * direction }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: -32 * direction }),
};

/**
 * The slide indicators both hero carousels share — the landing panel's and
 * the admin preview's, so staff page through exactly the control visitors
 * get. Positioning belongs to the caller via `className`; this is only the
 * row of dots; {@link JamCarouselArrows} is the separate prev/next pair.
 */
export function JamCarouselDots({
  slides,
  active,
  onSelect,
  countdown,
  className,
}: {
  slides: readonly { jamId: number; title: string }[];
  active: number;
  onSelect: (index: number) => void;
  /**
   * Drains the active pill's fill over each slide's hold, emptying just as
   * the carousel advances. While not running the pill sits full — matching
   * the paused timer, which restarts a whole hold on resume. Omit for a
   * solid pill.
   */
  countdown?: { durationMs: number; running: boolean };
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {slides.map((slide, i) => {
        const current = i === active;
        return (
          <button
            key={slide.jamId}
            type="button"
            aria-label={`Show ${slide.title}`}
            aria-current={current}
            onClick={() => onSelect(i)}
            {...PAGE_CUES}
            className={cn(
              "h-2.5 cursor-pointer overflow-hidden rounded-full shadow-sm ring-1 ring-background/70 transition-all",
              current
                ? cn("w-7", countdown ? "bg-foreground/25" : "bg-primary")
                : "w-2.5 bg-foreground/60 hover:bg-foreground/90",
            )}
          >
            {current && countdown && (
              // A fresh mount on every slide change (the pill moves to a new
              // keyed button) restarts the drain; dropping the class while
              // paused snaps it back to full for the same reason.
              <span
                className={cn(
                  "block h-full w-full bg-primary",
                  countdown.running && "animate-carousel-drain",
                )}
                style={
                  countdown.running ? { animationDuration: `${countdown.durationMs}ms` } : undefined
                }
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Wrap-around prev/next buttons; positioning belongs to the caller. */
export function JamCarouselArrows({
  onPrev,
  onNext,
  className,
}: {
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <CarouselArrow side="prev" onClick={onPrev} />
      <CarouselArrow side="next" onClick={onNext} />
    </div>
  );
}

function CarouselArrow({ side, onClick }: { side: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "prev" ? "Previous slide" : "Next slide"}
      onClick={onClick}
      {...PAGE_CUES}
      className="flex size-5 cursor-pointer items-center justify-center rounded-full bg-background/70 text-foreground/80 shadow-sm ring-1 ring-background/70 backdrop-blur-sm transition-colors hover:bg-background/90 hover:text-primary"
    >
      <HugeiconsIcon icon={side === "prev" ? ArrowLeft01Icon : ArrowRight01Icon} size={12} />
    </button>
  );
}
