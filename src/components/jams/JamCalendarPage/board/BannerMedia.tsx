import { useState } from "react";

import { DotGrid } from "@/components/ui/dot-grid";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { BOARD_BANNER_TRANSFORM } from "@/lib/itch-image";
import { cn } from "@/lib/utils";

import type { JamFromList } from "../helpers";
import { useJamGradient } from "./use-jam-color";

/**
 * Banner slot shared by every board surface (list-row thumb, shelf
 * card, featured card).
 *
 * The no-image fallback is the house `DotGrid` over a static CSS
 * gradient, NOT a Grainient: even
 * virtualized, a shelf keeps a couple of screenfuls of surfaces mounted,
 * and one WebGL context per jam blows past the browser's context limit
 * (~16) long before that, leaving blank white canvases. The animated
 * Grainient is reserved for the modal.
 *
 * Animated banners hold their first frame until hovered; the playing copy
 * layers over the still so the first hover doesn't blink while it loads.
 */
export function JamBanner({
  jam,
  fit = "cover",
}: {
  jam: JamFromList;
  /** `contain` letterboxes the full artwork against the container's
   * background (the jam's itch theme color) — the same look as the
   * jam's own itch page header. */
  fit?: "cover" | "contain";
}) {
  const gradient = useJamGradient(jam);
  const [imageOk, setImageOk] = useState(true);

  const objectFit = fit === "contain" ? "object-contain" : "object-cover";

  if (jam.bannerUrl && imageOk) {
    return (
      <HoverPlayImage
        src={jam.bannerUrl}
        transform={BOARD_BANNER_TRANSFORM}
        loading="lazy"
        onError={() => setImageOk(false)}
        className={cn("absolute inset-0 h-full w-full", objectFit)}
      />
    );
  }
  return (
    <div
      className="absolute inset-0"
      style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
    >
      <DotGrid />
    </div>
  );
}
