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
  className,
}: {
  slides: readonly { jamId: number; title: string }[];
  active: number;
  onSelect: (index: number) => void;
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
              "h-2.5 cursor-pointer rounded-full shadow-sm ring-1 ring-background/70 transition-all",
              current ? "w-7 bg-primary" : "w-2.5 bg-foreground/60 hover:bg-foreground/90",
            )}
          />
        );
      })}
    </div>
  );
}
