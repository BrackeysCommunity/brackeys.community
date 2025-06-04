import { motion } from 'motion/react'
import { useMemo, useCallback } from 'react'
import { NameDialog } from '../components/sandbox/NameDialog'
import { SandboxCanvas } from '../components/sandbox/SandboxCanvas'
import { SpacetimeDBProvider } from '../context/SpacetimeDBProvider'
import { SandboxProvider } from '../context/SandboxProvider'
import { useLayoutProps } from '../context/layoutContext'
import { useSpacetimeDB } from '../context/spacetimeDBContext'
import { useDocTitle } from '../hooks/useDocTitle'
import { useSandbox } from '../context/sandboxContext'
import { useMessageGroups } from '../hooks/sandbox/useMessageGroups'
import { useCursorTracking } from '../hooks/sandbox/useCursorTracking'
import { useKeyboardShortcuts } from '../hooks/sandbox/useKeyboardShortcuts'
import { useTypingHandlers } from '../hooks/sandbox/useTypingHandlers'

// Container component handling state and logic
const SandboxContainer = () => {
  const {
    canvasRef,
    showNameDialog,
    setShowNameDialog,
    lastCursorPosition,
    setCursorDefault
  } = useSandbox()

  const {
    isConnected,
    currentUser,
    users,
    typingStates,
    messages,
    setDisplayName,
    updateCursor,
    dismissMessage,
  } = useSpacetimeDB()

  const {
    isTyping,
    typingText,
    handleTypingStart,
    handleTypingChange,
    handleSendMessage,
    handleTypingClose,
    handleMouseMoveWhileTyping
  } = useTypingHandlers()

  const usersMap = useMemo(() => new Map(users.map(u => [u.identity.toHexString(), u])), [users])
  const messageGroups = useMessageGroups(messages)
  const activeUserCount = users.length

  // Cursor tracking with throttling
  useCursorTracking({
    canvasRef,
    lastCursorPosition,
    isConnected,
    showNameDialog,
    isTyping,
    typingText,
    onCursorUpdate: (x, y) => {
      setCursorDefault()
      updateCursor(x, y)
    },
    onMouseMoveWhileTyping: handleMouseMoveWhileTyping
  })

  // Keyboard shortcuts
  useKeyboardShortcuts({
    canvasRef,
    isConnected,
    showNameDialog,
    isTyping,
    onTypingStart: handleTypingStart
  })

  const handleSetName = useCallback(async (name: string) => {
    try {
      await setDisplayName(name)
      setShowNameDialog(false)
      canvasRef.current?.focus();
    } catch (error) {
      console.error('Failed to set name:', error)
      throw error
    }
  }, [setDisplayName, setShowNameDialog, canvasRef])

  const handleDismissGroup = useCallback(async (messageIds: bigint[]) => {
    try {
      for (const messageId of messageIds) {
        await dismissMessage(messageId)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } catch (error) {
      console.error('Failed to dismiss group:', error)
    } finally {
      canvasRef.current?.focus();
    }
  }, [dismissMessage, canvasRef])

  const handleDismissMessage = useCallback(async (messageId: bigint) => {
    try {
      await dismissMessage(messageId);
    } catch (error) {
      console.error('Failed to dismiss message:', error)
    } finally {
      canvasRef.current?.focus();
    }
  }, [dismissMessage, canvasRef])

  return (
    <div className="flex flex-col grow">
      {showNameDialog && <NameDialog isConnected={isConnected} onSubmit={handleSetName} />}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: showNameDialog ? 0.3 : 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex-1 relative bg-gray-850 overflow-hidden"
      >
        <SandboxCanvas
          ref={canvasRef}
          isConnected={isConnected}
          showNameDialog={showNameDialog}
          users={users}
          currentUserId={currentUser?.identity.toHexString()}
          typingStates={typingStates}
          messageGroups={messageGroups}
          usersMap={usersMap}
          isTyping={isTyping}
          typingText={typingText}
          activeUserCount={activeUserCount}
          onTypingChange={handleTypingChange}
          onTypingClose={handleTypingClose}
          onSendMessage={handleSendMessage}
          onDismissMessage={handleDismissMessage}
          onDismissGroup={handleDismissGroup}
        />
      </motion.div>
    </div>
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