import { useEffect, useRef } from "react";

/**
 * The scroll container for a wizard's step body, reset to the top whenever
 * the step changes.
 *
 * The three stepped surfaces used to scroll in an inner `h-full` element
 * inside an `overflow-hidden` flex item, which is the one arrangement in the
 * app that does not reliably scroll: the height came from a percentage of a
 * flex item that has no specified height of its own, so a body taller than
 * the modal was clipped by the wrapper rather than scrolled by the child.
 * Every surface that has always scrolled — the moderation shell, the three
 * discovery pages — puts `overflow-y-auto` on the flex item itself. These do
 * now too.
 *
 * The reset is what the old arrangement got for free: the inner scroller was
 * keyed on the step, so each one mounted at the top. With one stable
 * container, advancing from the bottom of a long step would otherwise leave
 * the next one scrolled halfway down.
 */
export function useStepScroll(step: unknown) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Not smooth: this is a new screen, not a movement within one.
    ref.current?.scrollTo({ top: 0 });
  }, [step]);

  return ref;
}
