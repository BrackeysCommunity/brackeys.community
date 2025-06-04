import { createContext, useContext } from 'react';

export type CursorState = 'default' | 'interactive' | 'typing';

interface SandboxContextType {
  // Cursor state - purely about cursor appearance
  cursorState: CursorState;
  setCursorDefault: () => void;
  setCursorInteractive: () => void;
  setCursorTyping: () => void;

  // UI element hover state - decoupled from cursor
  hoveredElementId: string | null;
  setHoveredElement: (elementId: string | null) => void;
}

const SandboxContext = createContext<SandboxContextType | null>(null);

export const Provider = SandboxContext.Provider;
export const useSandbox = () => {
  const context = useContext(SandboxContext);
  if (!context) {
    throw new Error('useSandbox must be used within SandboxProvider');
  }
  return context;
}; 