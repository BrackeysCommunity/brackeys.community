import { motion } from 'motion/react';
import { SandboxMessage } from '../../spacetime-bindings';

interface MessageBubbleProps {
  message: SandboxMessage;
  userName: string;
  userColor: string;
}

export const MessageBubble = ({
  message,
  userName,
  userColor,
}: MessageBubbleProps) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.8, y: 10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.8, y: -10 }}
    transition={{
      duration: 0.3,
      ease: "easeOut"
    }}
    className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-xs"
    style={{
      borderTopColor: userColor,
      borderTopWidth: '3px',
    }}
  >
    <div className="flex items-start gap-2">
      <div
        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
        style={{ backgroundColor: userColor }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
          {userName}
        </p>
        <p className="text-sm text-gray-900 dark:text-gray-100 break-words">
          {message.text}
        </p>
      </div>
    </div>
  </motion.div>
);