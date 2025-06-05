import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { DbConnection, SandboxUser, LiveTyping, SandboxMessage, Room } from '../spacetime-bindings';
import { Provider, SpacetimeState } from './spacetimeDBContext';

const SPACETIME_HOST = import.meta.env.VITE_SPACETIME_HOST || 'ws://localhost:3000';
const SPACETIME_MODULE = import.meta.env.VITE_SPACETIME_MODULE || 'brackeys-sandbox';

// Generate a random 6-character room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export const SpacetimeDBProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<Omit<SpacetimeState, 'setDisplayName' | 'updateCursor' | 'updateTyping' | 'sendMessage' | 'dismissMessage' | 'createRoom' | 'joinRoom' | 'leaveRoom' | 'updateRoomConfig' | 'subscribe' | 'unsubscribe'>>({
    isConnected: false,
    currentUser: null,
    currentRoom: null,
    users: [],
    typingStates: new Map(),
    messages: [],
  });

  const connectionRef = useRef<DbConnection | null>(null);
  const identityRef = useRef<string | null>(null);
  const currentRoomCodeRef = useRef<string | null>(null);

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
      const rooms = Array.from(connection.db.room.iter()) as Room[];
      const typingData = Array.from(connection.db.liveTyping.iter()) as LiveTyping[];
      const messages = Array.from(connection.db.sandboxMessage.iter()) as SandboxMessage[];

      const currentUser = users.find((user: SandboxUser) =>
        user.identity.toHexString() === identityRef.current
      ) || null;

      const currentRoomCode = currentUser?.roomCode || null;
      currentRoomCodeRef.current = currentRoomCode;

      // Filter data by current room
      const roomUsers = currentRoomCode
        ? users.filter(u => u.roomCode === currentRoomCode)
        : [];

      const typingStates = new Map<string, LiveTyping>();
      if (currentRoomCode) {
        typingData
          .filter(t => t.roomCode === currentRoomCode)
          .forEach((typing: LiveTyping) => {
            typingStates.set(typing.identity.toHexString(), typing);
          });
      }

      const roomMessages = currentRoomCode
        ? messages.filter(m => m.roomCode === currentRoomCode)
        : [];

      const currentRoom = currentRoomCode
        ? rooms.find(r => r.code === currentRoomCode) || null
        : null;

      setState(prev => {
        // only update if data actually changed
        const hasUsersChanged = prev.users.length !== roomUsers.length ||
          prev.users.some((prevUser, i) => {
            const newUser = roomUsers[i];
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
              prevTyping.isTyping !== typing.isTyping ||
              prevTyping.selectionStart !== typing.selectionStart ||
              prevTyping.selectionEnd !== typing.selectionEnd;
          });

        const hasCurrentUserChanged = prev.currentUser?.identity.toHexString() !== currentUser?.identity.toHexString() ||
          prev.currentUser?.roomCode !== currentUser?.roomCode;

        const hasMessagesChanged = prev.messages.length !== roomMessages.length ||
          prev.messages.some((prevMsg, i) => {
            const newMsg = roomMessages[i];
            return !newMsg || Number(prevMsg.id) !== Number(newMsg.id);
          });

        const hasRoomChanged = prev.currentRoom?.code !== currentRoom?.code ||
          prev.currentRoom?.messageTtlSeconds !== currentRoom?.messageTtlSeconds ||
          prev.currentRoom?.messagesEnabled !== currentRoom?.messagesEnabled;

        if (hasUsersChanged || hasTypingChanged || hasCurrentUserChanged || hasMessagesChanged || hasRoomChanged) {
          return {
            isConnected: true,
            currentUser,
            currentRoom,
            users: roomUsers,
            typingStates,
            messages: roomMessages,
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
            // Subscribe to all users and rooms initially
            conn
              .subscriptionBuilder()
              .onApplied(updateState)
              .subscribe([
                'SELECT * FROM sandbox_user',
                'SELECT * FROM room'
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

      connection.db.room.onInsert(throttledUpdate);
      connection.db.room.onUpdate(throttledUpdate);
      connection.db.room.onDelete(throttledUpdate);

      connection.db.liveTyping.onInsert(throttledUpdate);
      connection.db.liveTyping.onUpdate(throttledUpdate);
      connection.db.liveTyping.onDelete(throttledUpdate);

      connection.db.sandboxMessage.onInsert(throttledUpdate);
      connection.db.sandboxMessage.onDelete(throttledUpdate);
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

  const subscribe = async (queries: string[]) => {
    if (!connectionRef.current) throw new Error('Not connected');

    return new Promise<void>((resolve) => {
      connectionRef.current!
        .subscriptionBuilder()
        .onApplied(() => resolve())
        .subscribe(queries);
    });
  };

  const unsubscribe = async () => {
    if (!connectionRef.current) throw new Error('Not connected');

    // Note: SpacetimeDB doesn't have a direct unsubscribe method
    // We'll handle this by subscribing to an empty set for those tables
    // This is a limitation of the current SDK
    console.warn('Unsubscribe not fully supported by SpacetimeDB SDK');
  };

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

  const sendMessage = async (text: string, x: number, y: number) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      connectionRef.current.reducers.sendMessage(text, x, y);
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  };

  const dismissMessage = async (messageId: bigint) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      connectionRef.current.reducers.dismissMessage(BigInt(messageId));
    } catch (error) {
      console.error('Failed to dismiss message:', error);
      throw error;
    }
  };

  const createRoom = async (password: string, messageTtlSeconds: number, messagesEnabled: boolean): Promise<string> => {
    if (!connectionRef.current) throw new Error('Not connected');

    // Try up to 10 times to generate a unique room code
    for (let i = 0; i < 10; i++) {
      const roomCode = generateRoomCode();
      try {
        await connectionRef.current.reducers.createRoom(roomCode, password, messageTtlSeconds, messagesEnabled);

        // Subscribe to room-specific data
        await subscribe([
          `SELECT * FROM live_typing WHERE room_code = '${roomCode}'`,
          `SELECT * FROM sandbox_message WHERE room_code = '${roomCode}'`
        ]);

        return roomCode;
      } catch (error) {
        if (error instanceof Error && error.message?.includes('already exists') && i < 9) {
          continue; // Try again with a new code
        }
        throw error;
      }
    }
    throw new Error('Failed to generate unique room code after 10 attempts');
  };

  const joinRoom = async (roomCode: string, password: string) => {
    if (!connectionRef.current) throw new Error('Not connected');

    // Get current user state before join attempt  
    const usersBefore = Array.from(connectionRef.current.db.sandboxUser.iter());
    usersBefore.find((user: SandboxUser) =>
      user.identity.toHexString() === identityRef.current
    );

    try {
      await connectionRef.current.reducers.joinRoom(roomCode, password);

      // Wait a moment for the state to update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if we actually joined the room by examining user state
      const usersAfter = Array.from(connectionRef.current.db.sandboxUser.iter());
      const currentUserAfter = usersAfter.find((user: SandboxUser) =>
        user.identity.toHexString() === identityRef.current
      );

      // If we're still not in the room, the join failed
      if (!currentUserAfter?.roomCode || currentUserAfter.roomCode !== roomCode) {
        throw new Error('Invalid password');
      }

      // Subscribe to room-specific data
      await subscribe([
        `SELECT * FROM live_typing WHERE room_code = '${roomCode}'`,
        `SELECT * FROM sandbox_message WHERE room_code = '${roomCode}'`
      ]);
    } catch (error) {
      console.error('Failed to join room:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const leaveRoom = async () => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      await connectionRef.current.reducers.leaveRoom();

      // Note: We can't really unsubscribe from the room data
      // but it will be filtered out by updateState
    } catch (error) {
      console.error('Failed to leave room:', error);
      throw error;
    }
  };

  const updateRoomConfig = async (messageTtlSeconds: number, messagesEnabled: boolean) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      await connectionRef.current.reducers.updateRoomConfig(messageTtlSeconds, messagesEnabled);
    } catch (error) {
      console.error('Failed to update room config:', error);
      throw error;
    }
  };

  const value: SpacetimeState = {
    ...state,
    setDisplayName,
    updateCursor,
    updateTyping,
    sendMessage,
    dismissMessage,
    createRoom,
    joinRoom,
    leaveRoom,
    updateRoomConfig,
    subscribe,
    unsubscribe,
  };

  return (
    <Provider value={value}>
      {children}
    </Provider>
  );
}; 