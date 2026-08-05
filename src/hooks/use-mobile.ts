import { useSyncExternalStore } from "react";

/** Tailwind's `md`. Below it the app is in its mobile layout, full stop. */
export const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

/**
 * The one switch between the app's two layouts.
 *
 * This used to be `useIsTouchDevice`, matching `(pointer: coarse)`, which
 * split the world three ways rather than two: a narrowed desktop window got
 * the desktop shell squeezed into a phone's width, while a coarse-pointer
 * tablet got the phone shell at 1024px. Viewport width is the only thing
 * either layout actually needs to know, so it's the only thing asked.
 *
 * Renders `false` on the server and for the first client paint — the mobile
 * layout is the one that has to survive being wrong for a frame.
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
