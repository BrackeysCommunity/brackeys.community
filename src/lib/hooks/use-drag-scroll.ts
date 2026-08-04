import { useEffect, useState } from "react";

/** Pointer travel that turns a press into a drag. Below this the gesture
 * is still a click, so cards in the rail keep opening on a normal press. */
const DRAG_THRESHOLD_PX = 5;
/** Time constant of the post-release glide, in ms: velocity decays by
 * `1/e` every `GLIDE_TAU`, so a flick carries roughly `v * TAU` pixels. */
const GLIDE_TAU_MS = 260;
/** Speed at which the glide is over, in px/ms — below this the remaining
 * travel is under a pixel or two and the rail may as well stop. */
const GLIDE_STOP_PX_PER_MS = 0.02;
/** Velocity is a rolling average so a single jittery sample can't define
 * the throw; this is the weight given to the newest sample. */
const VELOCITY_SMOOTHING = 0.4;
/** A pointer that came to rest before the button came up carries no
 * momentum, however fast it was travelling earlier. */
const STALE_VELOCITY_MS = 80;

export interface DragScrollState {
  /** A drag is under way — for the grabbing cursor and selection lock. */
  dragging: boolean;
}

/**
 * Click-and-drag scrolling for a horizontal rail, mouse only — touch and
 * pen already pan natively and hijacking them costs the platform's
 * momentum and rubber-banding.
 *
 * The gesture stays a plain click until it passes `DRAG_THRESHOLD_PX`, so
 * clickable children are unaffected; past the threshold the drag takes
 * over and the click that follows the release is swallowed.
 *
 * A release carries its speed forward and coasts to a stop, the same way
 * a trackpad fling does — a rail that stopped dead on release would feel
 * like the throw never left your hand. The glide is pure deceleration
 * with nothing to land on: the rail free-scrolls, and where it comes to
 * rest is where the throw put it.
 *
 * Takes the scrolling element itself rather than a ref, so the caller can
 * hold it in state and hand out a callback ref — the listeners then
 * re-bind whenever the rail mounts or is replaced.
 */
export function useDragScroll(el: HTMLElement | null, enabled = true): DragScrollState {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!el || !enabled) return;

    let pressed = false;
    let active = false;
    let startX = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastTime = 0;
    /** px/ms in scroll space — positive means travelling right. */
    let velocity = 0;
    let glide = 0;

    const stopGlide = () => {
      if (glide) cancelAnimationFrame(glide);
      glide = 0;
    };

    /** Coasts the rail to a stop from the release velocity. Bails the
     * moment it stops moving — an edge absorbs the rest of the throw. */
    const startGlide = () => {
      let previous = performance.now();
      const step = (time: number) => {
        const dt = Math.min(time - previous, 64);
        previous = time;
        const before = el.scrollLeft;
        el.scrollLeft = before + velocity * dt;
        velocity *= Math.exp(-dt / GLIDE_TAU_MS);
        const moved = Math.abs(el.scrollLeft - before) > 0.5;
        if (!moved || Math.abs(velocity) < GLIDE_STOP_PX_PER_MS) {
          glide = 0;
          return;
        }
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    };

    const beginDrag = (e: PointerEvent) => {
      active = true;
      // Capture only once the gesture is committed: capturing on
      // pointerdown would retarget the click to the rail and children
      // would stop receiving it.
      el.setPointerCapture(e.pointerId);
      // The press may already have started a text selection on a title.
      window.getSelection()?.removeAllRanges();
      setDragging(true);
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
      // Catching a moving rail stops it dead, whatever the pointer is.
      stopGlide();
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      pressed = true;
      active = false;
      startX = lastX = e.clientX;
      startScroll = el.scrollLeft;
      lastTime = e.timeStamp;
      velocity = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      if (!active) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        beginDrag(e);
      }
      const elapsed = e.timeStamp - lastTime;
      if (elapsed > 0) {
        const sample = (lastX - e.clientX) / elapsed;
        velocity = velocity * (1 - VELOCITY_SMOOTHING) + sample * VELOCITY_SMOOTHING;
        lastX = e.clientX;
        lastTime = e.timeStamp;
      }
      el.scrollLeft = startScroll - dx;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      if (!active) return;
      active = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      swallowNextClick();
      setDragging(false);
      if (
        e.timeStamp - lastTime <= STALE_VELOCITY_MS &&
        Math.abs(velocity) > GLIDE_STOP_PX_PER_MS
      ) {
        startGlide();
      }
    };

    /** Banner art is a draggable image: without this the browser starts a
     * native image drag the moment the rail is pulled. */
    const onDragStart = (e: Event) => {
      if (pressed) e.preventDefault();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("dragstart", onDragStart);
    // Any deliberate scroll of their own outranks the coast.
    el.addEventListener("wheel", stopGlide, { passive: true });
    el.addEventListener("touchstart", stopGlide, { passive: true });
    // On window, not the rail: the pointer routinely leaves the rail
    // mid-drag, and the release can land anywhere.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      stopGlide();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("wheel", stopGlide);
      el.removeEventListener("touchstart", stopGlide);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [el, enabled]);

  return { dragging };
}
