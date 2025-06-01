import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { SandboxUser } from '../../api/spacetime-db'

// Static content
const CURSOR_ANIMATION_CONFIG = {
  opacity: { duration: 0.05 },
  scale: { duration: 0.05 },
} as const

const CURSOR_SHADOW_FILTER = 'drop-shadow(0 2px 8px rgba(0,0,0,0.6)) drop-shadow(0 0 0 1px rgba(255,255,255,0.8))'
const CURSOR_PATH = "M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"

type CursorProps = {
  user: SandboxUser
  isCurrentUser?: boolean
}

type CursorLayerProps = {
  users: SandboxUser[]
  currentUserId?: string
}

type CursorPosition = {
  x: number
  y: number
}

const getUserPosition = (user: SandboxUser): CursorPosition => ({ x: user.cursorX, y: user.cursorY })

const Cursor = ({ user, isCurrentUser }: CursorProps) => {
  const [position, setPosition] = useState<CursorPosition>(() => getUserPosition(user))

  useEffect(() => {
    setPosition(getUserPosition(user))
  }, [user.cursorX, user.cursorY])

  const CursorWrapper = isCurrentUser ? 'div' : motion.div
  const cursorStyles = {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 10,
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: 'translate(0, 0)'
  } as const

  return (
    <CursorWrapper
      className="absolute pointer-events-none z-10"
      {...(!isCurrentUser && {
        initial: { opacity: 0, scale: 0.8 },
        animate: {
          opacity: 1,
          scale: 1,
          left: `${position.x}%`,
          top: `${position.y}%`,
        },
        exit: { opacity: 0, scale: 0.8 },
        transition: CURSOR_ANIMATION_CONFIG,
        style: { transform: 'translate(-50%, -50%)' },
      })}
      style={isCurrentUser ? cursorStyles : undefined}
    >
      <div className="relative">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            filter: CURSOR_SHADOW_FILTER,
          }}
        >
          <path
            d={CURSOR_PATH}
            fill={user.color}
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="1.5"
          />
        </svg>
        <AnimatePresence>
          {user.name && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.8 }}
              className="absolute top-6 left-2 px-2 py-1 rounded-md text-xs font-medium text-white whitespace-nowrap border border-white/20 shadow-lg backdrop-blur-sm"
              style={{
                backgroundColor: user.color,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.2)',
              }}
            >
              {user.name}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CursorWrapper>
  )
}

export const Cursors = ({ users, currentUserId }: CursorLayerProps) => {
  const currentUser = users.find(user => user.identity.toHexString() === currentUserId)
  const otherUsers = users.filter(user => user.identity.toHexString() !== currentUserId)

  return (
    <div className="absolute inset-0 pointer-events-none [&:hover]:cursor-none">
      <AnimatePresence>
        {otherUsers.map(user => (
          <Cursor key={user.identity.toHexString()} user={user} />
        ))}
      </AnimatePresence>
      {currentUser && <Cursor user={currentUser} isCurrentUser />}
    </div>
  )
}