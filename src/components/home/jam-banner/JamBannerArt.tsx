import { Badge } from "@/components/ui/badge";
import { DotGrid } from "@/components/ui/dot-grid";
import { Text } from "@/components/ui/typography";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { type effectiveJamState } from "@/lib/jam-countdown";
import { hostName } from "@/lib/jam-links";
import { hoverPlaySources } from "@/lib/still-image";

import { type JamLike, shortName } from "./types";

type JamState = ReturnType<typeof effectiveJamState>;

/**
 * The foreground of a jam banner: the crisp `object-contain` art, the host
 * chip, and — for jams with no art at all — the acronym stand-in.
 *
 * Rendered as bare absolutely-positioned children so the caller owns the
 * wrapper: the carousel puts these inside its sliding `motion.div`, the
 * hero panel inside a plain box.
 */
export function JamBannerArt({ jam, isCompact }: { jam: JamLike; isCompact: boolean }) {
  // The hero is the one card surface where an animated banner plays
  // unprompted — reduced motion pins it to its first frame instead.
  const reduced = useReducedMotion();
  const art = jam.bannerUrl ? hoverPlaySources(jam.bannerUrl, { width: 960, quality: 70 }) : null;

  return (
    <>
      {!jam.bannerUrl && <DotGrid className="absolute inset-0" />}

      {art && (
        <img
          src={reduced ? art.still : art.rendered}
          alt=""
          aria-hidden
          className="absolute inset-0 block h-full w-full object-contain"
        />
      )}

      {jam.hosts[0] && (
        <div className={`absolute ${isCompact ? "top-3 right-3" : "top-4 right-4"} z-10`}>
          <Badge variant="secondary" className="tracking-widest uppercase">
            {hostName(jam)}
          </Badge>
        </div>
      )}

      {!jam.bannerUrl && (
        <Text
          bold
          density="dense"
          className={`absolute right-3 bottom-3 ${isCompact ? "text-3xl" : "text-5xl"} z-10 tracking-tighter text-foreground/40`}
        >
          {shortName(jam.title)}
        </Text>
      )}
    </>
  );
}

/**
 * LIVE / UPCOMING / ENDED chip. In the carousel it is anchored outside the
 * slide motion layer so it swaps instantly with the active jam rather than
 * translating with the art.
 */
export function JamStateBadge({ state }: { state: JamState }) {
  if (state === "running") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-destructive-foreground opacity-75" />
          <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
        </span>
        LIVE
      </Badge>
    );
  }
  return <Badge variant="secondary">{state.toUpperCase()}</Badge>;
}
