import { useSyncExternalStore } from "react";

/** One document listener for however many surfaces ask, rather than one per
 * animated layer. */
const subscribers = new Set<() => void>();
let attached = false;

function notify() {
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!attached) {
    document.addEventListener("visibilitychange", notify);
    attached = true;
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && attached) {
      document.removeEventListener("visibilitychange", notify);
      attached = false;
    }
  };
}

/**
 * Whether the tab is showing. Animation loops read it to stop drawing while
 * hidden: `requestAnimationFrame` already stalls in a backgrounded tab, but
 * a tab can be visible-but-occluded, and a loop that keeps its own timers or
 * intervals running needs telling either way.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}
