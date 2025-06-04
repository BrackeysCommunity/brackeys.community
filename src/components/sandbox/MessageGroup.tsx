import { motion, AnimatePresence } from 'motion/react';
import { SandboxMessage, SandboxUser } from '../../spacetime-bindings';
import { MessageBubble } from './MessageBubble';

interface MessageGroupProps {
  messages: SandboxMessage[];
  position: { x: number; y: number };
  users: Map<string, SandboxUser>;
}

export const MessageGroup = ({
  messages,
  position,
  users,
}: MessageGroupProps) => {
  // sort messages by creation time (newest at bottom)
  // so that motion pushes the older messages up
  const sortedMessages = [...messages].sort((a, b) =>
    Number(a.createdAt) - Number(b.createdAt)
  );

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
      <div className="flex flex-col gap-2">
        <AnimatePresence mode="sync">
          {sortedMessages.map((message) => {
            const user = users.get(message.senderIdentity.toHexString());
            const userName = user?.name || message.senderIdentity.toHexString().slice(0, 8);
            const userColor = user?.color || '#888888';

            return (
              <motion.div
                key={Number(message.id)}
                layout
                initial={{ y: 20 }}
                animate={{ y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{
                  layout: { type: "spring", stiffness: 300, damping: 30 }
                }}
                className="pointer-events-auto w-fit"
              >
                <MessageBubble
                  message={message}
                  userName={userName}
                  userColor={userColor}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}; 