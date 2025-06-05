import { forwardRef, useImperativeHandle, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { SandboxUser, LiveTyping, SandboxMessage } from '../../spacetime-bindings'
import { Cursors } from './cursors/Cursors'
import { StatusIndicators } from './StatusIndicators'
import { MessageGroup } from './MessageGroup'

type MessageGroupData = {
  position: { x: number; y: number }
  messages: SandboxMessage[]
}

type SandboxCanvasProps = {
  isConnected: boolean
  users: SandboxUser[]
  currentUserId?: string
  typingStates: Map<string, LiveTyping>
  messageGroups: Map<string, MessageGroupData>
  usersMap: Map<string, SandboxUser>
  isTyping: boolean
  typingText: string
  activeUserCount: number
  roomCode?: string
  messagesEnabled?: boolean
  onTypingChange: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose: () => void
  onSendMessage: (text: string, x: number, y: number) => void
  onDismissMessage: (messageId: bigint) => void
  onDismissGroup?: (messageIds: bigint[]) => void
  onRoomClick?: () => void
}

export const SandboxCanvas = forwardRef<HTMLDivElement, SandboxCanvasProps>(({
  isConnected,
  users,
  currentUserId,
  typingStates,
  messageGroups,
  usersMap,
  isTyping,
  typingText,
  activeUserCount,
  roomCode,
  messagesEnabled = true,
  onTypingChange,
  onTypingClose,
  onSendMessage,
  onDismissMessage,
  onDismissGroup,
  onRoomClick
}, ref) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  // Properly forward the ref
  useImperativeHandle(ref, () => canvasRef.current!);

  return (
    <div
      ref={canvasRef}
      className="absolute inset-0 outline-none cursor-none focus:outline-2 focus:outline-red-500"
      tabIndex={0}
      onClick={() => canvasRef.current?.focus()}
    >
      <div className="absolute w-full px-4">
        <div className="relative w-full container mx-auto">
          <StatusIndicators
            isConnected={isConnected}
            userCount={activeUserCount}
            roomCode={roomCode}
            onRoomClick={onRoomClick}
          />
        </div>
      </div>

      <div className="absolute inset-0 bg-dot-pattern pattern-mask-radial pattern-opacity-40" />

      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-baseline pointer-events-none">
        <p className="text-xs text-gray-500">
          <kbd className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-md">
            /
          </kbd>
          {" "}to start typing
          {messagesEnabled && (
            <>
              {" "}• <kbd className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-md">
                Enter
              </kbd>
              {" "}to send
            </>
          )}
          {" "}• <kbd className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-md">
            ESC
          </kbd>
          {" "}to cancel
        </p>
      </div>

      <Cursors
        users={users}
        currentUserId={currentUserId}
        typingStates={typingStates}
        isTyping={isTyping}
        typingText={typingText}
        onTypingChange={onTypingChange}
        onTypingClose={onTypingClose}
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
            onDismissGroup={onDismissGroup}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}) 