import { motion } from 'motion/react';
import { useState } from 'react';
import { MAX_NAME_LENGTH } from './constants';

type NameDialogProps = {
  isConnected: boolean;
  onSubmit: (name: string) => Promise<void>;
};

export const NameDialog = ({ isConnected, onSubmit }: NameDialogProps) => {
  const [userName, setUserName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userName.trim() && isConnected && !isSubmitting) {
      try {
        setIsSubmitting(true);
        await onSubmit(userName.trim());
      } catch (error) {
        console.error('Failed to set name:', error);
        setIsSubmitting(false);
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 flex items-center justify-center bg-black/80 z-50"
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-xl font-semibold text-white mb-4">
          Welcome to the Sandbox!
        </h2>
        <p className="text-gray-300 mb-6">
          Choose a display name to identify yourself to others
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Enter your name..."
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent"
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            disabled={isSubmitting}
          />
          <button
            type="submit"
            className="w-full mt-4 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!userName.trim() || !isConnected || isSubmitting}
          >
            {isSubmitting
              ? 'Setting name...'
              : isConnected
                ? 'Enter Sandbox'
                : 'Connecting...'}
          </button>
        </form>
      </div>
    </motion.div>
  );
};
