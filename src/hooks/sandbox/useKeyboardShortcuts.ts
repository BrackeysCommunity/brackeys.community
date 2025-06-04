import { useEffect } from 'react'

interface UseKeyboardShortcutsOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>
  isConnected: boolean
  showNameDialog: boolean
  isTyping: boolean
  onTypingStart: () => void
}

export function useKeyboardShortcuts({
  canvasRef,
  isConnected,
  showNameDialog,
  isTyping,
  onTypingStart
}: UseKeyboardShortcutsOptions) {
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
  }, [canvasRef, isConnected, showNameDialog, isTyping, onTypingStart])
} 