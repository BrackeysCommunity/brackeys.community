import { useState, useEffect } from 'react';
import { toast } from '../lib/toast';
import { useSpacetimeDB } from '../context/spacetimeDBContext';
import { motion } from 'framer-motion';

const ROOM_SECRET_KEY = import.meta.env.VITE_SPACETIME_ROOM_KEY || 'brackeys-default-key';

type FormMode = 'initial' | 'create' | 'join' | 'checking';

interface RoomManagerProps {
  onClose?: () => void;
}

export const RoomManager = ({ onClose }: RoomManagerProps) => {
  const { currentUser, currentRoom, createRoom, joinRoom, leaveRoom, updateRoomConfig, setDisplayName } = useSpacetimeDB();
  const [formMode, setFormMode] = useState<FormMode>('initial');
  const [userName, setUserName] = useState(currentUser?.name || '');
  const [roomCode, setRoomCode] = useState('');
  const [password, setPassword] = useState('');
  const [messageTtl, setMessageTtl] = useState(30);
  const [messagesEnabled, setMessagesEnabled] = useState(true);
  const [usePassword, setUsePassword] = useState(true);
  const [loading, setLoading] = useState(false);

  // Auto-focus name input when component mounts
  useEffect(() => {
    if (formMode === 'initial' && !currentUser?.name) {
      const nameInput = document.querySelector('input[placeholder="Enter your name..."]') as HTMLInputElement;
      if (nameInput) {
        setTimeout(() => nameInput.focus(), 100);
      }
    }
  }, [formMode, currentUser?.name]);

  const hashPassword = async (pwd: string): Promise<string> => {
    if (!pwd) return '';

    // Add pepper for additional security  
    const pepperedPassword = pwd + ROOM_SECRET_KEY;

    // Use SHA-256 for deterministic hashing (same input = same output)
    const encoder = new TextEncoder();
    const data = encoder.encode(pepperedPassword);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usePassword && password.length < 4) {
      toast.error('Password must be at least 4 characters');
      return;
    }



    setLoading(true);

    try {
      // Set display name first if needed
      if (!currentUser?.name && userName.trim()) {
        await setDisplayName(userName.trim());
      }

      // Hash the password if provided, otherwise empty string for public room
      const hashedPassword = usePassword && password ? await hashPassword(password) : '';

      const code = await createRoom(hashedPassword, messageTtl, messagesEnabled);
      toast.success(`Room created! Code: ${code}`);

      if (onClose) {
        onClose();
      }
    } catch (err: unknown) {
      console.error('Failed to create room:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const checkRoomAndJoin = async (code: string, pwd: string = '') => {
    // Create a timeout promise to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Room join timeout - please try again')), 10000); // 10 second timeout
    });

    try {
      // For checking if room is public, try with empty password first
      if (!pwd) {
        await Promise.race([
          joinRoom(code.toUpperCase(), ''),
          timeoutPromise
        ]);

        if (onClose) {
          onClose();
        }
        return true;
      }

      // For password rooms, hash the password for comparison
      const hashedPassword = await hashPassword(pwd);

      await Promise.race([
        joinRoom(code.toUpperCase(), hashedPassword),
        timeoutPromise
      ]);

      onClose?.();
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('timeout')) {
        toast.error('Connection timeout. Please check your internet and try again.');
        return false;
      } else if (err instanceof Error && err.message?.includes('Invalid password')) {
        if (pwd) {
          toast.error('Incorrect password. Please try again.');
          return false;
        }
        // Room requires password - this is expected, don't show error toast
        return false;
      } else if (err instanceof Error && err.message?.includes('Room not found')) {
        toast.error('Room not found. Please check the room code.');
        return false;
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to join room. Please try again.');
        return false;
      }
    }
  };

  const handleInitialJoin = async () => {
    if (!userName.trim() || !roomCode.trim()) {
      return;
    }

    setLoading(true);
    setFormMode('checking');

    try {
      // Set display name first if needed
      if (!currentUser?.name && userName.trim()) {
        await setDisplayName(userName.trim());
      }

      // Try to join without password first (public room)
      const success = await checkRoomAndJoin(roomCode);

      if (!success) {
        // Room requires password or other error
        setFormMode('join');
      }
    } catch (err: unknown) {
      console.error('Error in handleInitialJoin:', err);
      toast.error('Failed to join room. Please try again.');
      setFormMode('join');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);

    try {
      // Set display name first if needed
      if (!currentUser?.name && userName.trim()) {
        await setDisplayName(userName.trim());
      }

      // Try to join with password
      await checkRoomAndJoin(roomCode, password);
    } catch (err: unknown) {
      console.error('Failed to join room:', err);
      toast.error('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveRoom = async () => {
    setLoading(true);
    try {
      await leaveRoom();
      if (onClose) {
        onClose();
      }
    } catch (err: unknown) {
      console.error('Failed to leave room:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to leave room');
    } finally {
      setLoading(false);
    }
  };

  // If already in a room, show room info and controls
  if (currentRoom) {
    const isHost = currentUser && currentRoom.hostIdentity.toHexString() === currentUser.identity.toHexString();

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center justify-center h-full p-4"
      >
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 max-w-md w-full shadow-xl relative">
          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <h2 className="text-xl font-semibold text-white mb-4">Room Settings</h2>

          <div className="space-y-3 mb-6 text-gray-300">
            <div className="flex justify-between">
              <span className="text-gray-400">Room Code:</span>
              <span className="font-mono font-semibold text-brackeys-purple-400">{currentRoom.code}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Message TTL:</span>
              <span>{currentRoom.messageTtlSeconds === 0 ? 'Never expire' : `${currentRoom.messageTtlSeconds}s`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Messages:</span>
              <span className={currentRoom.messagesEnabled ? 'text-green-400' : 'text-yellow-400'}>
                {currentRoom.messagesEnabled ? 'Enabled' : 'Typing only'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Password:</span>
              <span className={currentRoom.passwordHash ? 'text-yellow-400' : 'text-green-400'}>
                {currentRoom.passwordHash ? 'Protected' : 'Public'}
              </span>
            </div>
          </div>

          {isHost && (
            <div className="mb-6 space-y-4 p-4 bg-gray-700/50 rounded-lg">
              <h3 className="font-semibold text-white mb-3">Host Controls</h3>

              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Message TTL (seconds, 0 = never)
                </label>
                <input
                  type="number"
                  value={messageTtl}
                  onChange={(e) => setMessageTtl(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
                  min="0"
                />
              </div>

              <label className="flex items-center text-gray-300">
                <input
                  type="checkbox"
                  checked={messagesEnabled}
                  onChange={(e) => setMessagesEnabled(e.target.checked)}
                  className="mr-2"
                />
                Enable messages (uncheck for typing only)
              </label>

              <button
                onClick={async () => {
                  setLoading(true);
                  try {
                    await updateRoomConfig(messageTtl, messagesEnabled);
                    toast.success('Settings updated successfully!', 'Your changes have been saved.');
                  } catch (err: unknown) {
                    console.error('Failed to update settings:', err);
                    toast.error(err instanceof Error ? err.message : 'Failed to update settings');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full px-4 py-2 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Updating...' : 'Update Settings'}
              </button>
            </div>
          )}

          <button
            onClick={handleLeaveRoom}
            disabled={loading}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Leaving...' : 'Leave Room'}
          </button>


        </div>
      </motion.div>
    );
  }

  // Checking room status
  if (formMode === 'checking') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center justify-center h-full p-4"
      >
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 max-w-md w-full shadow-xl">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brackeys-purple-500 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-white mb-2">Joining Room</h2>
            <p className="text-gray-400">Checking room {roomCode}...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Initial form or password entry
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center justify-center h-full p-4"
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 max-w-md w-full shadow-xl">
        <h2 className="text-xl font-semibold text-white mb-4">
          {formMode === 'initial' ? 'Join the Sandbox' : formMode === 'create' ? 'Create Room' : 'Join Room'}
        </h2>

        {formMode === 'initial' ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            handleInitialJoin();
          }}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Your Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
                  placeholder="Enter your name..."
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Room Code (optional)</label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 font-mono"
                  placeholder="Leave empty to create new"
                  maxLength={6}
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setFormMode('create');
                  }}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  disabled={!userName.trim() || loading}
                >
                  Create Room
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  disabled={!userName.trim() || !roomCode.trim() || loading}
                >
                  {loading ? 'Joining...' : 'Join Room'}
                </button>
              </div>
            </div>
          </form>
        ) : formMode === 'create' ? (
          <form onSubmit={handleCreateRoom}>
            <div className="space-y-4">
              <label className="flex items-center text-gray-300 mb-4">
                <input
                  type="checkbox"
                  checked={usePassword}
                  onChange={(e) => {
                    setUsePassword(e.target.checked);
                    if (!e.target.checked) {
                      setPassword(''); // Clear password when unchecked
                    }
                  }}
                  className="mr-2"
                />
                Password protect this room
              </label>

              {usePassword && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Room Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
                    placeholder="Min 4 characters..."
                    minLength={4}
                    required={usePassword}
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-3 pt-4 border-t border-gray-700">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Message TTL (seconds, 0 = never)
                  </label>
                  <input
                    type="number"
                    value={messageTtl}
                    onChange={(e) => setMessageTtl(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
                    min="0"
                  />
                </div>

                <label className="flex items-center text-gray-300">
                  <input
                    type="checkbox"
                    checked={messagesEnabled}
                    onChange={(e) => setMessagesEnabled(e.target.checked)}
                    className="mr-2"
                  />
                  Enable messages
                </label>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Room'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormMode('initial');
                    setPassword('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={handleJoinRoom}>
            <div className="space-y-4">
              <div className="bg-yellow-900/50 text-yellow-400 border border-yellow-700 text-sm p-3 rounded-lg">
                Room "{roomCode}" requires a password
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Room Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
                  placeholder="Enter room password..."
                  autoFocus
                  required
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Joining...' : 'Join Room'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormMode('initial');
                    setPassword('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </motion.div>
  );
}; 