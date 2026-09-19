import { useCallback, useEffect, useRef, useState } from "react";

import { useDebouncedCallback } from "./use-debounced-callback";

/** Long enough that an ordinary sentence is one write. */
const BACKSTOP_MS = 2500;

/**
 * A text field that persists when the member leaves it, with a debounce as
 * a backstop for an edit long enough that they may never blur it.
 *
 * A write goes out only when the value differs from what the server last
 * accepted — a save per keystroke costs a request and a query invalidation
 * each. A failed one doesn't count as accepted, so the next blur retries.
 *
 * `commit` may return a promise (`mutateAsync`); a rejection is caught here,
 * leaving the caller's own reporting as the single report.
 */
export function useAutosavedField(serverValue: string, commit: (value: string) => unknown) {
  const [value, setValue] = useState(serverValue);
  const valueRef = useRef(serverValue);
  const savedRef = useRef(serverValue);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const flush = useCallback(() => {
    const next = valueRef.current;
    const previous = savedRef.current;
    if (next === previous) return;
    savedRef.current = next;
    void Promise.resolve(commitRef.current(next)).catch(() => {
      if (savedRef.current === next) savedRef.current = previous;
    });
  }, []);

  const backstop = useDebouncedCallback(flush, BACKSTOP_MS);

  // Closing the flyout, or stepping to the next panel, unmounts the field
  // mid-edit — and an unmounted input never blurs.
  useEffect(() => flush, [flush]);

  const onChange = useCallback(
    (next: string) => {
      valueRef.current = next;
      setValue(next);
      backstop();
    },
    [backstop],
  );

  return { value, onChange, onBlur: flush };
}
