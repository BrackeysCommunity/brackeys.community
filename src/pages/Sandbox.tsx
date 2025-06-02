import { MousePointer2, Users } from 'lucide-react';
import { motion } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';
import { Cursors } from '../components/sandbox/Cursors';
import { SpacetimeDBProvider } from '../context/SpacetimeDBProvider';
import { useLayoutProps } from '../context/layoutContext';
import { useSpacetimeDB } from '../context/spacetimeDBContext';
import { useDocTitle } from '../hooks/useDocTitle';

export const SandboxView = () => {
  const [userName, setUserName] = useState<string>('');
  const [showNameDialog, setShowNameDialog] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [typingText, setTypingText] = useState('');

  const canvasRef = useRef<HTMLDivElement>(null);
  const lastCursorPosition = useRef({ x: 50, y: 50 });

  const {
    isConnected,
    currentUser,
    users,
    typingStates,
    setDisplayName,
    updateCursor,
    updateTyping,
  } = useSpacetimeDB();

  useEffect(() => {
    if (!canvasRef.current || !isConnected || showNameDialog) return;

    const canvas = canvasRef.current;
    let lastUpdate = Date.now();
    let lastX = -1;
    let lastY = -1;

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      lastCursorPosition.current = { x, y };

      // Only update if position changed significantly or enough time passed
      const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
      if (distance > 0.5 || now - lastUpdate > 50) {
        updateCursor(x, y);
        lastUpdate = now;
        lastX = x;
        lastY = y;
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isConnected, showNameDialog, updateCursor]);

  useEffect(() => {
    if (!canvasRef.current || !isConnected || showNameDialog) return;

    const canvas = canvasRef.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTyping && e.key === '/') {
        e.preventDefault();
        setIsTyping(true);
        setTypingText('');
      }
    };

    canvas.addEventListener('keydown', handleKeyDown);
    canvas.tabIndex = 0;

    return () => {
      canvas.removeEventListener('keydown', handleKeyDown);
    };
  }, [isConnected, showNameDialog, isTyping]);

  const handleSetName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userName.trim() && isConnected) {
      try {
        await setDisplayName(userName.trim());
        setShowNameDialog(false);
      } catch (error) {
        console.error('Failed to set name:', error);
      }
    }
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

  const activeUserCount = users.length;

  return (
    <div className="flex flex-col grow">
      {showNameDialog && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="fixed inset-0 flex items-center justify-center bg-black/80 z-50"
        >
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-xl font-semibold text-white mb-4">Welcome to the Sandbox!</h2>
            <p className="text-gray-300 mb-6">
              Choose a display name to identify yourself to others
            </p>
            <form onSubmit={handleSetName}>
              <input
                type="text"
                placeholder="Enter your name..."
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent"
                maxLength={20}
                autoFocus
              />
              <button
                type="submit"
                className="w-full mt-4 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!userName.trim() || !isConnected}
              >
                {isConnected ? 'Enter Sandbox' : 'Connecting...'}
              </button>
            </form>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: showNameDialog ? 0.3 : 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex-1 relative bg-gray-850 overflow-hidden"
      >
        <div className="absolute w-full px-4">
          <div className="relative w-full container mx-auto">
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg z-10 border border-gray-700">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm font-medium text-gray-300">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            <div className="absolute top-4 left-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg z-10 border border-gray-700">
              <Users size={16} className="text-brackeys-purple-400" />
              <span className="text-sm font-medium text-gray-300">
                {activeUserCount} user{activeUserCount !== 1 ? 's' : ''} online
              </span>
            </div>
          </div>
        </div>

        <div ref={canvasRef} className="absolute inset-0 outline-none cursor-none">
          {showNameDialog ? (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MousePointer2 size={48} className="mx-auto mb-4 text-brackeys-purple-400" />
                <p className="text-gray-300">Move your cursor to see it tracked in real-time</p>
                <p className="text-sm mt-2 text-gray-400">Set your name above to start collaborating</p>
              </div>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-dot-pattern pattern-mask-radial pattern-opacity-40" />

              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-center pointer-events-none">
                <p className="text-xs text-gray-500">
                  Press "/" to start typing
                </p>
              </div>

              <Cursors
                users={users}
                currentUserId={currentUser?.identity.toHexString()}
                typingStates={typingStates}
                isTyping={isTyping}
                typingText={typingText}
                onTypingChange={handleTypingChange}
                onTypingClose={handleTypingClose}
              />
            </>
          )}
        </div>
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