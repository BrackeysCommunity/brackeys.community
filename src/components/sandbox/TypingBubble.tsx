import { motion, AnimatePresence } from 'motion/react';
import React, { useRef, useEffect, useMemo } from 'react';
import { SandboxUser, LiveTyping } from '../../spacetime-bindings';
import { useSandbox } from '../../context/sandboxContext';
import {
  TYPING_ANIMATION_CONFIG,
  TYPING_BUBBLE_TRANSITIONS,
  TYPING_BLUR_TIMEOUT,
  MAX_TYPING_LENGTH,
} from './constants';
import { cn } from '../../lib/utils';
import { generateColorScheme } from '../../lib/colors';

type SimpleTypingState = {
  text: string;
  isTyping: boolean;
  selectionStart: number;
  selectionEnd: number;
};

type TypingBubbleProps = {
  user: SandboxUser;
  isCurrentUser?: boolean;
  typingState: LiveTyping | SimpleTypingState;
  onTypingChange?: (
    text: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onTypingClose?: () => void;
  onSendMessage?: (text: string) => void;
};

const renderTextWithSelection = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  selectionColor?: string,
  selectionTextColor?: string,
) => {
  if (
    selectionStart === selectionEnd ||
    selectionStart < 0 ||
    selectionEnd < 0
  ) {
    return <AnimatedText text={text} />;
  }

  const beforeSelection = text.slice(0, selectionStart);
  const selection = text.slice(selectionStart, selectionEnd);
  const afterSelection = text.slice(selectionEnd);

  return (
    <>
      <AnimatedText text={beforeSelection} />
      <span
        className="rounded-sm px-0.5"
        style={{
          backgroundColor: selectionColor || 'rgba(255, 255, 255, 0.6)',
          color: selectionTextColor || 'white',
        }}
      >
        <AnimatedText text={selection} />
      </span>
      <AnimatedText text={afterSelection} />
    </>
  );
};

const AnimatedText = ({ text }: { text: string }) => {
  // Split text into words and spaces, preserving word boundaries
  const words = React.useMemo(() => {
    const wordPattern = /(\S+|\s+)/g;
    const matches = text.match(wordPattern) || [];
    let charIndex = 0;

    return matches.map((word, wordIndex) => {
      const wordStartIndex = charIndex;
      const chars = word.split('').map((char, index) => ({
        // Use position in full text for stable keys
        id: `char-${wordStartIndex + index}`,
        char,
        globalIndex: wordStartIndex + index,
      }));
      charIndex += word.length;

      return {
        id: `word-${wordIndex}`,
        chars,
        isSpace: /^\s+$/.test(word),
      };
    });
  }, [text]);

  return (
    <>
      {words.map(({ id, chars, isSpace }) => (
        <span key={id} className={isSpace ? 'inline' : 'inline-block'}>
          <AnimatePresence mode="popLayout">
            {chars.map(({ id: charId, char }) => (
              <motion.span
                key={charId}
                layout
                initial={{
                  opacity: 0,
                  y: -3,
                  scale: 0.6,
                  rotateZ: -10,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  rotateZ: 0,
                  transition: {
                    duration: 0.05,
                    type: 'spring',
                    damping: 12,
                    stiffness: 400,
                    mass: 0.8 * Math.min(Math.random() * 1.2, 1),
                  },
                }}
                exit={{
                  opacity: [1, 1, 0],
                  y: 5,
                  scale: 0.9,
                  transition: {
                    duration: 0.1,
                    ease: 'easeOut',
                    times: [0, 0.5, 1],
                  },
                }}
                className="inline-block origin-center"
              >
                {char === ' ' ? '\u00A0' : char}
              </motion.span>
            ))}
          </AnimatePresence>
        </span>
      ))}
    </>
  );
};

export const TypingBubble = ({
  user,
  isCurrentUser,
  typingState,
  onTypingChange,
  onTypingClose,
  onSendMessage,
}: TypingBubbleProps) => {
  const editableRef = useRef<HTMLDivElement>(null);
  const { setCursorTyping, setCursorDefault } = useSandbox();
  const isTyping = typingState?.isTyping || false;

  // Generate color scheme for this user
  const colorScheme = useMemo(
    () => generateColorScheme(user.color),
    [user.color],
  );

  useEffect(() => {
    if (isCurrentUser && isTyping && editableRef.current) {
      editableRef.current.focus();

      // Place cursor at the end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editableRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);

      setCursorTyping();
    } else if (isCurrentUser && !isTyping) {
      setCursorDefault();
    }
  }, [isCurrentUser, isTyping, setCursorTyping, setCursorDefault]);

  // Add global selection change listener for better selection tracking
  useEffect(() => {
    if (!isCurrentUser || !isTyping) return;

    const handleGlobalSelectionChange = () => {
      if (document.activeElement === editableRef.current) {
        handleSelectionChange();
      }
    };

    document.addEventListener('selectionchange', handleGlobalSelectionChange);
    return () => {
      document.removeEventListener(
        'selectionchange',
        handleGlobalSelectionChange,
      );
    };
  }, [isCurrentUser, isTyping]);

  // Keep content in sync with state
  useEffect(() => {
    if (isCurrentUser && editableRef.current && typingState) {
      const currentText = editableRef.current.textContent || '';
      if (currentText !== typingState.text) {
        editableRef.current.textContent = typingState.text;
      }
    }
  }, [typingState?.text, isCurrentUser]);

  const getCaretPosition = (): { start: number; end: number } => {
    if (!editableRef.current) return { start: 0, end: 0 };

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return { start: 0, end: 0 };

    const range = selection.getRangeAt(0);
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(editableRef.current);
    preCaretRange.setEnd(range.startContainer, range.startOffset);

    const start = preCaretRange.toString().length;
    const end = start + range.toString().length;

    return { start, end };
  };

  const handleInput = () => {
    if (!onTypingChange || !editableRef.current) return;

    const text = editableRef.current.textContent || '';
    const { start, end } = getCaretPosition();

    // If we're over the limit, truncate and maintain cursor position
    if (text.length > MAX_TYPING_LENGTH) {
      const truncatedText = text.slice(0, MAX_TYPING_LENGTH);
      editableRef.current.textContent = truncatedText;

      // Restore cursor position, but clamp it to the new text length
      const newStart = Math.min(start, truncatedText.length);
      const newEnd = Math.min(end, truncatedText.length);

      // Set cursor position
      const range = document.createRange();
      const sel = window.getSelection();
      if (editableRef.current.firstChild) {
        range.setStart(editableRef.current.firstChild, newStart);
        range.setEnd(editableRef.current.firstChild, newEnd);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }

      onTypingChange(truncatedText, newStart, newEnd);
    } else {
      onTypingChange(text, start, end);
    }
  };

  const handleSelectionChange = () => {
    if (!onTypingChange || !editableRef.current) return;

    const text = editableRef.current.textContent || '';
    const { start, end } = getCaretPosition();

    onTypingChange(text, start, end);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onTypingClose?.();
    } else if (e.key === 'Enter') {
      e.preventDefault();

      if (e.shiftKey) return;

      const message = (e.currentTarget.textContent || '').trim();
      if (message) {
        onSendMessage?.(message);
        e.currentTarget.textContent = '';
      }
    }
  };

  const handleBlur = () => {
    if (!onTypingClose) return;
    setTimeout(() => {
      if (document.activeElement !== editableRef.current) {
        onTypingClose();
      }
    }, TYPING_BLUR_TIMEOUT);
  };

  return (
    <motion.div
      className="absolute top-3.5 left-3.5 max-w-[400px]"
      initial={false}
      transition={TYPING_ANIMATION_CONFIG}
    >
      <motion.div
        className="overflow-hidden rounded-lg shadow-lg"
        style={{ backgroundColor: user.color }}
        animate={{
          padding: isTyping ? '8px 12px' : '4px 8px',
        }}
        transition={TYPING_ANIMATION_CONFIG}
      >
        <div className="w-max">
          <div className={cn('flex gap-1', isCurrentUser && 'items-baseline')}>
            <div className={cn('flex flex-col', !isCurrentUser && 'pt-0.75')}>
              <span
                className="text-xs font-semibold flex-shrink-0"
                style={{ color: colorScheme?.baseText || 'white' }}
              >
                {user.name || 'Anonymous'}
                {isTyping && ':'}
              </span>
              {isCurrentUser &&
                isTyping &&
                typingState &&
                MAX_TYPING_LENGTH - typingState.text.length <= 40 && (
                  <span className="text-xs text-white/70 mt-1 text-right">
                    {MAX_TYPING_LENGTH - typingState.text.length}
                  </span>
                )}
            </div>

            <AnimatePresence>
              {isTyping && typingState && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={TYPING_BUBBLE_TRANSITIONS}
                  className="inline-block"
                >
                  {isCurrentUser ? (
                    <div
                      ref={editableRef}
                      contentEditable
                      spellCheck={false}
                      onInput={handleInput}
                      onKeyDown={handleKeyDown}
                      onKeyUp={handleSelectionChange}
                      onMouseUp={handleSelectionChange}
                      onClick={handleSelectionChange}
                      onBlur={handleBlur}
                      className="bg-transparent text-sm outline-none  min-w-0 max-w-80 w-max min-h-4 max-h-36 overflow-y-auto whitespace-pre-wrap break-words"
                      suppressContentEditableWarning
                      style={{
                        caretColor: colorScheme?.caretColor || 'white',
                        color: colorScheme?.baseText || 'white',
                      }}
                    />
                  ) : (
                    <div
                      className="text-sm whitespace-pre-wrap break-words text-white max-w-80 w-max"
                      style={{
                        color: colorScheme?.baseText || 'white',
                      }}
                    >
                      {renderTextWithSelection(
                        typingState.text,
                        typingState.selectionStart || 0,
                        typingState.selectionEnd || 0,
                        colorScheme?.selection,
                        colorScheme?.selectionText,
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
