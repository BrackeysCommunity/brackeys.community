import { createEffectLayer, type EffectLayer } from "@jams/engine";

/** What hit-stop drives: any loop with a time scale. */
type Clock = { setTimeScale(scale: number): void; getTimeScale(): number };

/**
 * A host with its own loop and canvas: the flash covers `over` (a div laid
 * over the canvas, under the UI), and hit-stop holds the loop's clock.
 */
export function hostEffects(
  over: HTMLElement,
  loop: Clock,
  prefersCalm: () => boolean,
): EffectLayer {
  const effects = createEffectLayer(over, loop, { reducedMotion: prefersCalm });
  effects.flash({ color: 0xff3344, ms: 150 });
  effects.hitStop(80);
  return effects;
}
