import { useEffect } from 'react';
import {
  CURSOR_UPDATE_THRESHOLD,
  CURSOR_UPDATE_INTERVAL,
} from '../../components/sandbox/constants';

interface UseCursorTrackingOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  lastCursorPosition: React.MutableRefObject<{ x: number; y: number }>;
  isConnected: boolean;
  isTyping: boolean;
  typingText: string;
  onCursorUpdate: (x: number, y: number) => void;
  onMouseMoveWhileTyping: () => void;
}

export function useCursorTracking({
  canvasRef,
  lastCursorPosition,
  isConnected,
  isTyping,
  typingText,
  onCursorUpdate,
  onMouseMoveWhileTyping,
}: UseCursorTrackingOptions) {
  useEffect(() => {
    if (!canvasRef.current || !isConnected) return;

    const canvas = canvasRef.current;
    let lastUpdate = Date.now();
    let lastX = -1;
    let lastY = -1;

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      lastCursorPosition.current.x = x;
      lastCursorPosition.current.y = y;

      // Handle typing state when mouse moves
      if (isTyping && !typingText) {
        onMouseMoveWhileTyping();
      }

      const distance = Math.sqrt(
        Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2),
      );
      if (
        distance > CURSOR_UPDATE_THRESHOLD ||
        now - lastUpdate > CURSOR_UPDATE_INTERVAL
      ) {
        onCursorUpdate(x, y);
        lastUpdate = now;
        lastX = x;
        lastY = y;
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [
    canvasRef,
    lastCursorPosition,
    isConnected,
    isTyping,
    typingText,
    onCursorUpdate,
    onMouseMoveWhileTyping,
  ]);
}
