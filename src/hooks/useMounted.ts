import { useState } from 'react';
import { useTimeout } from '@uidotdev/usehooks';

/**
 * Returns true after a short delay to prevent hydration errors
 * @returns boolean
 */
export const useMounted = () => {
  const [isMounted, setIsMounted] = useState(false);

  useTimeout(() => {
    setIsMounted(true);
  }, 100);

  return isMounted;
};
