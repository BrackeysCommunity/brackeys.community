import { createContext, useContext, useSyncExternalStore } from "react";

/** Wall-clock minute in ms. */
const MINUTE = 60_000;

/**
 * The clock the server rendered this request with. Provided by the root
 * route from its loader data, so the client's hydration render sees the
 * same instant the HTML was built from — a `Date.now()` on each side
 * straddles a minute boundary often enough that "3m ago" and "4m ago"
 * disagree, and React throws the whole tree away for it.
 */
export const ServerNowContext = createContext<number | null>(null);

/**
 * One ticker for every consumer, aligned to the wall-clock minute so
 * everything on screen rolls over together rather than each mount drifting
 * on its own schedule. A minute is the resolution every consumer actually
 * renders at: `formatRelativeMs` stops at `03h 04m`, `timeAgo` at `12m
 * ago`, and the jam progress strips span days.
 */
let current = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  timer = setTimeout(
    () => {
      current = Date.now();
      for (const notify of listeners) notify();
      schedule();
    },
    MINUTE - (Date.now() % MINUTE),
  );
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) schedule();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/**
 * Refreshes lazily: a component mounting between ticks (or after the
 * ticker stopped) must not read a stale minute, in either direction — the
 * system clock can be set back. The one-second grace keeps consecutive
 * reads within a render identical, which React requires of a snapshot.
 */
function getSnapshot(): number {
  if (Math.abs(Date.now() - current) > 1_000) current = Date.now();
  return current;
}

/**
 * The current time, re-read once a minute.
 *
 * Hydration-safe: during the server render and the client's first render
 * it returns the request's own clock (see `ServerNowContext`), and only
 * after hydration switches to the live one. Outside a router — tests, or
 * a component rendered without the provider — it falls back to the live
 * clock on both sides.
 */
function useDateNow(): number {
  const serverNow = useContext(ServerNowContext);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverNow ?? getSnapshot());
}

export default useDateNow;
