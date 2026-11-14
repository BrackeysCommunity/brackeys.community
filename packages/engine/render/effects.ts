/**
 * Full-canvas effects: a flash over every viewport, under the UI layer, and
 * hit-stop, which stops the loop's clock for a stretch of wall time so no
 * tick runs and the run's digest is unchanged. Plain DOM, CSS opacity and
 * timers, so every browser behaves alike.
 */
import type { GameLoop } from "../loop";

export interface EffectLayer {
  /** A full-canvas colour (0xRRGGBB) fading over `ms`; reduced motion caps it at 0.3 alpha and 80 ms. */
  flash(opts?: { color?: number; ms?: number; alpha?: number }): void;
  /** Time scale 0 for `ms` of wall time, then the scale before; overlapping stops extend to the latest end. */
  hitStop(ms: number): void;
  clear(): void;
}

const FLASH_MS = 120;
const FLASH_ALPHA = 0.8;
const FLASH_COLOR = 0xffffff;
const REDUCED_FLASH_MS = 80;
const REDUCED_FLASH_ALPHA = 0.3;

const hexColor = (color: number): string =>
  `#${(Math.trunc(color) & 0xffffff).toString(16).padStart(6, "0")}`;

const positive = (n: number | undefined): n is number =>
  n !== undefined && Number.isFinite(n) && n > 0;

/** An effect layer over `layer` (a div over the canvas), driving `loop`'s time scale. */
export function createEffectLayer(
  layer: HTMLElement,
  loop: Pick<GameLoop, "setTimeScale" | "getTimeScale">,
  opts: { reducedMotion: () => boolean },
): EffectLayer {
  const flashes = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  let stop: { end: number; prevScale: number; timer: ReturnType<typeof setTimeout> } | null = null;

  function removeFlash(el: HTMLElement): void {
    const timer = flashes.get(el);
    if (timer !== undefined) clearTimeout(timer);
    flashes.delete(el);
    el.remove();
  }

  function endStop(): void {
    if (!stop) return;
    clearTimeout(stop.timer);
    const { prevScale } = stop;
    stop = null;
    // A scale someone set during the stop is theirs to keep.
    if (loop.getTimeScale() === 0) loop.setTimeScale(prevScale);
  }

  return {
    flash(o = {}) {
      const reduced = opts.reducedMotion();
      let ms = positive(o.ms) ? o.ms : FLASH_MS;
      let alpha = o.alpha !== undefined && Number.isFinite(o.alpha) ? o.alpha : FLASH_ALPHA;
      alpha = Math.min(1, Math.max(0, alpha));
      if (reduced) {
        ms = Math.min(ms, REDUCED_FLASH_MS);
        alpha = Math.min(alpha, REDUCED_FLASH_ALPHA);
      }
      const el = layer.ownerDocument.createElement("div");
      el.setAttribute("data-jams-flash", "");
      Object.assign(el.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        background: hexColor(o.color ?? FLASH_COLOR),
        opacity: String(alpha),
      } satisfies Partial<CSSStyleDeclaration>);
      layer.append(el);
      // Commit the starting opacity before the transition, so the fade runs from it.
      void el.offsetWidth;
      el.style.transition = `opacity ${ms}ms linear`;
      el.style.opacity = "0";
      flashes.set(
        el,
        setTimeout(() => removeFlash(el), ms),
      );
    },

    hitStop(ms) {
      if (!positive(ms)) return;
      const end = Date.now() + ms;
      if (stop) {
        if (end <= stop.end) return;
        clearTimeout(stop.timer);
        stop.end = end;
        stop.timer = setTimeout(endStop, ms);
        return;
      }
      const prevScale = loop.getTimeScale();
      loop.setTimeScale(0);
      stop = { end, prevScale, timer: setTimeout(endStop, ms) };
    },

    clear() {
      for (const el of [...flashes.keys()]) removeFlash(el);
      endStop();
    },
  };
}
