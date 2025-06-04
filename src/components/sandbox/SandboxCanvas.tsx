import { useEffect, useRef, useMemo } from 'react'
import { MousePointer2 } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { SandboxUser, LiveTyping, SandboxMessage } from '../../spacetime-bindings'
import { Cursors } from './cursors/Cursors'
import { StatusIndicators } from './StatusIndicators'
import { MessageGroup } from './MessageGroup'
import { CURSOR_UPDATE_THRESHOLD, CURSOR_UPDATE_INTERVAL, MESSAGE_POSITION_TOLERANCE_PX } from './constants'

type SandboxCanvasProps = {
  isConnected: boolean
  showNameDialog: boolean
  users: SandboxUser[]
  currentUserId?: string
  typingStates: Map<string, LiveTyping>
  messages: SandboxMessage[]
  isTyping: boolean
  typingText: string
  lastCursorPosition: { x: number; y: number }
  onCursorMove: (x: number, y: number) => void
  onTypingStart: () => void
  onTypingChange: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose: () => void
  onSendMessage: (text: string, x: number, y: number) => void
  onDismissMessage: (messageId: bigint) => void
}

export const SandboxCanvas = ({
  isConnected,
  showNameDialog,
  users,
  currentUserId,
  typingStates,
  messages,
  isTyping,
  typingText,
  lastCursorPosition,
  onCursorMove,
  onTypingStart,
  onTypingChange,
  onTypingClose,
  onSendMessage,
  onDismissMessage
}: SandboxCanvasProps) => {
  const canvasRef = useRef<HTMLDivElement>(null)

  const usersMap = useMemo(() => new Map(users.map(u => [u.identity.toHexString(), u])), [users])

  // group messages by position (with some tolerance for grouping nearby messages)
  const messageGroups = useMemo(() => {
    const groups = new Map<string, { position: { x: number; y: number }; messages: SandboxMessage[] }>()
    const tolerance = MESSAGE_POSITION_TOLERANCE_PX

    messages.forEach(message => {
      let foundGroup = false

      for (const [, group] of groups) {
        if (
          Math.abs(group.position.x - message.positionX) < tolerance &&
          Math.abs(group.position.y - message.positionY) < tolerance
        ) {
          group.messages.push(message)
          foundGroup = true
          break
        }
      }

      if (!foundGroup) {
        const key = `${Math.round(message.positionX)}-${Math.round(message.positionY)}`
        groups.set(key, {
          position: { x: message.positionX, y: message.positionY },
          messages: [message]
        })
      }
    })

    return groups
  }, [messages])

  const handleTypingClose = () => {
    onTypingClose()
    canvasRef.current?.focus()
  }

  useEffect(() => {
    if (!canvasRef.current || !isConnected || showNameDialog) return

    const canvas = canvasRef.current
    let lastUpdate = Date.now()
    let lastX = -1
    let lastY = -1

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now()
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100

      lastCursorPosition.x = x
      lastCursorPosition.y = y

      const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2))
      if (distance > CURSOR_UPDATE_THRESHOLD || now - lastUpdate > CURSOR_UPDATE_INTERVAL) {
        onCursorMove(x, y)
        lastUpdate = now
        lastX = x
        lastY = y
      }
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove)
    }
  }, [isConnected, showNameDialog, onCursorMove, lastCursorPosition])

  useEffect(() => {
    if (!canvasRef.current || !isConnected || showNameDialog) return

    const canvas = canvasRef.current

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTyping && e.key === '/') {
        e.preventDefault()
        onTypingStart()
      }
    }

    canvas.addEventListener('keydown', handleKeyDown)
    canvas.tabIndex = 0

    return () => {
      canvas.removeEventListener('keydown', handleKeyDown)
    }
  }, [isConnected, showNameDialog, isTyping, onTypingStart])

  const activeUserCount = users.length;

  return (
    <div ref={canvasRef} className="absolute inset-0 outline-none cursor-none">
      <div className="absolute w-full px-4">
        <div className="relative w-full container mx-auto">
          <StatusIndicators
            isConnected={isConnected}
            userCount={activeUserCount}
          />
        </div>
      </div>

      {showNameDialog ? (
        <div className="w-full h-full flex items-center justify-center text-gray-400">
          <div className="text-center">
            <MousePointer2 size={48} className="mx-auto mb-4 text-brackeys-purple-400" />
            <p className="text-gray-300">Move your cursor to see it tracked in real-time</p>
            <p className="text-sm mt-2 text-gray-400">Set your name above to start collaborating</p>
          </div>
        </div>
      ) : (
        <>
          <div className="absolute inset-0 bg-dot-pattern pattern-mask-radial pattern-opacity-40" />

          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-center pointer-events-none">
            <p className="text-xs text-gray-500">
              Press "/" to start typing
            </p>
          </div>

          <Cursors
            users={users}
            currentUserId={currentUserId}
            typingStates={typingStates}
            isTyping={isTyping}
            typingText={typingText}
            onTypingChange={onTypingChange}
            onTypingClose={handleTypingClose}
            onSendMessage={onSendMessage}
          />

          <AnimatePresence>
            {Array.from(messageGroups.entries()).map(([key, group]) => (
              <MessageGroup
                key={key}
                messages={group.messages}
                position={group.position}
                users={usersMap}
                currentUserId={currentUserId}
                onDismissMessage={onDismissMessage}
              />
            ))}
          </AnimatePresence>
        </>
      )}
    </div>
  )
} 