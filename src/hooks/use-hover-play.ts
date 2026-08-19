import { useState } from "react";

/**
 * Hold an animated image on its first frame until the pointer is over it.
 * `animated` is the playing source, or null when there is nothing to hold back.
 */
export function useHoverPlay(animated: string | null) {
  const [playing, setPlaying] = useState(false);

  return {
    playing: animated != null && playing,
    handlers: animated
      ? { onPointerEnter: () => setPlaying(true), onPointerLeave: () => setPlaying(false) }
      : {},
  };
}
