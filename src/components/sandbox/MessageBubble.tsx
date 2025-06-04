import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { SandboxMessage } from '../../spacetime-bindings';
import { useSandbox } from '../../context/sandboxContext';
import { useEffect } from 'react';

interface MessageBubbleProps {
  message: SandboxMessage;
  userName: string;
  userColor: string;
  currentUserId?: string;
  onDismiss?: (messageId: bigint) => void;
}

export const MessageBubble = ({
  message,
  userName,
  userColor,
  currentUserId,
  onDismiss,
}: MessageBubbleProps) => {
  const isOwnMessage = currentUserId === message.senderIdentity.toHexString();
  const { setCursorInteractive, setCursorDefault, hoveredElementId, setHoveredElement } = useSandbox();
  const messageId = message.id.toString();
  const isThisMessageHovered = hoveredElementId === messageId;

  useEffect(() => {
    return () => {
      if (isThisMessageHovered) setHoveredElement(null);
    };
  }, [isThisMessageHovered, setHoveredElement]);

  const handleDismiss = () => {
    onDismiss?.(message.id);
    if (isThisMessageHovered) {
      setHoveredElement(null);
      setCursorDefault();
    }
  };

  const handleButtonMouseEnter = () => {
    setHoveredElement(messageId);
    setCursorInteractive();
  };

  const handleButtonMouseLeave = () => {
    setHoveredElement(null);
    setCursorDefault();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -10 }}
      transition={{
        duration: 0.3,
        ease: "easeOut"
      }}
      className={`group px-3 py-2 rounded-lg shadow-lg border max-w-xs relative transition-colors duration-200 ${isThisMessageHovered
        ? 'bg-red-950/40 border-red-800'
        : 'bg-gray-800 border-gray-700'
        }`}
      style={{
        borderTopColor: userColor,
        borderTopWidth: '3px',
      }}
    >
      <div className="flex items-start gap-2">
        <div className="w-4 h-4 mt-1 flex-shrink-0 relative flex items-center justify-center">
          {isOwnMessage && onDismiss ? (
            <>
              <div
                className="w-2 h-2 rounded-full group-hover:opacity-0 transition-opacity duration-200 absolute"
                style={{ backgroundColor: userColor }}
              />
              <button
                onClick={handleDismiss}
                onMouseEnter={handleButtonMouseEnter}
                onMouseLeave={handleButtonMouseLeave}
                className="absolute w-4 h-4 bg-gray-400/50 hover:bg-red-500 text-gray-800 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-none border-0 p-0 m-0 leading-none"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 0,
                }}
                title="Dismiss message"
              >
                <X size={10} strokeWidth={2.5} style={{ display: 'block' }} />
              </button>
            </>
          ) : (
            <div
              className="w-2 h-2 rounded-full absolute"
              style={{ backgroundColor: userColor }}
            />
          )}
        </div>
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
};