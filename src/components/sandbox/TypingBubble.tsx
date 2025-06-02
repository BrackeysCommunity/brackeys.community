import { motion, AnimatePresence } from 'motion/react'
import { useRef, useEffect } from 'react'
import { SandboxUser, LiveTyping } from '../../api/spacetime-db'
import { TYPING_ANIMATION_CONFIG, TYPING_BUBBLE_TRANSITIONS, TYPING_BLUR_TIMEOUT, MAX_TYPING_LENGTH } from './constants'

type SimpleTypingState = {
  text: string
  isTyping: boolean
  selectionStart: number
  selectionEnd: number
}

type TypingBubbleProps = {
  user: SandboxUser
  isCurrentUser?: boolean
  typingState: LiveTyping | SimpleTypingState
  onTypingChange?: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose?: () => void
}

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

export const TypingBubble = ({
  user,
  isCurrentUser,
  typingState,
  onTypingChange,
  onTypingClose
}: TypingBubbleProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isTyping = typingState?.isTyping || false

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
    }, TYPING_BLUR_TIMEOUT)
  }

  return (
    <motion.div
      className="absolute top-3.5 left-3.5 whitespace-nowrap"
      initial={false}
      animate={{
        width: isTyping ? 'auto' : 'auto',
        height: isTyping ? 'auto' : 'auto',
        minWidth: isTyping && !isCurrentUser ? '200px' : 'auto',
      }}
      transition={TYPING_ANIMATION_CONFIG}
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
        transition={TYPING_ANIMATION_CONFIG}
      >
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

        <AnimatePresence>
          {isTyping && typingState && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={TYPING_BUBBLE_TRANSITIONS}
            >
              {isCurrentUser ? (
                <textarea
                  ref={textareaRef}
                  value={typingState.text}
                  onChange={handleChange}
                  onSelect={handleSelect}
                  onKeyDown={handleKeyDown}
                  onBlur={handleBlur}
                  className="bg-transparent text-white text-sm font-mono resize-none outline-none w-full min-w-50 min-h-4 max-h-36 h-auto placeholder-gray-500"
                  placeholder="Start typing..."
                  maxLength={MAX_TYPING_LENGTH}
                  rows={1}
                />
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
  )
} 