import { useEffect, useState, useCallback, useRef } from 'react';
import { DbConnection, SandboxUser, LiveTyping } from '../api/spacetime-db';

export type SpacetimeState = {
  isConnected: boolean;
  currentUser: SandboxUser | null;
  users: SandboxUser[];
  typingStates: Map<string, LiveTyping>;
};

export const useSpacetimeDB = () => {
  const [state, setState] = useState<SpacetimeState>({
    isConnected: false,
    currentUser: null,
    users: [],
    typingStates: new Map(),
  });

  const identityRef = useRef<string | null>(null);
  const connectionRef = useRef<DbConnection | null>(null);

  useEffect(() => {
    const updateState = () => {
      if (!connectionRef.current) return;

      const users = Array.from(connectionRef.current.db.sandboxUser.iter()) as SandboxUser[];
      const typingData = Array.from(connectionRef.current.db.liveTyping.iter()) as LiveTyping[];

      const typingStates = new Map<string, LiveTyping>();
      typingData.forEach((typing: LiveTyping) => {
        typingStates.set(typing.identity.toHexString(), typing);
      });

      const currentUser = users.find((user: SandboxUser) =>
        user.identity.toHexString() === identityRef.current
      ) || null;

      setState({
        isConnected: true,
        currentUser,
        users,
        typingStates,
      });
    };

    const connection = DbConnection.builder()
      .withUri(import.meta.env.VITE_SPACETIME_HOST)
      .withModuleName(import.meta.env.VITE_SPACETIME_MODULE)
      .onConnect((conn, identity) => {
        connectionRef.current = conn;
        identityRef.current = identity.toHexString();

        setState(prev => ({ ...prev, isConnected: true }));

        conn
          .subscriptionBuilder()
          .onApplied(updateState)
          .subscribe([
            'SELECT * FROM sandbox_user',
            'SELECT * FROM live_typing'
          ]);
      })
      .onDisconnect(() => {
        setState(prev => ({ ...prev, isConnected: false }));
      })
      .build();

    connection.db.sandboxUser.onInsert(updateState);
    connection.db.sandboxUser.onUpdate(updateState);
    connection.db.sandboxUser.onDelete(updateState);

    connection.db.liveTyping.onInsert(updateState);
    connection.db.liveTyping.onUpdate(updateState);
    connection.db.liveTyping.onDelete(updateState);

    return () => {
      connection.disconnect();
    };
  }, []);

  const setDisplayName = useCallback(async (name: string) => {
    if (!connectionRef.current) return;
    try {
      connectionRef.current.reducers.setDisplayName(name);
    } catch (error) {
      console.error('Failed to set display name:', error);
      throw error;
    }
  }, []);

  const updateCursor = useCallback(async (x: number, y: number) => {
    if (!connectionRef.current) return;
    try {
      connectionRef.current.reducers.updateCursor(x, y);
    } catch (error) {
      console.error('Failed to update cursor:', error);
    }
  }, []);

  const updateTyping = useCallback(async (text: string, x: number, y: number) => {
    if (!connectionRef.current) return;
    try {
      connectionRef.current.reducers.updateTyping(text, x, y);
    } catch (error) {
      console.error('Failed to update typing:', error);
    }
  }, []);

  return {
    ...state,
    setDisplayName,
    updateCursor,
    updateTyping,
  };
}; 