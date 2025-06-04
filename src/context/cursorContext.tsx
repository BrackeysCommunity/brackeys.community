import { createContext, useContext, useState, useCallback, PropsWithChildren } from 'react';

type CursorState = 'default' | 'interactive' | 'typing';

interface CursorContextType {
  cursorState: CursorState;
  hoveredElementId: string | null;
  setCursorInteractive: (elementId?: string) => void;
  setCursorTyping: () => void;
  setCursorDefault: () => void;
}

const CursorContext = createContext<CursorContextType | null>(null);

export const CursorProvider = ({ children }: PropsWithChildren) => {
  const [cursorState, setCursorState] = useState<CursorState>('default');
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);

  const setCursorInteractive = useCallback((elementId?: string) => {
    setCursorState('interactive');
    setHoveredElementId(elementId || null);
  }, []);

  const setCursorTyping = useCallback(() => {
    setCursorState('typing');
    setHoveredElementId(null);
  }, []);

  const setCursorDefault = useCallback(() => {
    setCursorState('default');
    setHoveredElementId(null);
  }, []);

  return (
    <CursorContext.Provider value={{
      cursorState,
      hoveredElementId,
      setCursorInteractive,
      setCursorTyping,
      setCursorDefault,
    }}>
      {children}
    </CursorContext.Provider>
  );
};

export const useCursor = () => {
  const context = useContext(CursorContext);
  if (!context) {
    throw new Error('useCursor must be used within CursorProvider');
  }
  return context;
}; 