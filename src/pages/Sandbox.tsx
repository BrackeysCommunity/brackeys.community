import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Users, MousePointer2 } from 'lucide-react';
import { useSpacetimeDB } from '../hooks/useSpacetimeDB';

export const Sandbox = () => {
  const [userName, setUserName] = useState<string>('');
  const [showNameDialog, setShowNameDialog] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

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

    const canvas = canvasRef.current; // Capture ref value
    let lastUpdate = Date.now();
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastUpdate < 16) return; // Throttle to ~60fps

      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      updateCursor(x, y);
      lastUpdate = now;
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
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            Collaborative Sandbox
          </h1>
          <p className="text-gray-600">
            A real-time collaborative space where cursors and typing are shared instantly
          </p>
        </motion.div>

        {showNameDialog && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"
          >
            <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
              <h2 className="text-2xl font-bold mb-4">Welcome to the Sandbox!</h2>
              <p className="text-gray-600 mb-6">
                Choose a display name to identify yourself to others
              </p>
              <form onSubmit={handleSetName}>
                <input
                  type="text"
                  placeholder="Enter your name..."
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  maxLength={20}
                  autoFocus
                />
                <button
                  type="submit"
                  className="w-full mt-4 bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                  disabled={!userName.trim() || !isConnected}
                >
                  {isConnected ? 'Enter Sandbox' : 'Connecting...'}
                </button>
              </form>
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: showNameDialog ? 0.3 : 1 }}
          className="relative bg-white rounded-xl shadow-xl overflow-hidden"
          style={{ height: '600px' }}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/10 px-3 py-1 rounded-full z-10">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/10 px-3 py-1 rounded-full z-10">
            <Users size={16} />
            <span className="text-sm font-medium">{activeUserCount} user{activeUserCount !== 1 ? 's' : ''} online</span>
          </div>

          <div ref={canvasRef} className="relative w-full h-full">
            {showNameDialog ? (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <MousePointer2 size={48} className="mx-auto mb-4" />
                  <p>Move your cursor to see it tracked in real-time</p>
                  <p className="text-sm mt-2">Click anywhere and type "/" to start typing</p>
                </div>
              </div>
            ) : (
              <>
                {users.filter(user => user.identity.toHexString() !== currentUser?.identity.toHexString()).map(user => (
                  <div
                    key={user.identity.toHexString()}
                    className="absolute pointer-events-none transition-all duration-100"
                    style={{
                      left: `${user.cursorX}%`,
                      top: `${user.cursorY}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="relative">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        style={{ filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.2))` }}
                      >
                        <path
                          d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"
                          fill={user.color}
                          stroke="white"
                          strokeWidth="1"
                        />
                      </svg>
                      {user.name && (
                        <div
                          className="absolute top-6 left-2 px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap"
                          style={{ backgroundColor: user.color }}
                        >
                          {user.name}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}; 