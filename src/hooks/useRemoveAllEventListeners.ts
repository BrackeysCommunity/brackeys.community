import { useEffect } from 'react';

/**
 * Removes all event listeners of a specific type from the window.
 *
 * This is really only useful for handling the standalone Redoc component which has
 * a bug and does not properly clear all event listeners on unmount.
 *
 * https://github.com/Redocly/redoc/issues/2282
 * https://www.loom.com/share/5941e60e80214bcbb315c3644d719ebb
 *
 * @param type The type of event to remove listeners for. Defaults to 'scroll'.
 */
export const useRemoveAllEventListeners = (type = 'scroll') => {
  useEffect(() => {
    const originalAdd = window.addEventListener;
    const originalRemove = window.removeEventListener;
    const listeners = new Set<EventListenerOrEventListenerObject>();

    window.addEventListener = (
      event: string,
      cb: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions
    ) => {
      if (event === type) listeners.add(cb);
      originalAdd.call(this, event, cb, opts);
    };

    window.removeEventListener = (
      event: string,
      cb: EventListenerOrEventListenerObject,
      opts?: boolean | EventListenerOptions
    ) => {
      if (event === type) listeners.delete(cb);
      originalRemove.call(this, event, cb, opts);
    };

    return () => {
      listeners.forEach(cb => window.removeEventListener(type, cb));
      window.addEventListener = originalAdd;
      window.removeEventListener = originalRemove;
    };
  }, [type]);
};
