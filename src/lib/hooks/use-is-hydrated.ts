import { useSyncExternalStore } from "react";

/** Nothing ever changes, so the store never notifies. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during the server render and the first client render, `true`
 * afterwards.
 *
 * For the narrow case of a component whose output genuinely cannot match
 * between server and client — something that needs a real DOM to compute,
 * like DOMPurify's sanitizer, which doesn't even exist in Node. The usual
 * `useState(false)` + `useEffect(() => setState(true))` spelling does the
 * same thing but trips the cascading-render lint (rightly: it's a setState
 * in an effect body). `useSyncExternalStore` with a distinct server
 * snapshot is the sanctioned way to say "this differs on the server".
 *
 * Not a licence to gate things on hydration in general — content behind
 * this is invisible to crawlers and to a no-JS reader, so anything that
 * matters should have a server-rendered form.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
