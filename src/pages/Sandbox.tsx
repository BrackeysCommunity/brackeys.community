import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RoomManager } from '../components/sandbox/RoomManager';
import { SandboxCanvas } from '../components/sandbox/SandboxCanvas';
import { useLayoutProps } from '../context/layoutContext';
import { SandboxProvider } from '../context/SandboxProvider';
import { SpacetimeDBProvider } from '../context/SpacetimeDBProvider';
import { useSandbox } from '../context/sandboxContext';
import { useSpacetimeDB } from '../context/spacetimeDBContext';
import { useCursorTracking } from '../hooks/sandbox/useCursorTracking';
import { useKeyboardShortcuts } from '../hooks/sandbox/useKeyboardShortcuts';
import { useMessageGroups } from '../hooks/sandbox/useMessageGroups';
import { useTypingHandlers } from '../hooks/sandbox/useTypingHandlers';
import { useDocTitle } from '../hooks/useDocTitle';
import { toast } from '../lib/toast';

// Container component handling state and logic
const SandboxContainer = () => {
  const [showRoomSettings, setShowRoomSettings] = useState(false);

  const { canvasRef, lastCursorPosition, setCursorDefault } = useSandbox();

  const {
    isConnected,
    currentUser,
    currentRoom,
    users,
    typingStates,
    messages,
    updateCursor,
    dismissMessage,
  } = useSpacetimeDB();

  const {
    isTyping,
    typingText,
    handleTypingStart,
    handleTypingChange,
    handleSendMessage,
    handleTypingClose,
    handleMouseMoveWhileTyping,
  } = useTypingHandlers();

  const usersMap = useMemo(
    () => new Map(users.map((u) => [u.identity.toHexString(), u])),
    [users],
  );
  const messageGroups = useMessageGroups(messages);
  const activeUserCount = users.length;

  // Cursor tracking with throttling
  useCursorTracking({
    canvasRef,
    lastCursorPosition,
    isConnected,
    isTyping,
    typingText,
    onCursorUpdate: (x, y) => {
      setCursorDefault();
      updateCursor(x, y);
    },
    onMouseMoveWhileTyping: handleMouseMoveWhileTyping,
  });

  // Keyboard shortcuts
  useKeyboardShortcuts({
    canvasRef,
    isConnected,
    isTyping,
    onTypingStart: handleTypingStart,
  });

  // Focus canvas when entering a room and canvas is rendered
  useEffect(() => {
    if (currentRoom && canvasRef.current && !showRoomSettings) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        canvasRef.current?.focus();
      });
    }
  }, [currentRoom, canvasRef, showRoomSettings]);

  const handleDismissGroup = useCallback(
    async (messageIds: bigint[]) => {
      try {
        for (const messageId of messageIds) {
          await dismissMessage(messageId);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('Failed to dismiss group:', error);
        toast.error(
          'Failed to dismiss messages',
          'There was an error dismissing the message group. Please try again.',
        );
      } finally {
        canvasRef.current?.focus();
      }
    },
    [dismissMessage, canvasRef],
  );

  const handleDismissMessage = useCallback(
    async (messageId: bigint) => {
      try {
        await dismissMessage(messageId);
      } catch (error) {
        console.error('Failed to dismiss message:', error);
        toast.error(
          'Failed to dismiss message',
          'There was an error dismissing the message. Please try again.',
        );
      } finally {
        canvasRef.current?.focus();
      }
    },
    [dismissMessage, canvasRef],
  );

  // Override handleSendMessage to check if messages are enabled
  const handleSendMessageWithCheck = useCallback(
    (text: string, x: number, y: number) => {
      if (!currentRoom?.messagesEnabled) {
        // Clear typing if messages are disabled
        handleTypingClose();
        return;
      }
      handleSendMessage(text, x, y);
    },
    [currentRoom?.messagesEnabled, handleSendMessage, handleTypingClose],
  );

  // Show room manager if user is not in a room or showing room settings
  if (!currentRoom || showRoomSettings) {
    return (
      <div className="flex flex-col grow bg-gray-900 overflow-hidden relative">
        <RoomManager
          onClose={
            showRoomSettings
              ? () => {
                  setShowRoomSettings(false);
                }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col grow relative">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex-1 relative bg-gray-900 overflow-hidden"
      >
        <SandboxCanvas
          ref={canvasRef}
          isConnected={isConnected}
          users={users}
          currentUserId={currentUser?.identity.toHexString()}
          typingStates={typingStates}
          messageGroups={messageGroups}
          usersMap={usersMap}
          isTyping={isTyping}
          typingText={typingText}
          activeUserCount={activeUserCount}
          roomCode={currentRoom.code}
          messagesEnabled={currentRoom.messagesEnabled}
          onTypingChange={handleTypingChange}
          onTypingClose={handleTypingClose}
          onSendMessage={handleSendMessageWithCheck}
          onDismissMessage={handleDismissMessage}
          onDismissGroup={handleDismissGroup}
          onRoomClick={() => setShowRoomSettings(true)}
        />
      </motion.div>
    </div>
  );
};

export const Sandbox = () => {
  useLayoutProps({
    showFooter: false,
    containerized: false,
    mainClassName: 'flex h-full overflow-hidden',
    fullHeight: true,
  });

  useDocTitle('Sandbox - Brackeys Community');

  return (
    <SpacetimeDBProvider>
      <SandboxProvider>
        <SandboxContainer />
      </SandboxProvider>
    </SpacetimeDBProvider>
  );
};
