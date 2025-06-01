import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Users, MousePointer2 } from 'lucide-react';
import { useSpacetimeDB } from '../hooks/useSpacetimeDB';
import { Cursors } from '../components/sandbox/Cursors';

export const Sandbox = () => {
  const [userName, setUserName] = useState<string>('');
  const [showNameDialog, setShowNameDialog] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const {
    isConnected,
    currentUser,
    users,
    setDisplayName,
    updateCursor,
  } = useSpacetimeDB();

  useEffect(() => {
    document.title = 'Sandbox - Brackeys Community';
  }, []);

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

  const activeUserCount = users.length;

  return (
    <div className="pb-6 max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <h1 className="text-2xl font-semibold text-white">
          Collaborative Sandbox
        </h1>
        <p className="mt-2 text-gray-300">
          A real-time collaborative space where cursors and typing are shared instantly
        </p>
      </motion.div>

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
        transition={{ duration: 0.3, delay: 0.1 }}
        className="relative bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
        style={{ height: '600px' }}
      >
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

        <div ref={canvasRef} className="relative w-full h-full bg-gray-850">
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
              {/* Background pattern */}
              <div className="absolute inset-0 bg-dot-pattern pattern-mask-full pattern-opacity-10" />
              <Cursors
                users={users}
                currentUserId={currentUser?.identity.toHexString()}
              />
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}; 