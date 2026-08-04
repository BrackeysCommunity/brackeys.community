import { type RefObject, useEffect, useState } from "react";

/** Pointer travel that turns a press into a drag. Below this the gesture
 * is still a click, so cards in the rail keep opening on a normal press. */
const DRAG_THRESHOLD_PX = 5;
/** How far the release velocity is projected forward when choosing the
 * card to settle on — tuned so a flick carries about one card. */
const FLICK_PROJECTION_MS = 140;
/** Release samples older than this are stale: a pointer that came to rest
 * before the button came up carries no momentum. */
const STALE_VELOCITY_MS = 80;
/** Fallback for browsers without `scrollend`, and for a settle scroll
 * that never actually moves. */
const SETTLE_TIMEOUT_MS = 700;

export interface DragScrollState {
  /** A drag is under way — for the grabbing cursor and selection lock. */
  dragging: boolean;
  /** Scroll snapping has to stay off: the container yanks `scrollLeft`
   * back on every write mid-drag, and again while the release glide is
   * still travelling. Mirror this onto the element's `scrollSnapType`. */
  snapSuspended: boolean;
}

/**
 * Click-and-drag scrolling for a horizontal rail, mouse only — touch and
 * pen already pan natively and hijacking them costs the platform's
 * momentum and rubber-banding.
 *
 * The gesture stays a plain click until it passes `DRAG_THRESHOLD_PX`, so
 * clickable children are unaffected; past the threshold the drag takes
 * over and the click that follows the release is swallowed. Snapping is
 * suspended for the duration and restored once the rail has settled onto
 * the nearest snap position, picked from where the release velocity was
 * heading.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>, enabled = true): DragScrollState {
  const [state, setState] = useState<DragScrollState>({ dragging: false, snapSuspended: false });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let pressed = false;
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastTime = 0;
    /** px/ms in scroll space — positive means travelling right. */
    let velocity = 0;
    let settleTimer = 0;
    /** Tears down an in-flight settle without restoring snapping, so a
     * new grab isn't undone by the previous gesture's timer. */
    let abortSettle: (() => void) | null = null;

    const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

    /** Scroll offset that parks `child` against the rail's scroll padding —
     * measured from rects rather than `offsetLeft`, which is relative to
     * the offset parent and not to the scroller. */
    const snapOffsetOf = (child: Element, padLeft: number) =>
      el.scrollLeft +
      child.getBoundingClientRect().left -
      el.getBoundingClientRect().left -
      padLeft;

    const settle = () => {
      const padLeft = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
      const max = Math.max(el.scrollWidth - el.clientWidth, 0);
      const projected = clamp(el.scrollLeft + velocity * FLICK_PROJECTION_MS, max);

      let target = projected;
      let closest = Infinity;
      for (const child of Array.from(el.children)) {
        const offset = clamp(snapOffsetOf(child, padLeft), max);
        const distance = Math.abs(offset - projected);
        if (distance < closest) {
          closest = distance;
          target = offset;
        }
      }

      let done = false;
      const restore = () => {
        if (done) return;
        done = true;
        window.clearTimeout(settleTimer);
        el.removeEventListener("scrollend", restore);
        abortSettle = null;
        el.style.scrollSnapType = "";
        setState({ dragging: false, snapSuspended: false });
      };
      abortSettle = () => {
        done = true;
        window.clearTimeout(settleTimer);
        el.removeEventListener("scrollend", restore);
        abortSettle = null;
      };

      if (Math.abs(target - el.scrollLeft) < 1) {
        restore();
        return;
      }
      el.addEventListener("scrollend", restore);
      settleTimer = window.setTimeout(restore, SETTLE_TIMEOUT_MS);
      el.scrollTo({ left: target, behavior: "smooth" });
    };

    const beginDrag = (e: PointerEvent) => {
      dragging = true;
      abortSettle?.();
      // Capture only once the gesture is committed: capturing on
      // pointerdown would retarget the click to the rail and children
      // would stop receiving it.
      el.setPointerCapture(e.pointerId);
      // Off *before* the first scroll write — a snap container pulls
      // `scrollLeft` straight back otherwise and the rail never moves.
      el.style.scrollSnapType = "none";
      // The press may already have started a text selection on a title.
      window.getSelection()?.removeAllRanges();
      setState({ dragging: true, snapSuspended: true });
    };

    /** Eats the click synthesized by the release, so a drag that ends on
     * a card doesn't also open it. */
    const swallowNextClick = () => {
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      // A drag that ends outside a child produces no click at all — drop
      // the trap so the next genuine one isn't eaten.
      window.setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      pressed = true;
      dragging = false;
      startX = lastX = e.clientX;
      startScroll = el.scrollLeft;
      lastTime = e.timeStamp;
      velocity = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        beginDrag(e);
      }
      const elapsed = e.timeStamp - lastTime;
      if (elapsed > 0) {
        velocity = (lastX - e.clientX) / elapsed;
        lastX = e.clientX;
        lastTime = e.timeStamp;
      }
      el.scrollLeft = startScroll - dx;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      if (!dragging) return;
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (e.timeStamp - lastTime > STALE_VELOCITY_MS) velocity = 0;
      swallowNextClick();
      setState({ dragging: false, snapSuspended: true });
      settle();
    };

    /** Banner art is a draggable image: without this the browser starts a
     * native image drag the moment the rail is pulled. */
    const onDragStart = (e: Event) => {
      if (pressed) e.preventDefault();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("dragstart", onDragStart);
    // On window, not the rail: the pointer routinely leaves the rail
    // mid-drag, and the release can land anywhere.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      abortSettle?.();
      el.style.scrollSnapType = "";
    };
  }, [ref, enabled]);

  return state;
}
