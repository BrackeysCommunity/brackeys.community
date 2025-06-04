import { forwardRef } from 'react'
import { MousePointer2 } from 'lucide-react'
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
  showNameDialog: boolean
  users: SandboxUser[]
  currentUserId?: string
  typingStates: Map<string, LiveTyping>
  messageGroups: Map<string, MessageGroupData>
  usersMap: Map<string, SandboxUser>
  isTyping: boolean
  typingText: string
  activeUserCount: number
  onTypingChange: (text: string, selectionStart: number, selectionEnd: number) => void
  onTypingClose: () => void
  onSendMessage: (text: string, x: number, y: number) => void
  onDismissMessage: (messageId: bigint) => void
  onDismissGroup?: (messageIds: bigint[]) => void
}

export const SandboxCanvas = forwardRef<HTMLDivElement, SandboxCanvasProps>(({
  isConnected,
  showNameDialog,
  users,
  currentUserId,
  typingStates,
  messageGroups,
  usersMap,
  isTyping,
  typingText,
  activeUserCount,
  onTypingChange,
  onTypingClose,
  onSendMessage,
  onDismissMessage,
  onDismissGroup
}, ref) => {

  return (
    <div
      ref={ref}
      className="absolute inset-0 outline-none cursor-none"
      tabIndex={0}
    >
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

          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-baseline pointer-events-none">
            <p className="text-xs text-gray-500">
              <kbd className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-md">
                /
              </kbd>
              {" "}to start typing • <kbd className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-md">
                Enter
              </kbd>
              {" "}to send • <kbd className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-md">
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
        </>
      )}
    </div>
  )
}) 