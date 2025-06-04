import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import { NameDialog } from '../components/sandbox/NameDialog'
import { SandboxCanvas } from '../components/sandbox/SandboxCanvas'
import { SpacetimeDBProvider } from '../context/SpacetimeDBProvider'
import { SandboxProvider } from '../context/SandboxProvider'
import { useLayoutProps } from '../context/layoutContext'
import { useSpacetimeDB } from '../context/spacetimeDBContext'
import { useDocTitle } from '../hooks/useDocTitle'
import { useSandbox } from '../context/sandboxContext'
import { LiveTyping, SandboxMessage, SandboxUser } from '../spacetime-bindings'

type SandboxViewProps = {
  showNameDialog: boolean;
  isConnected: boolean;
  isTyping: boolean;
  typingText: string;
  users: SandboxUser[];
  currentUser: SandboxUser | null;
  typingStates: Map<string, LiveTyping>;
  messages: SandboxMessage[];
  lastCursorPosition: { x: number; y: number };
  onSetName: (name: string) => Promise<void>;
  onCursorMove: (x: number, y: number) => void;
  onTypingStart: () => void;
  onTypingChange: (text: string, selectionStart: number, selectionEnd: number) => void;
  onTypingClose: () => void;
  onSendMessage: (text: string, x: number, y: number) => void;
  onDismissMessage: (messageId: bigint) => void;
}

// Pure presentational component
export const SandboxView = ({
  showNameDialog,
  isConnected,
  isTyping,
  typingText,
  users,
  currentUser,
  typingStates,
  messages,
  lastCursorPosition,
  onSetName,
  onCursorMove,
  onTypingStart,
  onTypingChange,
  onTypingClose,
  onSendMessage,
  onDismissMessage
}: SandboxViewProps) => {
  return (
    <div className="flex flex-col grow">
      {showNameDialog && (
        <NameDialog
          isConnected={isConnected}
          onSubmit={onSetName}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: showNameDialog ? 0.3 : 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex-1 relative bg-gray-850 overflow-hidden"
      >
        <SandboxCanvas
          isConnected={isConnected}
          showNameDialog={showNameDialog}
          users={users}
          currentUserId={currentUser?.identity.toHexString()}
          typingStates={typingStates}
          messages={messages}
          isTyping={isTyping}
          typingText={typingText}
          lastCursorPosition={lastCursorPosition}
          onCursorMove={onCursorMove}
          onTypingStart={onTypingStart}
          onTypingChange={onTypingChange}
          onTypingClose={onTypingClose}
          onSendMessage={onSendMessage}
          onDismissMessage={onDismissMessage}
        />
      </motion.div>
    </div>
  )
}

// Container component handling state and logic
const SandboxContainer = () => {
  const [showNameDialog, setShowNameDialog] = useState(true)
  const [isTyping, setIsTyping] = useState(false)
  const [typingText, setTypingText] = useState('')
  const { setCursorDefault, setCursorTyping } = useSandbox()

  const lastCursorPosition = useRef({ x: 50, y: 50 })

  const {
    isConnected,
    currentUser,
    users,
    typingStates,
    messages,
    setDisplayName,
    updateCursor,
    updateTyping,
    sendMessage,
    dismissMessage,
  } = useSpacetimeDB()

  const handleSetName = async (name: string) => {
    try {
      await setDisplayName(name)
      setShowNameDialog(false)
    } catch (error) {
      console.error('Failed to set name:', error)
      throw error
    }
  }

  const handleCursorMove = (x: number, y: number) => {
    setCursorDefault()
    updateCursor(x, y)
  }

  const handleTypingStart = () => {
    setIsTyping(true)
    setTypingText('')
  }

  const handleTypingChange = (text: string, selectionStart: number, selectionEnd: number) => {
    setTypingText(text)
    setCursorTyping()
    const { x, y } = lastCursorPosition.current
    updateTyping(text, x, y, selectionStart, selectionEnd)
  }

  const handleTypingClose = () => {
    setIsTyping(false)
    setCursorDefault()
    setTypingText('')
    updateTyping('', 0, 0, 0, 0)
  }

  return (
    <SandboxView
      showNameDialog={showNameDialog}
      isConnected={isConnected}
      isTyping={isTyping}
      typingText={typingText}
      users={users}
      currentUser={currentUser}
      typingStates={typingStates}
      messages={messages}
      lastCursorPosition={lastCursorPosition.current}
      onSetName={handleSetName}
      onCursorMove={handleCursorMove}
      onTypingStart={handleTypingStart}
      onTypingChange={handleTypingChange}
      onTypingClose={handleTypingClose}
      onSendMessage={sendMessage}
      onDismissMessage={dismissMessage}
    />
  )
}

export const Sandbox = () => {
  useLayoutProps({
    showFooter: false,
    containerized: false,
    mainClassName: "flex",
    fullHeight: true
  })

  useDocTitle('Sandbox - Brackeys Community')

  return (
    <SpacetimeDBProvider>
      <SandboxProvider>
        <SandboxContainer />
      </SandboxProvider>
    </SpacetimeDBProvider>
  )
}