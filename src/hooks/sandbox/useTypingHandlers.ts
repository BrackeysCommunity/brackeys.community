import { useCallback } from 'react';
import { useSandbox } from '../../context/sandboxContext';
import { useSpacetimeDB } from '../../context/spacetimeDBContext';

export function useTypingHandlers() {
  const {
    isTyping,
    setIsTyping,
    typingText,
    setTypingText,
    setCursorDefault,
    setCursorTyping,
    lastCursorPosition,
    canvasRef,
  } = useSandbox();

  const { updateTyping, sendMessage } = useSpacetimeDB();

  const handleTypingStart = useCallback(() => {
    setIsTyping(true);
    setTypingText('');
  }, [setIsTyping, setTypingText]);

  const handleTypingChange = useCallback(
    (text: string, selectionStart: number, selectionEnd: number) => {
      setTypingText(text);
      setCursorTyping();
      const { x, y } = lastCursorPosition.current;
      updateTyping(text, x, y, selectionStart, selectionEnd);
    },
    [setTypingText, setCursorTyping, lastCursorPosition, updateTyping],
  );

  const handleSendMessage = useCallback(
    (text: string, x: number, y: number) => {
      sendMessage(text, x, y);
      setTypingText('');
    },
    [sendMessage, setTypingText],
  );

  const handleTypingClose = useCallback(() => {
    setIsTyping(false);
    setCursorDefault();
    setTypingText('');
    updateTyping('', 0, 0, 0, 0);
    canvasRef.current?.focus();
  }, [setIsTyping, setCursorDefault, setTypingText, updateTyping, canvasRef]);

  const handleMouseMoveWhileTyping = useCallback(() => {
    canvasRef.current?.focus();
    setIsTyping(false);
  }, [canvasRef, setIsTyping]);

  return {
    isTyping,
    typingText,
    handleTypingStart,
    handleTypingChange,
    handleSendMessage,
    handleTypingClose,
    handleMouseMoveWhileTyping,
  };
}
