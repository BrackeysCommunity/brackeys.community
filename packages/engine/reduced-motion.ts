/** The page's prefers-reduced-motion query; null where media queries aren't available. */
export function reducedMotionQuery(canvas: HTMLCanvasElement): MediaQueryList | null {
  try {
    const view = canvas.ownerDocument.defaultView;
    return typeof view?.matchMedia === "function"
      ? view.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  } catch {
    return null;
  }
}

/** A reduced-motion option as it stands now: a getter is read on each call; omitted is false. */
export const readFlag = (v: boolean | (() => boolean) | undefined): boolean =>
  typeof v === "function" ? v() : (v ?? false);
