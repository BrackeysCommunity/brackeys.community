import { AnimatePresence, motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Grainient } from "@/components/ui/grainient";
import { Text } from "@/components/ui/typography";
import { type effectiveJamState } from "@/lib/jam-countdown";

import {
  BANNER_TRANSITION,
  type JamLike,
  shortName,
  slideVariants,
  SWIPE_OFFSET,
  SWIPE_VELOCITY,
} from "./helpers";

type JamState = ReturnType<typeof effectiveJamState>;

interface JamBannerProps {
  jam: JamLike;
  jamCount: number;
  state: JamState;
  isCompact: boolean;
  height: string;
  bgColor1: string;
  bgColor2: string;
  direction: 1 | -1;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * The visual top half of a slide. Three independently animated layers,
 * back to front:
 *
 * 1. Colored Grainient — always mounted; its colors lerp toward
 *    `bgColor1`/`bgColor2`. Container opacity fades to 0 when a photo
 *    banner is showing so the photo takes over.
 * 2. Blurred banner image — cross-fades between photo jams via
 *    AnimatePresence; absent for jams without `bannerUrl`.
 * 3. Grain-only Grainient overlay — grayscale film-grain in
 *    `mix-blend-overlay`, takes its colorway from whatever is beneath.
 *
 * On top of the stack:
 * - A draggable swipe layer carrying the foreground banner art (the
 *   crisp `object-contain` image) plus the host badge.
 * - The LIVE/state badge, anchored outside the swipe layer so it stays
 *   put as the art slides between jams.
 */
export function JamBanner({
  jam,
  jamCount,
  state,
  isCompact,
  height,
  bgColor1,
  bgColor2,
  direction,
  onPrev,
  onNext,
}: JamBannerProps) {
  return (
    <div className={`relative ${height} overflow-hidden`}>
      {/* Backdrop layers */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute inset-0"
          animate={{ opacity: jam.bannerUrl ? 0 : 1 }}
          transition={BANNER_TRANSITION}
        >
          <Grainient color1={bgColor1} color2={bgColor2} color3={bgColor1} />
        </motion.div>
        <AnimatePresence initial={false}>
          {jam.bannerUrl && (
            <motion.img
              key={jam.jamId}
              src={jam.bannerUrl}
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

      {/* Re-paint the Well's debossed top edge above the banner image so
          the deboss isn't obscured by full-bleed banners. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px]"
        style={{ background: "var(--deboss-shadow)" }}
      />

      {/* Swipe layer: dragging left advances, right rewinds. Snaps back
          via dragElastic if the threshold isn't crossed. */}
      <motion.div
        className="absolute inset-0"
        style={{ touchAction: "pan-y" }}
        drag={jamCount > 1 ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          const { offset, velocity } = info;
          if (offset.x < -SWIPE_OFFSET || velocity.x < -SWIPE_VELOCITY) onNext();
          else if (offset.x > SWIPE_OFFSET || velocity.x > SWIPE_VELOCITY) onPrev();
        }}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={jam.jamId}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={BANNER_TRANSITION}
            className="absolute inset-0"
          >
            {jam.bannerUrl && (
              <img
                src={jam.bannerUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 block h-full w-full object-contain"
              />
            )}

            {jam.hosts[0] && (
              <div className={`absolute ${isCompact ? "top-3 right-3" : "top-4 right-4"} z-10`}>
                <Badge variant="secondary" className="tracking-widest uppercase">
                  {jam.hosts[0].name}
                </Badge>
              </div>
            )}

            {!jam.bannerUrl && (
              <Text
                monospace
                bold
                density="dense"
                className={`absolute right-3 bottom-3 ${isCompact ? "text-3xl" : "text-5xl"} z-10 tracking-tighter text-foreground/40`}
              >
                {shortName(jam.title)}
              </Text>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* LIVE / state badge sits outside the slide motion layer so it
          stays anchored — it updates instantly with the active jam
          rather than translating, scaling, or fading with the art. */}
      <div
        className={`pointer-events-none absolute ${isCompact ? "top-3 left-3" : "top-4 left-4"} z-20`}
      >
        {state === "running" ? (
          <Badge variant="destructive" className="gap-1.5">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-destructive-foreground opacity-75" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
            </span>
            LIVE
          </Badge>
        ) : (
          <Badge variant="secondary">{state.toUpperCase()}</Badge>
        )}
      </div>
    </div>
  );
}
