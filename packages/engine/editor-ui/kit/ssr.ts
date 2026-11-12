import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * Hooks for reading the browser during render without breaking a server
 * render or hydration. On the server and while hydrating each returns its
 * server value, then the browser's; a client-only render reads the browser
 * on its first pass.
 */

/** `useLayoutEffect` in a browser, `useEffect` where there is no DOM. */
export const useIsomorphicLayoutEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** False on the server and while hydrating its markup; true for every client render after. */
export function useClientReady(): boolean {
  return useSyncExternalStore(subscribeNothing, onClient, onServer);
}

/** A value the browser knows and the server can't, held at `server` until hydrated. */
export function useBrowserValue<T extends string | number | boolean>(read: () => T, server: T): T {
  return useSyncExternalStore(subscribeNothing, read, () => server);
}

/**
 * `useState` started from the browser, such as a stored setting: `read` on a
 * client render; `server` on the server and while hydrating, then `read`
 * before the hydrated markup paints.
 */
export function useBrowserState<T>(read: () => T, server: T): [T, Dispatch<SetStateAction<T>>] {
  const ready = useClientReady();
  const [value, setValue] = useState(() => (ready ? read() : server));
  const unread = useRef(!ready);
  useIsomorphicLayoutEffect(() => {
    if (!unread.current) return;
    unread.current = false;
    setValue(read());
  });
  return [value, setValue];
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const windowWidth = () => window.innerWidth;
const windowHeight = () => window.innerHeight;

/** The window's size, kept current; `server` where there is no window yet. */
export function useWindowSize(server: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const width = useSyncExternalStore(subscribeResize, windowWidth, () => server.width);
  const height = useSyncExternalStore(subscribeResize, windowHeight, () => server.height);
  return { width, height };
}
