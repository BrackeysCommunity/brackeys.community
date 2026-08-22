import { useCallback, useEffect, useRef } from "react";

/**
 * A stable function that defers each call by `delay`, keeping only the
 * last one. The autosave flyouts use it for text fields: type freely,
 * save once the typing pauses. Pairs with `useDebouncedValue`, which is
 * the same idea for a value instead of a call.
 */
export function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay = 600): T {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  const debounced = useCallback(
    function debouncedFn(...args: Parameters<T>) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
  return debounced as T;
}
