import { useCallback, useEffect, useEffectEvent, useRef } from 'react';

export const useTimeout = (cb: () => void, ms: number) => {
  const id = useRef(null);
  const onTimeout = useEffectEvent(cb);

  const handleClearTimeout = useCallback(() => {
    window.clearTimeout(id.current);
  }, []);

  useEffect(() => {
    id.current = window.setTimeout(onTimeout, ms);

    return handleClearTimeout;
  }, [ms, handleClearTimeout, onTimeout]);

  return handleClearTimeout;
};
