import { useCallback, useRef, useSyncExternalStore } from "react";

/** What the hook reads: a `@tanstack/store` `Store`, or anything with its state and subscribe. */
export type ReadableStore<S> = {
  readonly state: S;
  subscribe(listener: () => void): () => void;
};

const identity = <T>(value: T): T => value;

/** Equal when both are the same value, or objects, Maps or Sets holding the same values. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !Object.is(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (a instanceof Map || b instanceof Map || a instanceof Set || b instanceof Set) return false;
  const keys = Reflect.ownKeys(a);
  if (keys.length !== Reflect.ownKeys(b).length) return false;
  const left = a as Record<PropertyKey, unknown>;
  const right = b as Record<PropertyKey, unknown>;
  return keys.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(left[k], right[k]),
  );
}

/**
 * `selector` over `store`'s state, re-rendering only when what it selects
 * changes: a selection shallowly equal to the last keeps the last, so a
 * selector may build a fresh array or object each time.
 */
export function useStoreValue<S, T = S>(
  store: ReadableStore<S>,
  selector: (state: S) => T = identity as (state: S) => T,
  equal: (a: T, b: T) => boolean = shallowEqual,
): T {
  const cache = useRef<{ state: S; selector: (state: S) => T; value: T } | null>(null);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const read = () => {
    const state = store.state;
    const held = cache.current;
    if (held && held.state === state && held.selector === selector) return held.value;
    const next = selector(state);
    const value = held && equal(held.value, next) ? held.value : next;
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(subscribe, read, read);
}
