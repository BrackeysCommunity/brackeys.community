import { useEffect } from 'react'

interface UseKeyboardShortcutsOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>
  isConnected: boolean
  isTyping: boolean
  onTypingStart: () => void
}

export function useKeyboardShortcuts({
  canvasRef,
  isConnected,
  isTyping,
  onTypingStart
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input element
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) {
        return;
      }

      if (!isTyping && e.key === '/') {
        e.preventDefault()
        e.stopPropagation()
        onTypingStart()
      }
    }

    // Listen on document to catch events globally
    document.addEventListener('keydown', handleKeyDown, true)

    // Also set tabIndex on canvas if it exists
    if (canvasRef.current) {
      canvasRef.current.tabIndex = 0
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [canvasRef, isConnected, isTyping, onTypingStart])
} 