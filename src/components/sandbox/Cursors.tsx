import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { SandboxUser, LiveTyping } from '../../api/spacetime-db'

const CURSOR_ANIMATION_CONFIG = {
  opacity: { duration: 0.05 },
  scale: { duration: 0.05 },
} as const

const CURSOR_SHADOW_FILTER = 'drop-shadow(0 2px 8px rgba(0,0,0,0.6)) drop-shadow(0 0 0 1px rgba(255,255,255,0.8))'
const CURSOR_PATH = "M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"

type SimpleTypingState = {
  text: string
  isTyping: boolean
  selectionStart: number
  selectionEnd: number
}

type CursorProps = {
  user: SandboxUser
  isCurrentUser?: boolean
  typingState?: LiveTyping | SimpleTypingState
  onTypingChange?: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose?: () => void
}

type CursorLayerProps = {
  users: SandboxUser[]
  currentUserId?: string
  typingStates?: Map<string, LiveTyping>
  isTyping?: boolean
  typingText?: string
  onTypingChange?: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose?: () => void
}

type CursorPosition = {
  x: number
  y: number
}

const getUserPosition = (user: SandboxUser): CursorPosition => ({ x: user.cursorX, y: user.cursorY })

const renderTextWithSelection = (text: string, selectionStart: number, selectionEnd: number) => {
  if (selectionStart === selectionEnd || selectionStart < 0 || selectionEnd < 0) {
    return <span>{text}</span>
  }

  const beforeSelection = text.slice(0, selectionStart)
  const selection = text.slice(selectionStart, selectionEnd)
  const afterSelection = text.slice(selectionEnd)

  return (
    <>
      {beforeSelection}
      <span className="bg-blue-500/30 text-blue-100 rounded-sm px-0.5">
        {selection}
      </span>
      {afterSelection}
    </>
  )
}

const Cursor = ({ user, isCurrentUser, typingState, onTypingChange, onTypingClose }: CursorProps) => {
  const [position, setPosition] = useState<CursorPosition>(() => getUserPosition(user))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isTyping = typingState?.isTyping || false

  useEffect(() => {
    setPosition(getUserPosition(user))
  }, [user.cursorX, user.cursorY])

  useEffect(() => {
    if (isCurrentUser && isTyping && textareaRef.current) {
      textareaRef.current.focus()
      const len = typingState?.text?.length || 0
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [isCurrentUser, isTyping])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!onTypingChange) return
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 124)}px`
    onTypingChange(textarea.value, textarea.selectionStart || 0, textarea.selectionEnd || 0)
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (!onTypingChange) return
    const textarea = e.currentTarget
    onTypingChange(textarea.value, textarea.selectionStart || 0, textarea.selectionEnd || 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!onTypingClose) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onTypingClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onTypingClose()
    }
  }

  const handleBlur = () => {
    if (!onTypingClose) return
    setTimeout(() => {
      if (document.activeElement !== textareaRef.current) {
        onTypingClose()
      }
    }, 200)
  }

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
      className={`absolute z-10 ${(isCurrentUser && isTyping) ? 'pointer-events-auto' : 'pointer-events-none'}`}
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

        {/* Label that expands into typing bubble */}
        <motion.div
          className="absolute top-3.5 left-3.5 whitespace-nowrap"
          initial={false}
          animate={{
            width: isTyping ? 'auto' : 'auto',
            height: isTyping ? 'auto' : 'auto',
            minWidth: isTyping && !isCurrentUser ? '200px' : 'auto',
          }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 25,
          }}
        >
          <motion.div
            className="overflow-hidden rounded-lg shadow-lg border"
            style={{
              backgroundColor: isTyping ? '#111827' : user.color,
              borderColor: isTyping ? '#374151' : 'rgba(255,255,255,0.2)',
              boxShadow: isTyping
                ? `0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px ${user.color}40`
                : '0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.2)',
            }}
            animate={{
              padding: isTyping ? '8px 12px' : '4px 8px',
            }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25,
            }}
          >
            {/* User name - always visible */}
            <motion.div
              className="text-xs font-medium flex justify-between"
              style={{ color: isTyping ? user.color : 'white' }}
              animate={{
                marginBottom: isTyping ? '4px' : '0px',
              }}
            >
              {user.name || 'Anonymous'}
              {isTyping && isCurrentUser && <span className="text-xs text-gray-400">ESC to cancel</span>}
            </motion.div>

            {/* Typing content - only visible when typing */}
            <AnimatePresence>
              {isTyping && typingState && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    opacity: { duration: 0.2 },
                    height: { duration: 0.2 },
                  }}
                >
                  {isCurrentUser ? (
                    <>
                      <textarea
                        ref={textareaRef}
                        value={typingState.text}
                        onChange={handleChange}
                        onSelect={handleSelect}
                        onKeyDown={handleKeyDown}
                        onBlur={handleBlur}
                        className="bg-transparent text-white text-sm font-mono resize-none outline-none w-full min-w-50 min-h-4 max-h-36 h-auto placeholder-gray-500"
                        placeholder="Start typing..."
                        maxLength={200}
                        rows={1}
                      />
                    </>
                  ) : (
                    <div className="text-sm font-mono whitespace-pre-wrap break-words text-white w-fit max-w-[400px]">
                      {renderTextWithSelection(
                        typingState.text,
                        'selectionStart' in typingState ? typingState.selectionStart : 0,
                        'selectionEnd' in typingState ? typingState.selectionEnd : 0
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </CursorWrapper>
  )
}

export const Cursors = ({
  users,
  currentUserId,
  typingStates,
  isTyping,
  typingText,
  onTypingChange,
  onTypingClose
}: CursorLayerProps) => {
  const currentUser = users.find(user => user.identity.toHexString() === currentUserId)
  const otherUsers = users.filter(user => user.identity.toHexString() !== currentUserId)

  // Create a simplified typing state for the current user when typing
  const currentUserTypingState: SimpleTypingState | undefined = isTyping && currentUser ? {
    text: typingText || '',
    isTyping: true,
    selectionStart: 0,
    selectionEnd: 0,
  } : undefined

  return (
    <div className="absolute inset-0 pointer-events-none [&:hover]:cursor-none">
      <AnimatePresence>
        {otherUsers.map(user => {
          const userId = user.identity.toHexString()
          const typingState = typingStates?.get(userId)
          return (
            <Cursor
              key={userId}
              user={user}
              typingState={typingState}
            />
          )
        })}
      </AnimatePresence>
      {currentUser && (
        <Cursor
          user={currentUser}
          isCurrentUser
          typingState={currentUserTypingState}
          onTypingChange={onTypingChange}
          onTypingClose={onTypingClose}
        />
      )}
    </div>
  )
}