import { PAGE_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

/**
 * The slide indicators both hero carousels share — the landing panel's and
 * the admin preview's, so staff page through exactly the control visitors
 * get. Positioning belongs to the caller via `className`; this is only the
 * row of dots.
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
    <div className={cn("flex gap-2", className)}>
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
