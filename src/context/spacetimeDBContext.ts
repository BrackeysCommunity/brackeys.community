import { createContext, useContext } from 'react';
import { SandboxUser, LiveTyping } from '../api/spacetime-db';

export type SpacetimeState = {
  isConnected: boolean;
  currentUser: SandboxUser | null;
  users: SandboxUser[];
  typingStates: Map<string, LiveTyping>;
  setDisplayName: (name: string) => Promise<void>;
  updateCursor: (x: number, y: number) => Promise<void>;
  updateTyping: (text: string, x: number, y: number, selectionStart: number, selectionEnd: number) => Promise<void>;
};

const SpacetimeDBContext = createContext<SpacetimeState | null>(null);
export const Provider = SpacetimeDBContext.Provider;

export const useSpacetimeDB = () => {
  const context = useContext(SpacetimeDBContext);
  if (!context) throw new Error('useSpacetimeDB must be used within SpacetimeDBProvider');

  return context;
};