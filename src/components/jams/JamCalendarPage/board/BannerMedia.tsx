import { motion } from "framer-motion";
import { useState } from "react";

import { DotGrid } from "@/components/ui/dot-grid";
import { BOARD_BANNER_TRANSFORM, itchImageUrl } from "@/lib/itch-image";
import { cn } from "@/lib/utils";

import type { JamFromList } from "../helpers";
import { ROW_CLOSE_TRANSITION } from "./transitions";
import { useJamGradient } from "./use-jam-color";

/**
 * Banner slot shared by every board surface (list-row thumb, shelf
 * card, featured card). Carries the `tl-banner-${layoutKey}` shared
 * layoutId so the detail modal's banner morph works from any of them.
 *
 * The no-image fallback is the house `DotGrid` over a static CSS
 * gradient, NOT a Grainient: even
 * virtualized, a shelf keeps a couple of screenfuls of surfaces mounted,
 * and one WebGL context per jam blows past the browser's context limit
 * (~16) long before that, leaving blank white canvases. The animated
 * Grainient is reserved for the modal.
 */
export function JamBanner({
  jam,
  layoutKey,
  fit = "cover",
}: {
  jam: JamFromList;
  layoutKey: string;
  /** `contain` letterboxes the full artwork against the container's
   * background (the jam's itch theme color) — the same look as the
   * jam's own itch page header. */
  fit?: "cover" | "contain";
}) {
  const gradient = useJamGradient(jam);
  const [imageOk, setImageOk] = useState(true);

  if (jam.bannerUrl && imageOk) {
    return (
      <motion.img
        layoutId={`tl-banner-${layoutKey}`}
        transition={ROW_CLOSE_TRANSITION}
        // BOARD_BANNER_TRANSFORM is shared with the modal's crisp layer:
        // both ends of the layoutId morph must fetch the identical URL.
        src={itchImageUrl(jam.bannerUrl, BOARD_BANNER_TRANSFORM)}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        onError={() => setImageOk(false)}
        className={cn(
          "absolute inset-0 h-full w-full",
          fit === "contain" ? "object-contain" : "object-cover",
        )}
      />
    );
  }
  return (
    <motion.div
      layoutId={`tl-banner-${layoutKey}`}
      transition={ROW_CLOSE_TRANSITION}
      className="absolute inset-0"
      style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
    >
      <DotGrid />
    </motion.div>
  );
}
