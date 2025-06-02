import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { DbConnection, SandboxUser, LiveTyping } from '../api/spacetime-db';
import { Provider, SpacetimeState } from './spacetimeDBContext';

const SPACETIME_HOST = import.meta.env.VITE_SPACETIME_HOST || 'ws://localhost:3000';
const SPACETIME_MODULE = import.meta.env.VITE_SPACETIME_MODULE || 'brackeys-sandbox';

export const SpacetimeDBProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<Omit<SpacetimeState, 'setDisplayName' | 'updateCursor' | 'updateTyping'>>({
    isConnected: false,
    currentUser: null,
    users: [],
    typingStates: new Map(),
  });

  const connectionRef = useRef<DbConnection | null>(null);
  const identityRef = useRef<string | null>(null);

  // react strict mode override for local dev
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    let connection: DbConnection | null = null;

    const updateState = () => {
      if (!connection || !mountedRef.current) {
        console.log('updateState skipped:', { hasConnection: !!connection, isMounted: mountedRef.current });
        return;
      }

      const users = Array.from(connection.db.sandboxUser.iter()) as SandboxUser[];
      const typingData = Array.from(connection.db.liveTyping.iter()) as LiveTyping[];

      const typingStates = new Map<string, LiveTyping>();
      typingData.forEach((typing: LiveTyping) => {
        typingStates.set(typing.identity.toHexString(), typing);
      });

      const currentUser = users.find((user: SandboxUser) =>
        user.identity.toHexString() === identityRef.current
      ) || null;

      setState(prev => {
        // only update if data actually changed
        const hasUsersChanged = prev.users.length !== users.length ||
          prev.users.some((prevUser, i) => {
            const newUser = users[i];
            return !newUser ||
              prevUser.identity.toHexString() !== newUser.identity.toHexString() ||
              prevUser.cursorX !== newUser.cursorX ||
              prevUser.cursorY !== newUser.cursorY ||
              prevUser.name !== newUser.name;
          });

        const hasTypingChanged = prev.typingStates.size !== typingStates.size ||
          Array.from(typingStates.entries()).some(([id, typing]) => {
            const prevTyping = prev.typingStates.get(id);
            return !prevTyping ||
              prevTyping.text !== typing.text ||
              prevTyping.isTyping !== typing.isTyping;
          });

        const hasCurrentUserChanged = prev.currentUser?.identity.toHexString() !== currentUser?.identity.toHexString();

        if (hasUsersChanged || hasTypingChanged || hasCurrentUserChanged) {
          return {
            isConnected: true,
            currentUser,
            users,
            typingStates,
          };
        }

        return { ...prev, isConnected: true };
      });
    };

    try {
      connection = DbConnection.builder()
        .withUri(SPACETIME_HOST)
        .withModuleName(SPACETIME_MODULE)
        .onConnect((conn, identity) => {
          connectionRef.current = conn;
          identityRef.current = identity.toHexString();

          if (mountedRef.current) {
            conn
              .subscriptionBuilder()
              .onApplied(updateState)
              .subscribe([
                'SELECT * FROM sandbox_user',
                'SELECT * FROM live_typing'
              ]);
          } else {
            console.warn('Component unmounted before connection completed');
          }
        })
        .onDisconnect(() => {
          if (mountedRef.current) {
            setState(prev => ({ ...prev, isConnected: false }));
          }
        })
        .onConnectError((error) => {
          console.error('Connection error:', error);
        })
        .build();

      connectionRef.current = connection;

      let updateTimeout: NodeJS.Timeout | null = null;
      const throttledUpdate = () => {
        if (updateTimeout) return;
        updateTimeout = setTimeout(() => {
          updateState();
          updateTimeout = null;
        }, 7); // ~140fps
      };

      connection.db.sandboxUser.onInsert(throttledUpdate);
      connection.db.sandboxUser.onUpdate(throttledUpdate);
      connection.db.sandboxUser.onDelete(throttledUpdate);

      connection.db.liveTyping.onInsert(throttledUpdate);
      connection.db.liveTyping.onUpdate(throttledUpdate);
      connection.db.liveTyping.onDelete(throttledUpdate);
    } catch (error) {
      console.error('Error creating connection:', error);
    }

    const handleBeforeUnload = () => {
      connection?.disconnect();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      connection?.disconnect();
      connectionRef.current = null;
    };
  }, []);

  const setDisplayName = async (name: string) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      connectionRef.current.reducers.setDisplayName(name);
    } catch (error) {
      console.error('Failed to set display name:', error);
      throw error;
    }
  };

  const updateCursor = async (x: number, y: number) => {
    if (!connectionRef.current) return;
    try {
      connectionRef.current.reducers.updateCursor(x, y);
    } catch (error) {
      console.error('Failed to update cursor:', error);
    }
  };

  const updateTyping = async (text: string, x: number, y: number, selectionStart: number, selectionEnd: number) => {
    if (!connectionRef.current) return;
    try {
      connectionRef.current.reducers.updateTyping(text, x, y, selectionStart, selectionEnd);
    } catch (error) {
      console.error('Failed to update typing:', error);
    }
  };

  const value: SpacetimeState = {
    ...state,
    setDisplayName,
    updateCursor,
    updateTyping,
  };

  return (
    <Provider value={value}>
      {children}
    </Provider>
  );
}; 