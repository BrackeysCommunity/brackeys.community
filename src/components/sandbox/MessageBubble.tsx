import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { SandboxMessage } from '../../spacetime-bindings';
import { useSandbox } from '../../context/sandboxContext';
import { useEffect, useMemo } from 'react';
import { generateColorScheme } from '../../lib/colors';

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
  const { setCursorInteractive, setCursorDefault, hoveredElementId, setHoveredElement } =
    useSandbox();
  const messageId = message.id.toString();
  const isThisMessageHovered = hoveredElementId === messageId;

  // Generate color scheme for the message
  const colorScheme = useMemo(() => generateColorScheme(userColor), [userColor]);

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
    <div className="relative group">
      {isOwnMessage && onDismiss && (
        <>
          <div className="absolute -left-2 -top-8 -bottom-2 -right-8 pointer-events-none group-hover:pointer-events-auto" />
          <button
            onClick={handleDismiss}
            onMouseEnter={handleButtonMouseEnter}
            onMouseLeave={handleButtonMouseLeave}
            className="absolute -top-1 -right-1 w-4 h-4 bg-white/90 hover:bg-red-500 text-gray-800 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-none border-0 p-0 m-0 leading-none z-10 shadow-lg"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
            title="Dismiss message"
          >
            <X size={12} strokeWidth={2.5} style={{ display: 'block' }} />
          </button>
        </>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: -10 }}
        transition={{ duration: 0.2 }}
        className="px-3 py-2 rounded-lg shadow-lg max-w-xs transition-all duration-200"
        style={{
          backgroundColor: isThisMessageHovered ? colorScheme.hover : userColor,
          boxShadow: isThisMessageHovered
            ? `0 4px 20px ${colorScheme.shadow}, 0 0 0 2px ${colorScheme.outline}`
            : `0 4px 12px ${colorScheme.shadow}, 0 0 0 1px ${colorScheme.outline}`,
        }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium mb-0.5" style={{ color: colorScheme.contrastText }}>
            {userName}
          </p>
          <p className="text-sm break-words" style={{ color: colorScheme.contrastText }}>
            {message.text}
          </p>
        </div>
      </motion.div>
    </div>
  );
};
