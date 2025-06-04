import { useState, useCallback, PropsWithChildren } from 'react';
import { CursorState, Provider } from './sandboxContext';

export const SandboxProvider = ({ children }: PropsWithChildren) => {
  const [cursorState, setCursorState] = useState<CursorState>('default');
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);

  const setCursorDefault = useCallback(() => {
    if (hoveredElementId) setCursorState('interactive');
    else setCursorState('default');
  }, [hoveredElementId]);

  const setCursorInteractive = useCallback(() => {
    setCursorState('interactive');
  }, []);

  const setCursorTyping = useCallback(() => {
    setCursorState('typing');
  }, []);

  const setHoveredElement = useCallback((elementId: string | null) => {
    setHoveredElementId(elementId);
  }, []);

  return (
    <Provider value={{
      cursorState,
      setCursorDefault,
      setCursorInteractive,
      setCursorTyping,
      hoveredElementId,
      setHoveredElement,
    }}>
      {children}
    </Provider>
  );
};