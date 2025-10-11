import { motion, AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { X } from 'lucide-react';
import { SandboxMessage, SandboxUser } from '../../spacetime-bindings';
import { MessageBubble } from './MessageBubble';
import { useSandbox } from '../../context/sandboxContext';

interface MessageGroupProps {
  messages: SandboxMessage[];
  position: { x: number; y: number };
  users: Map<string, SandboxUser>;
  currentUserId?: string;
  onDismissMessage?: (messageId: bigint) => void;
  onDismissGroup?: (messageIds: bigint[]) => void;
}

export const MessageGroup = ({
  messages,
  position,
  users,
  currentUserId,
  onDismissMessage,
  onDismissGroup,
}: MessageGroupProps) => {
  const [isGroupHovered, setIsGroupHovered] = useState(false);
  const [isGroupButtonHovered, setIsGroupButtonHovered] = useState(false);
  const [isInTopArea, setIsInTopArea] = useState(false);
  const { setCursorInteractive, setCursorDefault } = useSandbox();

  // sort messages by creation time (newest at bottom)
  // so that motion pushes the older messages up
  const sortedMessages = [...messages].sort(
    (a, b) => Number(a.createdAt) - Number(b.createdAt),
  );

  // Check if current user can dismiss the group (owns any message in the group)
  const canDismissGroup = sortedMessages.some(
    (message) => message.senderIdentity.toHexString() === currentUserId,
  );

  const handleGroupDismiss = () => {
    if (onDismissGroup) {
      const messageIds = sortedMessages.map((message) => message.id);
      onDismissGroup(messageIds);
    }
  };

  const handleGroupMouseEnter = () => {
    if (canDismissGroup && sortedMessages.length > 1) {
      setIsGroupHovered(true);
      setCursorInteractive();
    }
  };

  const handleGroupMouseLeave = () => {
    setIsGroupHovered(false);
    setIsInTopArea(false);
    setCursorDefault();
  };

  const handleGroupMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canDismissGroup || sortedMessages.length <= 1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;

    setIsInTopArea(relativeY <= 50);
  };

  const handleGroupButtonMouseEnter = () => {
    setIsGroupButtonHovered(true);
    setCursorInteractive();
  };

  const handleGroupButtonMouseLeave = () => {
    setIsGroupButtonHovered(false);
    setCursorDefault();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute pointer-events-none"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(12px, -100%)',
      }}
    >
      <div
        className="relative group"
        onMouseEnter={handleGroupMouseEnter}
        onMouseLeave={handleGroupMouseLeave}
        onMouseMove={handleGroupMouseMove}
      >
        {/* Extended hover area to include group dismiss button */}
        {canDismissGroup && sortedMessages.length > 1 && (
          <div className="absolute -inset-4 -top-8 -right-8 pointer-events-auto" />
        )}

        {/* Group outline and dismiss button */}
        <AnimatePresence>
          {isGroupHovered &&
            isInTopArea &&
            canDismissGroup &&
            sortedMessages.length > 1 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="absolute inset-0 pointer-events-none"
              >
                {/* Group outline */}
                <div
                  className="absolute inset-0 rounded-lg transition-all duration-200"
                  style={{
                    outline: `2px solid ${isGroupButtonHovered ? 'rgba(220, 38, 38, 0.8)' : 'rgba(255, 255, 255, 0.6)'}`,
                    outlineOffset: '12px',
                  }}
                />
                {/* Group dismiss button */}
                <button
                  onClick={handleGroupDismiss}
                  onMouseEnter={handleGroupButtonMouseEnter}
                  onMouseLeave={handleGroupButtonMouseLeave}
                  className="absolute -top-5 -right-6 w-4 h-4 bg-white/90 hover:bg-red-500 text-gray-800 hover:text-white rounded-full transition-all duration-200 cursor-none border-0 p-0 m-0 leading-none z-30 pointer-events-auto shadow-lg"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 0,
                  }}
                  title="Dismiss all messages"
                >
                  <X size={10} strokeWidth={2.5} style={{ display: 'block' }} />
                </button>
              </motion.div>
            )}
        </AnimatePresence>

        <div className="flex flex-col gap-2 pointer-events-auto">
          <AnimatePresence mode="sync">
            {sortedMessages.map((message) => {
              const user = users.get(message.senderIdentity.toHexString());
              const userName =
                user?.name || message.senderIdentity.toHexString().slice(0, 8);
              const userColor = user?.color || '#888888';

              return (
                <motion.div
                  key={Number(message.id)}
                  layout
                  initial={{ y: 20 }}
                  animate={{ y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{
                    layout: { type: 'spring', stiffness: 300, damping: 30 },
                  }}
                  className="w-fit"
                >
                  <MessageBubble
                    message={message}
                    userName={userName}
                    userColor={userColor}
                    currentUserId={currentUserId}
                    onDismiss={onDismissMessage}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};
