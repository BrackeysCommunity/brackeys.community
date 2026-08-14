import { BACKDROP_TRANSFORM, itchImageUrl } from "@/lib/itch-image";
import { cn } from "@/lib/utils";

/**
 * Shared shell for media-led tiles — the jam board's cards and the
 * collab board's card layout render through the same classes so the two
 * surfaces can't drift apart. Exported as class strings rather than
 * components because consumers need to own their root element (framer
 * `motion.button` with a `layoutId`, plain `button`, etc.).
 */
export const mediaCardClasses = {
  /** Card root — border, rounding, hover treatment. */
  frame:
    "group relative flex flex-col overflow-hidden rounded-lg border border-muted/30 bg-card text-left transition-colors hover:border-muted/60",
  /** Banner region at the top; give it a background color for letterboxing. */
  media: "relative h-40 w-full shrink-0 overflow-hidden",
  /** Text block under the banner. */
  body: "flex flex-1 flex-col gap-1.5 px-3 pt-2.5 pb-2.5",
} as const;

/** Bottom-edge gradient that eases the banner into the card body. */
export function MediaCardScrim() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card/70 to-transparent"
    />
  );
}

/**
 * Floating chip pinned to the banner's bottom-left, where the scrim
 * already darkens the art — for glanceable stats, not description.
 */
export function MediaCardFloatingBadge({
  children,
  as: Tag = "div",
  className,
}: {
  children: React.ReactNode;
  /** `span` for chips nested inside a phrasing-content-only ancestor. */
  as?: "div" | "span";
  className?: string;
}) {
  return (
    // `flex` rather than the default inline layout: a line box would size
    // itself to the inherited strut, not the 10px chip text, padding the
    // chip's top edge well past its bottom one.
    <Tag
      className={cn(
        "absolute bottom-2 left-2 flex items-center rounded bg-background/75 px-1.5 py-0.5 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Letterboxed artwork that fills its frame: the whole image is shown
 * `object-contain` over a blurred, over-scaled `object-cover` copy of
 * itself. User-uploaded post art is small and roughly square, so
 * cropping it to the banner's aspect destroys it and plain letterboxing
 * leaves dead bars — this keeps the art intact and the frame full.
 *
 * The backdrop is scaled past the edges because a blur samples beyond
 * the element's box and would otherwise fade out at the seams.
 */
export function MediaCardImage({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  return (
    <>
      {/* itchImageUrl is host-gated: it only rewrites img.itch.zone URLs, so
          the MinIO-presigned collab images that also flow through here pass
          untouched. */}
      <img
        src={itchImageUrl(src, BACKDROP_TRANSFORM)}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full scale-125 object-cover blur-lg brightness-[0.6] saturate-150"
      />
      <img
        src={itchImageUrl(src, { width: 768 })}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn("relative h-full w-full object-contain", className)}
      />
    </>
  );
}

/**
 * Selection tint for a card. Rendered as an overlay rather than a
 * background class because a `bg-*` utility on the card root replaces
 * the card's own surface instead of tinting it, leaving the page
 * visible through the tile.
 */
export function MediaCardSelectedTint() {
  return <span aria-hidden className="pointer-events-none absolute inset-0 bg-primary/10" />;
}
