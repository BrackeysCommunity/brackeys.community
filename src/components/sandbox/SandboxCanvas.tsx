import { useEffect, useRef } from 'react'
import { MousePointer2 } from 'lucide-react'
import { SandboxUser, LiveTyping } from '../../api/spacetime-db'
import { Cursors } from './cursors/Cursors'
import { StatusIndicators } from './StatusIndicators'
import { CURSOR_UPDATE_THRESHOLD, CURSOR_UPDATE_INTERVAL } from './constants'

type SandboxCanvasProps = {
  isConnected: boolean
  showNameDialog: boolean
  users: SandboxUser[]
  currentUserId?: string
  typingStates: Map<string, LiveTyping>
  isTyping: boolean
  typingText: string
  lastCursorPosition: { x: number; y: number }
  onCursorMove: (x: number, y: number) => void
  onTypingStart: () => void
  onTypingChange: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose: () => void
}

export const SandboxCanvas = ({
  isConnected,
  showNameDialog,
  users,
  currentUserId,
  typingStates,
  isTyping,
  typingText,
  lastCursorPosition,
  onCursorMove,
  onTypingStart,
  onTypingChange,
  onTypingClose
}: SandboxCanvasProps) => {
  const canvasRef = useRef<HTMLDivElement>(null)

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

  const activeUserCount = users.length

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
          />
        </>
      )}
    </div>
  )
} 