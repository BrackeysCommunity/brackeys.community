import { createContext, useContext } from 'react';
import { SandboxUser, LiveTyping, SandboxMessage, Room } from '../spacetime-bindings';

export type SpacetimeState = {
  isConnected: boolean;
  currentUser: SandboxUser | null;
  currentRoom: Room | null;
  users: SandboxUser[];
  typingStates: Map<string, LiveTyping>;
  messages: SandboxMessage[];

  // Actions
  setDisplayName: (name: string, color: string) => Promise<void>;
  updateColor: (color: string) => Promise<void>;
  updateCursor: (x: number, y: number) => Promise<void>;
  updateTyping: (
    text: string,
    x: number,
    y: number,
    selectionStart: number,
    selectionEnd: number
  ) => Promise<void>;
  sendMessage: (text: string, x: number, y: number) => Promise<void>;
  dismissMessage: (messageId: bigint) => Promise<void>;

  // Room management
  createRoom: (
    password: string,
    messageTtlSeconds: number,
    messagesEnabled: boolean
  ) => Promise<string>;
  joinRoom: (roomCode: string, password: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  updateRoomConfig: (messageTtlSeconds: number, messagesEnabled: boolean) => Promise<void>;

  // Dynamic subscriptions
  subscribe: (queries: string[]) => Promise<void>;
  unsubscribe: (queries: string[]) => Promise<void>;
};

const SpacetimeDBContext = createContext<SpacetimeState | null>(null);
export const Provider = SpacetimeDBContext.Provider;

export const useSpacetimeDB = () => {
  const context = useContext(SpacetimeDBContext);
  if (!context) throw new Error('useSpacetimeDB must be used within SpacetimeDBProvider');

  return context;
};
