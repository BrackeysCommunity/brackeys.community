import { AnimatePresence, motion } from "framer-motion";

import { Grainient } from "@/components/ui/grainient";
import { BACKDROP_TRANSFORM, itchImageUrl } from "@/lib/itch-image";

/** Shared by the backdrop's fades and the carousel's slide motion, so the
 * art and the wash behind it move on the same clock. */
export const BANNER_TRANSITION = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

interface JamBannerBackdropProps {
  /** Identity of the jam being shown — drives the cross-fade when it changes. */
  jamId: number;
  bannerUrl: string | null;
  bgColor1: string;
  bgColor2: string;
}

/**
 * The three backdrop layers every jam banner sits on, back to front:
 *
 * 1. Colored Grainient — always mounted; its colors lerp toward
 *    `bgColor1`/`bgColor2`. Container opacity fades to 0 when a photo
 *    banner is showing so the photo takes over.
 * 2. Blurred banner image — cross-fades between photo jams via
 *    AnimatePresence; absent for jams without `bannerUrl`.
 * 3. Grain-only Grainient overlay — grayscale film-grain in
 *    `mix-blend-overlay`, takes its colorway from whatever is beneath.
 *
 * Extracted from the carousel so the hero's single-jam panel gets the same
 * treatment without re-deriving the stack (the two drifting apart is what
 * would make the hero read as a different product than the rail below it).
 */
export function JamBannerBackdrop({
  jamId,
  bannerUrl,
  bgColor1,
  bgColor2,
}: JamBannerBackdropProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: bannerUrl ? 0 : 1 }}
        transition={BANNER_TRANSITION}
      >
        <Grainient color1={bgColor1} color2={bgColor2} color3={bgColor1} />
      </motion.div>
      <AnimatePresence initial={false}>
        {bannerUrl && (
          <motion.img
            key={jamId}
            src={itchImageUrl(bannerUrl, BACKDROP_TRANSFORM)}
            alt=""
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={BANNER_TRANSITION}
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl saturate-150"
          />
        )}
      </AnimatePresence>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay"
      >
        <Grainient grainOnly grainAmount={0.45} grainScale={3} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-background/20" />
    </div>
  );
}
