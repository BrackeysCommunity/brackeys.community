import { type PropsWithChildren, useCallback, useRef, useState } from 'react';
import { type CursorState, Provider } from './sandboxContext';

export const SandboxProvider = ({ children }: PropsWithChildren) => {
  const [cursorState, setCursorState] = useState<CursorState>('default');
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingText, setTypingText] = useState('');

  const canvasRef = useRef<HTMLDivElement>(null);
  const lastCursorPosition = useRef({ x: 50, y: 50 });

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
    <Provider
      value={{
        cursorState,
        setCursorDefault,
        setCursorInteractive,
        setCursorTyping,
        hoveredElementId,
        setHoveredElement,
        isTyping,
        setIsTyping,
        typingText,
        setTypingText,
        canvasRef,
        lastCursorPosition,
      }}
    >
      {children}
    </Provider>
  );
};
