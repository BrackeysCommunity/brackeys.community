import { useJamGradient } from "@/components/jams/JamCalendarPage/board/use-jam-color";
import { DotGrid } from "@/components/ui/dot-grid";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { MediaCardImage } from "@/components/ui/media-card";
import { jamInk, safeThemeColor } from "@/lib/jam-palette";
import type { SearchHit } from "@/lib/search-hits";
import { cn } from "@/lib/utils";

export type MediaHit = Extract<SearchHit, { kind: "jam" | "entry" | "project" }>;

/** Kinds whose hits carry artwork, and so render as tiles. */
export function isMediaHit<T extends SearchHit>(hit: T): hit is T & MediaHit {
  return hit.kind === "jam" || hit.kind === "entry" || hit.kind === "project";
}

export function hitArtUrl(hit: MediaHit): string | null {
  return hit.kind === "jam" ? hit.bannerUrl : hit.coverUrl;
}

/**
 * A hit's artwork in a fixed frame, or the house dot field where it has
 * none. `cover` crops to fill a small tile; `contain` shows all of it over
 * a blurred copy, for the preview pane.
 */
export function SearchArt({
  hit,
  fit = "cover",
  className,
}: {
  hit: MediaHit;
  fit?: "cover" | "contain";
  className?: string;
}) {
  const src = hitArtUrl(hit);
  const frame = cn("relative aspect-[315/250] w-full overflow-hidden rounded-md", className);
  const background =
    hit.kind === "entry" ? (safeThemeColor(hit.coverColor) ?? "var(--muted)") : "var(--muted)";

  if (!src) {
    return hit.kind === "jam" ? (
      <JamFallback jamId={hit.id} themeColor={hit.themeColor} className={frame} />
    ) : (
      <div className={frame} style={{ background }}>
        <DotGrid />
      </div>
    );
  }
  return (
    <div className={frame} style={{ background }}>
      {fit === "contain" ? (
        <MediaCardImage src={src} />
      ) : (
        <HoverPlayImage
          src={src}
          transform={{ width: 320 }}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function JamFallback({
  jamId,
  themeColor,
  className,
}: {
  jamId: number;
  themeColor: string | null;
  className: string;
}) {
  const gradient = useJamGradient({ jamId, themeColor });
  return (
    <div
      className={className}
      style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
    >
      <DotGrid color={jamInk(gradient[0])} />
    </div>
  );
}
