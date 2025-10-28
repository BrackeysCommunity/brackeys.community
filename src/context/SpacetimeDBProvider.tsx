import { type PropsWithChildren, useEffect, useRef, useState } from 'react';
import {
  DbConnection,
  type LiveTyping,
  type Room,
  type SandboxMessage,
  type SandboxUser,
} from '../spacetime-bindings';
import { Provider, type SpacetimeState } from './spacetimeDBContext';

const SPACETIME_HOST =
  import.meta.env.VITE_SPACETIME_HOST || 'ws://localhost:3000';
const SPACETIME_MODULE =
  import.meta.env.VITE_SPACETIME_MODULE || 'brackeys-sandbox';

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
  const [state, setState] = useState<
    Omit<
      SpacetimeState,
      | 'setDisplayName'
      | 'updateColor'
      | 'updateCursor'
      | 'updateTyping'
      | 'sendMessage'
      | 'dismissMessage'
      | 'createRoom'
      | 'joinRoom'
      | 'leaveRoom'
      | 'updateRoomConfig'
      | 'subscribe'
      | 'unsubscribe'
    >
  >({
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
        console.log('updateState skipped:', {
          hasConnection: !!connection,
          isMounted: mountedRef.current,
        });
        return;
      }

      const users = Array.from(
        connection.db.sandboxUser.iter(),
      ) as SandboxUser[];
      const rooms = Array.from(connection.db.room.iter()) as Room[];
      const typingData = Array.from(
        connection.db.liveTyping.iter(),
      ) as LiveTyping[];
      const messages = Array.from(
        connection.db.sandboxMessage.iter(),
      ) as SandboxMessage[];

      const currentUser =
        users.find(
          (user: SandboxUser) =>
            user.identity.toHexString() === identityRef.current,
        ) || null;

      const currentRoomCode = currentUser?.roomCode || null;
      currentRoomCodeRef.current = currentRoomCode;

      // Filter data by current room
      const roomUsers = currentRoomCode
        ? users.filter((u) => u.roomCode === currentRoomCode)
        : [];

      const typingStates = new Map<string, LiveTyping>();
      if (currentRoomCode) {
        typingData
          .filter((t) => t.roomCode === currentRoomCode)
          .forEach((typing: LiveTyping) => {
            typingStates.set(typing.identity.toHexString(), typing);
          });
      }

      const roomMessages = currentRoomCode
        ? messages.filter((m) => m.roomCode === currentRoomCode)
        : [];

      const currentRoom = currentRoomCode
        ? rooms.find((r) => r.code === currentRoomCode) || null
        : null;

      setState((prev) => {
        // only update if data actually changed
        const hasUsersChanged =
          prev.users.length !== roomUsers.length ||
          prev.users.some((prevUser, i) => {
            const newUser = roomUsers[i];
            return (
              !newUser ||
              prevUser.identity.toHexString() !==
                newUser.identity.toHexString() ||
              prevUser.cursorX !== newUser.cursorX ||
              prevUser.cursorY !== newUser.cursorY ||
              prevUser.name !== newUser.name
            );
          });

        const hasTypingChanged =
          prev.typingStates.size !== typingStates.size ||
          Array.from(typingStates.entries()).some(([id, typing]) => {
            const prevTyping = prev.typingStates.get(id);
            return (
              !prevTyping ||
              prevTyping.text !== typing.text ||
              prevTyping.isTyping !== typing.isTyping ||
              prevTyping.selectionStart !== typing.selectionStart ||
              prevTyping.selectionEnd !== typing.selectionEnd
            );
          });

        const hasCurrentUserChanged =
          prev.currentUser?.identity.toHexString() !==
            currentUser?.identity.toHexString() ||
          prev.currentUser?.roomCode !== currentUser?.roomCode;

        const hasMessagesChanged =
          prev.messages.length !== roomMessages.length ||
          prev.messages.some((prevMsg, i) => {
            const newMsg = roomMessages[i];
            return !newMsg || Number(prevMsg.id) !== Number(newMsg.id);
          });

        const hasRoomChanged =
          prev.currentRoom?.code !== currentRoom?.code ||
          prev.currentRoom?.messageTtlSeconds !==
            currentRoom?.messageTtlSeconds ||
          prev.currentRoom?.messagesEnabled !== currentRoom?.messagesEnabled;

        if (
          hasUsersChanged ||
          hasTypingChanged ||
          hasCurrentUserChanged ||
          hasMessagesChanged ||
          hasRoomChanged
        ) {
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
              .subscribe(['SELECT * FROM sandbox_user', 'SELECT * FROM room']);
          } else {
            console.warn('Component unmounted before connection completed');
          }
        })
        .onDisconnect(() => {
          if (mountedRef.current) {
            setState((prev) => ({ ...prev, isConnected: false }));
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
      connectionRef.current
        ?.subscriptionBuilder()
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

  const setDisplayName = async (name: string, color: string) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      connectionRef.current.reducers.setDisplayName(name, color);
    } catch (error) {
      console.error('Failed to set display name:', error);
      throw error;
    }
  };

  const updateColor = async (color: string) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      connectionRef.current.reducers.updateColor(color);
    } catch (error) {
      console.error('Failed to update color:', error);
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

  const updateTyping = async (
    text: string,
    x: number,
    y: number,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    if (!connectionRef.current) return;
    try {
      connectionRef.current.reducers.updateTyping(
        text,
        x,
        y,
        selectionStart,
        selectionEnd,
      );
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

  const createRoom = async (
    password: string,
    messageTtlSeconds: number,
    messagesEnabled: boolean,
  ): Promise<string> => {
    if (!connectionRef.current) throw new Error('Not connected');

    // Try up to 10 times to generate a unique room code
    for (let i = 0; i < 10; i++) {
      const roomCode = generateRoomCode();
      try {
        await connectionRef.current.reducers.createRoom(
          roomCode,
          password,
          messageTtlSeconds,
          messagesEnabled,
        );

        // Subscribe to room-specific data
        await subscribe([
          `SELECT * FROM live_typing WHERE room_code = '${roomCode}'`,
          `SELECT * FROM sandbox_message WHERE room_code = '${roomCode}'`,
        ]);

        return roomCode;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message?.includes('already exists') &&
          i < 9
        ) {
          continue; // Try again with a new code
        }
        throw error;
      }
    }
    throw new Error('Failed to generate unique room code after 10 attempts');
  };

  const joinRoom = async (
    roomCode: string,
    password: string,
  ): Promise<void> => {
    if (!connectionRef.current) throw new Error('Not connected');

    return new Promise<void>((resolve, reject) => {
      const connection = connectionRef.current;
      const userIdentity = identityRef.current;

      // Set up a timeout for the operation
      const timeout = setTimeout(() => {
        connection?.reducers.removeOnJoinRoom(onJoinRoomComplete);
        reject(new Error('Join room operation timed out'));
      }, 10000);

      const onJoinRoomComplete = () => {
        clearTimeout(timeout);
        connection?.reducers.removeOnJoinRoom(onJoinRoomComplete);

        // Wait a brief moment for state to update, then check if we joined successfully
        setTimeout(async () => {
          try {
            const users = Array.from(
              connection?.db.sandboxUser.iter() || [],
            ) as SandboxUser[];
            const currentUser = users.find(
              (user) => user.identity.toHexString() === userIdentity,
            );

            if (!currentUser?.roomCode || currentUser.roomCode !== roomCode) {
              // If we're not in the room, the join failed - assume it was due to room not found or invalid password
              // We need to determine which based on whether the room exists
              const rooms = Array.from(
                connection?.db.room.iter() || [],
              ) as Room[];
              const roomExists = rooms.some((room) => room.code === roomCode);

              if (!roomExists) {
                reject(new Error('Room not found'));
              } else {
                reject(new Error('Invalid password'));
              }
              return;
            }

            // Successfully joined - subscribe to room-specific data
            await subscribe([
              `SELECT * FROM live_typing WHERE room_code = '${roomCode}'`,
              `SELECT * FROM sandbox_message WHERE room_code = '${roomCode}'`,
            ]);

            resolve();
          } catch (error) {
            reject(error);
          }
        }, 200); // Wait 200ms for state to propagate
      };

      // Listen for the reducer completion
      connection?.reducers.onJoinRoom(onJoinRoomComplete);

      // Fire the reducer
      connection?.reducers.joinRoom(roomCode, password);
    });
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

  const updateRoomConfig = async (
    messageTtlSeconds: number,
    messagesEnabled: boolean,
  ) => {
    if (!connectionRef.current) throw new Error('Not connected');
    try {
      await connectionRef.current.reducers.updateRoomConfig(
        messageTtlSeconds,
        messagesEnabled,
      );
    } catch (error) {
      console.error('Failed to update room config:', error);
      throw error;
    }
  };

  const value: SpacetimeState = {
    ...state,
    setDisplayName,
    updateColor,
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

  return <Provider value={value}>{children}</Provider>;
};
