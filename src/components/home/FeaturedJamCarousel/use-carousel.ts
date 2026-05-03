import { useEffect, useState } from "react";

import { ROTATE_MS } from "./helpers";

export interface UseCarouselResult {
  index: number;
  direction: 1 | -1;
  paused: boolean;
  goPrev: () => void;
  goNext: () => void;
  goToNub: (target: number) => void;
  togglePause: () => void;
}

/**
 * Owns the carousel's index/direction/paused state and the auto-rotate
 * timer. Manual navigation (`goPrev`/`goNext`/`goToNub`) restarts the
 * timer so taps don't fire a new auto-advance moments later.
 */
export function useCarousel(jamCount: number): UseCarouselResult {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);

  // Reset to start whenever the underlying list changes shape.
  useEffect(() => {
    setIndex((i) => (i >= jamCount ? 0 : i));
  }, [jamCount]);

  // Auto-rotate. `index` is in deps so any manual navigation (which
  // calls setIndex) restarts the timer.
  useEffect(() => {
    if (paused || jamCount <= 1) return;
    const id = window.setInterval(() => {
      setDirection(1);
      setIndex((i) => (i + 1) % jamCount);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, jamCount, index]);

  const goTo = (next: number, dir: 1 | -1) => {
    if (jamCount <= 1) return;
    const normalized = ((next % jamCount) + jamCount) % jamCount;
    if (normalized === index) return;
    setDirection(dir);
    setIndex(normalized);
  };

  return {
    index,
    direction,
    paused,
    goPrev: () => goTo(index - 1, -1),
    goNext: () => goTo(index + 1, 1),
    goToNub: (target: number) => goTo(target, target >= index ? 1 : -1),
    togglePause: () => setPaused((p) => !p),
  };
}
