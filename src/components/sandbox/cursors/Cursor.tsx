import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { SandboxUser, LiveTyping } from '../../../spacetime-bindings'
import { cn } from '../../../lib/utils'
import { CursorIcon } from './CursorIcon'
import { TypingBubble } from '../TypingBubble'
import { CURSOR_ANIMATION_CONFIG } from '../constants'

type SimpleTypingState = {
  text: string
  isTyping: boolean
  selectionStart: number
  selectionEnd: number
}

type CursorContainerProps = {
  user: SandboxUser
  isCurrentUser?: boolean
  typingState?: LiveTyping | SimpleTypingState
  onTypingChange?: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose?: () => void
  onSendMessage?: (text: string, x: number, y: number) => void
}

type CursorPosition = {
  x: number
  y: number
}

const getUserPosition = (user: SandboxUser): CursorPosition => ({ x: user.cursorX, y: user.cursorY })

export const CursorContainer = ({ user, isCurrentUser, typingState, onTypingChange, onTypingClose, onSendMessage }: CursorContainerProps) => {
  const [position, setPosition] = useState<CursorPosition>(() => getUserPosition(user))
  const isTyping = typingState?.isTyping || false

  useEffect(() => {
    const newPosition = getUserPosition(user)
    setPosition(prev => {
      // Only update if position actually changed to avoid unnecessary re-renders
      if (prev.x !== newPosition.x || prev.y !== newPosition.y) {
        return newPosition
      }
      return prev
    })
  }, [user.cursorX, user.cursorY])

  const CursorWrapper = isCurrentUser ? 'div' : motion.div
  const cursorStyles = {
    position: 'absolute',
    pointerEvents: (isCurrentUser && isTyping) ? 'auto' : 'none',
    zIndex: 10,
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: 'translate(0, 0)'
  } as const

  return (
    <CursorWrapper
      className={cn("absolute z-10", isCurrentUser && isTyping ? 'pointer-events-auto' : 'pointer-events-none')}
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
        <CursorIcon user={user} isCurrentUser={isCurrentUser} />

        {typingState && (
          <TypingBubble
            user={user}
            isCurrentUser={isCurrentUser}
            typingState={typingState}
            onTypingChange={onTypingChange}
            onTypingClose={onTypingClose}
            onSendMessage={onSendMessage ? (text) => onSendMessage(text, position.x, position.y) : undefined}
          />
        )}
      </div>
    </CursorWrapper>
  )
} 