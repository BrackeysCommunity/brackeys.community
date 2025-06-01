import { motion, AnimatePresence } from 'motion/react'
import { LiveTyping } from '../../api/spacetime-db'

type TypingBubbleProps = {
  typing: LiveTyping
  userColor: string
  userName?: string
}

type TypingBubblesProps = {
  typingStates: Map<string, LiveTyping>
  users: Array<{ identity: { toHexString: () => string }, color: string, name?: string }>
  currentUserId?: string
}

const TypingBubble = ({ typing, userColor, userName }: TypingBubbleProps) => {
  if (!typing.isTyping || !typing.text) return null

  return (
    <motion.div
      className="absolute pointer-events-none z-20"
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        left: `${typing.positionX}%`,
        top: `${typing.positionY}%`,
      }}
      exit={{ opacity: 0, scale: 0.8, y: 10 }}
      transition={{
        opacity: { duration: 0.15 },
        scale: { duration: 0.15 },
        left: { type: "spring", stiffness: 400, damping: 30 },
        top: { type: "spring", stiffness: 400, damping: 30 },
      }}
    >
      <div
        className="relative bg-gray-900 text-white px-3 py-2 rounded-lg shadow-2xl border border-gray-700 max-w-xs"
        style={{
          boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px ${userColor}40`,
        }}
      >
        {userName && (
          <div
            className="text-xs font-medium mb-1 opacity-70"
            style={{ color: userColor }}
          >
            {userName}
          </div>
        )}
        <div className="text-sm font-mono whitespace-pre-wrap break-words">
          {typing.text}
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
            className="inline-block w-0.5 h-4 bg-white ml-0.5 align-middle"
          />
        </div>
      </div>
    </motion.div>
  )
}

export const TypingBubbles = ({ typingStates, users, currentUserId }: TypingBubblesProps) => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <AnimatePresence>
        {Array.from(typingStates.entries()).map(([userId, typing]) => {
          if (userId === currentUserId) return null

          const user = users.find(u => u.identity.toHexString() === userId)
          if (!user) return null

          return (
            <TypingBubble
              key={userId}
              typing={typing}
              userColor={user.color}
              userName={user.name}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
} 