import { motion, AnimatePresence } from 'motion/react'
import { useRef, useEffect } from 'react'
import { SandboxUser, LiveTyping } from '../../spacetime-bindings'
import { useSandbox } from '../../context/sandboxContext'
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
  onSendMessage?: (text: string) => void
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
      <span className="bg-white/30 text-white rounded-sm px-0.5">
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
  onTypingClose,
  onSendMessage
}: TypingBubbleProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { setCursorTyping, setCursorDefault } = useSandbox()
  const isTyping = typingState?.isTyping || false

  useEffect(() => {
    if (isCurrentUser && isTyping && textareaRef.current) {
      textareaRef.current.focus()
      const len = typingState?.text?.length || 0
      textareaRef.current.setSelectionRange(len, len)
      setCursorTyping()
    } else if (isCurrentUser && !isTyping) {
      setCursorDefault()
    }
  }, [isCurrentUser, isTyping, setCursorTyping, setCursorDefault])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!onTypingChange) return
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 124)}px`
    onTypingChange(textarea.value, textarea.selectionStart || 0, textarea.selectionEnd || 0)
  }

  const handleSelectionChange = (textarea: HTMLTextAreaElement) => {
    if (!onTypingChange) return
    const start = textarea.selectionStart || 0
    const end = textarea.selectionEnd || 0
    onTypingChange(textarea.value, start, end)
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    handleSelectionChange(e.currentTarget)
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    handleSelectionChange(e.currentTarget)
  }

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    handleSelectionChange(e.currentTarget)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onTypingClose?.()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendMessage?.(e.currentTarget.value.trim())
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
        className="overflow-hidden rounded-lg shadow-lg"
        style={{ backgroundColor: user.color }}
        animate={{
          padding: isTyping ? '8px 12px' : '4px 8px',
        }}
        transition={TYPING_ANIMATION_CONFIG}
      >
        <motion.div
          className="text-xs font-medium flex justify-between"
          style={{ color: 'white' }}
          animate={{
            marginBottom: isTyping ? '4px' : '0px',
          }}
        >
          {user.name || 'Anonymous'}
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
                  onKeyUp={handleKeyUp}
                  onMouseUp={handleMouseUp}
                  onClick={handleSelect}
                  onBlur={handleBlur}
                  className="bg-transparent text-white text-sm font-mono resize-none outline-none w-full min-w-50 min-h-4 max-h-36 h-auto placeholder-gray-300"
                  placeholder="Start typing..."
                  maxLength={MAX_TYPING_LENGTH}
                  rows={1}
                />
              ) : (
                <div className="text-sm font-mono whitespace-pre-wrap break-words text-white w-fit max-w-[400px]">
                  {renderTextWithSelection(
                    typingState.text,
                    typingState.selectionStart || 0,
                    typingState.selectionEnd || 0
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