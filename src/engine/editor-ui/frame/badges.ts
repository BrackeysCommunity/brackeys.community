import { useCallback, useRef, useSyncExternalStore } from "react";

import type { TabBadge } from "../kit/index";
import type { PanelContext, PanelDef } from "../panels/registry";

const sameBadges = (a: readonly (TabBadge | null)[], b: readonly (TabBadge | null)[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return x === y || (x != null && y != null && x.count === y.count && x.tone === y.tone);
  });

const NONE: readonly (TabBadge | null)[] = Object.freeze([]);
const quiet = () => () => {};

/**
 * Each panel's badge, read again whenever the context says what they read
 * changed: the tab strips and the rails draw the same counts. With no
 * context, none.
 */
export function usePanelBadges(
  defs: readonly PanelDef[],
  ctx: PanelContext | null,
): readonly (TabBadge | null)[] {
  const cache = useRef<readonly (TabBadge | null)[]>(NONE);
  const read = useCallback(() => {
    if (!ctx) return NONE;
    const next = defs.map((def) => def.badge?.(ctx) ?? null);
    if (!sameBadges(cache.current, next)) cache.current = next;
    return cache.current;
  }, [defs, ctx]);
  return useSyncExternalStore(ctx ? ctx.subscribe : quiet, read, read);
}
