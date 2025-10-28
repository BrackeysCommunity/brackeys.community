import { createContext, type RefObject, useContext } from 'react';

export type CursorState = 'default' | 'interactive' | 'typing';

export type SandboxContextType = {
  cursorState: CursorState;
  setCursorDefault: () => void;
  setCursorInteractive: () => void;
  setCursorTyping: () => void;
  hoveredElementId: string | null;
  setHoveredElement: (elementId: string | null) => void;
  isTyping: boolean;
  setIsTyping: (isTyping: boolean) => void;
  typingText: string;
  setTypingText: (text: string) => void;
  canvasRef: RefObject<HTMLDivElement | null>;
  lastCursorPosition: RefObject<{ x: number; y: number }>;
};

const SandboxContext = createContext<SandboxContextType | null>(null);

export const Provider = SandboxContext.Provider;

export const useSandbox = () => {
  const context = useContext(SandboxContext);
  if (!context) {
    throw new Error('useSandbox must be used within a SandboxProvider');
  }
  return context;
};
