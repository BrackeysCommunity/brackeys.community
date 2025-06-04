import { motion } from 'motion/react';
import React, { useRef, useState } from 'react';
import { NameDialog } from '../components/sandbox/NameDialog';
import { SandboxCanvas } from '../components/sandbox/SandboxCanvas';
import { SpacetimeDBProvider } from '../context/SpacetimeDBProvider';
import { useLayoutProps } from '../context/layoutContext';
import { useSpacetimeDB } from '../context/spacetimeDBContext';
import { useDocTitle } from '../hooks/useDocTitle';

export const SandboxView = () => {
  const [showNameDialog, setShowNameDialog] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [typingText, setTypingText] = useState('');

  const lastCursorPosition = useRef({ x: 50, y: 50 });

  const {
    isConnected,
    currentUser,
    users,
    typingStates,
    messages,
    setDisplayName,
    updateCursor,
    updateTyping,
    sendMessage,
  } = useSpacetimeDB();

  const handleSetName = async (name: string) => {
    try {
      await setDisplayName(name);
      setShowNameDialog(false);
    } catch (error) {
      console.error('Failed to set name:', error);
      throw error; // Re-throw so NameDialog can handle the error state
    }
  };

  const handleCursorMove = (x: number, y: number) => {
    updateCursor(x, y);
  };

  const handleTypingStart = () => {
    setIsTyping(true);
    setTypingText('');
  };

  const handleTypingChange = (text: string, selectionStart: number, selectionEnd: number) => {
    setTypingText(text);
    const { x, y } = lastCursorPosition.current;
    updateTyping(text, x, y, selectionStart, selectionEnd);
  };

  const handleTypingClose = () => {
    setIsTyping(false);
    setTypingText('');
    updateTyping('', 0, 0, 0, 0);
  };

  return (
    <div className="flex flex-col grow">
      {showNameDialog && (
        <NameDialog
          isConnected={isConnected}
          onSubmit={handleSetName}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: showNameDialog ? 0.3 : 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex-1 relative bg-gray-850 overflow-hidden"
      >
        <SandboxCanvas
          isConnected={isConnected}
          showNameDialog={showNameDialog}
          users={users}
          currentUserId={currentUser?.identity.toHexString()}
          typingStates={typingStates}
          messages={messages}
          isTyping={isTyping}
          typingText={typingText}
          lastCursorPosition={lastCursorPosition.current}
          onCursorMove={handleCursorMove}
          onTypingStart={handleTypingStart}
          onTypingChange={handleTypingChange}
          onTypingClose={handleTypingClose}
          onSendMessage={sendMessage}
        />
      </motion.div>
    </div>
  );
};

const SandboxContainer = () => {
  useLayoutProps({
    showFooter: false,
    containerized: false,
    mainClassName: "flex",
    fullHeight: true
  });

  useDocTitle('Sandbox - Brackeys Community');

  return (
    <SpacetimeDBProvider>
      <SandboxView />
    </SpacetimeDBProvider>
  )
}

export const Sandbox = SandboxContainer;