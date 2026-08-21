import { useCallback, useState } from "react";

import { useOptionalAppSettings } from "@/lib/hooks/use-app-settings";

/**
 * Hold an animated image on its first frame until the pointer is over it.
 * `animated` is the playing source, or null when there is nothing to hold back.
 * Under reduced motion nothing arms — the still is all there is, hover or not.
 *
 * `handlers` covers the common case (hover the element itself); `play`/`stop`
 * are for callers that watch a larger hover surface, like a whole card.
 */
export function useHoverPlay(animated: string | null) {
  const [playing, setPlaying] = useState(false);
  // Optional so stories/tests without the provider still render.
  const reduced = useOptionalAppSettings()?.reduceMotion ?? false;
  const armed = animated != null && !reduced;

  const play = useCallback(() => setPlaying(true), []);
  const stop = useCallback(() => setPlaying(false), []);

  return {
    playing: armed && playing,
    armed,
    play,
    stop,
    handlers: armed ? { onPointerEnter: play, onPointerLeave: stop } : {},
  };
}
